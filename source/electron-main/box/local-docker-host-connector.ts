import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { publishLocalInferenceSnapshot, LOCAL_INFERENCE_MOUNT, LOCAL_INFERENCE_SNAPSHOT_ENV } from "../../shared/node/local-inference-snapshot.js";
import type { SandSettingsStore } from "../../shared/node/settings/sand-settings-store.js";
import type { RecreateResult } from "./box-recreate-commands.js";
import type { SandRemoteHostConnector } from "./box-host-connector.js";
import type { GatewayConnection } from "./gateway-descriptor-cache.js";

import { createLocalDockerClient, type LocalDockerClient } from "./local-docker-command.js";
import { exportLocalDockerAuth } from "./local-docker-auth.js";
import { assertLocalContainerOwned, assertNoInterruptedReplacement, inspectLocalContainer, LOCAL_ASSIGNMENTS_PATH, LOCAL_HOME_MOUNT, LOCAL_BOOTSTRAP, mutateOwnedContainer, replaceLocalDockerContainer, stageLocalBootstrap, type LocalContainer } from "./local-docker-lifecycle.js";

export const LOCAL_DOCKER_BOX_IMAGE = "public.ecr.aws/k0i0n2g5/cursorenvironments/universal:sand-box-latest";
export const LOCAL_DOCKER_BOX_CONTAINER = "grok-bot-local-vm";
export const LOCAL_DOCKER_GATEWAY_URL = "http://127.0.0.1:1340";
export const LOCAL_DOCKER_OWNER_LABEL = "com.grok-bot.local-vm=1";
export const LOCAL_DOCKER_SCHEMA_VERSION = "9";
const READY_TIMEOUT_MS = 180_000;
const OPTIONAL_CREDENTIAL_TIMEOUT_MS = 3_000;

export interface LocalDockerStatus {
  readonly available: boolean;
  readonly running: boolean;
  readonly ready: boolean;
  readonly containerName: string;
  readonly image: string;
  readonly detail: string;
}

interface InferenceCredential { readonly accessToken: string; readonly backendUrl: string; readonly expiresAtMs: number }
interface LocalHostBundle { readonly path: string; readonly sha256: string; readonly boxExecDaemonPath: string; readonly boxExecDaemonSha256: string }

function credentialPath(settingsPath: string): string {
  return join(dirname(settingsPath), "local-docker-vm.json");
}

function inferenceCredentialPath(settingsPath: string): string {
  return join(dirname(settingsPath), "local-docker-credential", "inference.json");
}

async function persistInferenceCredential(settingsPath: string, credential: InferenceCredential): Promise<string> {
  const target = inferenceCredentialPath(settingsPath);
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temporary, `${JSON.stringify({ accessToken: credential.accessToken, expiresAtMs: credential.expiresAtMs })}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
  await chmod(target, 0o600);
  return target;
}

async function readOrCreateToken(settingsPath: string): Promise<string> {
  const target = credentialPath(settingsPath);
  try {
    const parsed = JSON.parse(await readFile(target, "utf8")) as { token?: unknown };
    if (typeof parsed.token === "string" && parsed.token.length >= 32) return parsed.token;
  } catch {}
  const token = randomBytes(32).toString("hex");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify({ schemaVersion: 1, token }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(target, 0o600);
  return token;
}

async function gatewayReady(token: string): Promise<boolean> {
  try {
    const response = await fetch(`${LOCAL_DOCKER_GATEWAY_URL}/health`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch { return false; }
}

export async function getLocalDockerStatus(settingsPath: string): Promise<LocalDockerStatus> {
  let client: LocalDockerClient;
  try { client = await createLocalDockerClient(); }
  catch (error) { return { available: false, running: false, ready: false, containerName: LOCAL_DOCKER_BOX_CONTAINER, image: LOCAL_DOCKER_BOX_IMAGE, detail: error instanceof Error ? error.message : "Local Docker is unavailable." }; }
  const daemon = await client.run(["info", "--format", "{{.ServerVersion}}"]);
  if (!daemon.ok) return { available: false, running: false, ready: false, containerName: LOCAL_DOCKER_BOX_CONTAINER, image: LOCAL_DOCKER_BOX_IMAGE, detail: daemon.output || "Docker is not running." };
  const inspected = await inspectLocalContainer(client.run, LOCAL_DOCKER_BOX_CONTAINER);
  if (inspected == null) return { available: true, running: false, ready: false, containerName: LOCAL_DOCKER_BOX_CONTAINER, image: LOCAL_DOCKER_BOX_IMAGE, detail: "Ready to create the local VM." };
  if (!inspected.owned) return { available: true, running: inspected.running, ready: false, containerName: LOCAL_DOCKER_BOX_CONTAINER, image: inspected.image, detail: `Container ${LOCAL_DOCKER_BOX_CONTAINER} exists but is not owned by BeeBot.` };
  const ready = inspected.running && await gatewayReady(await readOrCreateToken(settingsPath));
  return { available: true, running: inspected.running, ready, containerName: LOCAL_DOCKER_BOX_CONTAINER, image: inspected.image, detail: ready ? "Local Docker VM is ready." : inspected.running ? "Container is starting." : "Local Docker VM is stopped." };
}

let lifecycleTail: Promise<unknown> = Promise.resolve();
function serializeLocalLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const pending = lifecycleTail.catch(() => {}).then(operation); lifecycleTail = pending; return pending;
}
let ensureInFlight: Promise<GatewayConnection> | undefined;

async function stageCurrentHostBundle(settingsPath: string): Promise<LocalHostBundle> {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const readRuntime = async (relative: string): Promise<Buffer> => {
    const candidates = [resolve(moduleDirectory, `../${relative}`), resolve(moduleDirectory, `../../${relative}`)];
    for (const candidate of candidates) {
      try { return await readFile(candidate); } catch {}
    }
    throw new Error(`The reconstructed runtime is unavailable at ${candidates.join(" or ")}; refusing to start a stock local VM.`);
  };
  const hostBytes = await readRuntime("host/host-main.cjs");
  const boxExecDaemonBytes = await readRuntime("box-exec-daemon/main.cjs");
  const sha256 = createHash("sha256").update(hostBytes).digest("hex");
  const boxExecDaemonSha256 = createHash("sha256").update(boxExecDaemonBytes).digest("hex");
  const directory = join(dirname(settingsPath), "local-docker-runtime", `${sha256}-${boxExecDaemonSha256}`);
  const persistRuntime = async (name: string, bytes: Buffer): Promise<string> => {
    const target = join(directory, name);
    await mkdir(dirname(target), { recursive: true });
    try {
      const existing = await readFile(target);
      if (!existing.equals(bytes)) throw new Error(`Content-addressed local runtime ${target} has unexpected bytes.`);
    } catch (error) {
      if (error instanceof Error && !Reflect.has(error, "code")) throw error;
      const temporary = `${target}.${process.pid}.tmp`;
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, target);
    }
    return target;
  };
  await mkdir(directory, { recursive: true });
  return {
    path: await persistRuntime("host-main.cjs", hostBytes),
    sha256,
    boxExecDaemonPath: await persistRuntime("box-exec-daemon/main.cjs", boxExecDaemonBytes),
    boxExecDaemonSha256,
  };
}

async function ensureLocalDockerBox(settingsPath: string, inferenceCredential?: InferenceCredential, options: { client?: LocalDockerClient; forceReplace?: boolean } = {}): Promise<GatewayConnection> {
  const client = options.client ?? await createLocalDockerClient();
  await assertNoInterruptedReplacement(settingsPath);
  const daemon = await client.run(["info", "--format", "{{.ServerVersion}}"]);
  if (!daemon.ok) throw new Error("Local Docker is unavailable. Start your local Docker engine and retry.");
  const inspected = await inspectLocalContainer(client.run, LOCAL_DOCKER_BOX_CONTAINER);
  if (inspected != null) assertLocalContainerOwned(inspected, LOCAL_DOCKER_BOX_IMAGE);
  const inferenceDirectory = publishLocalInferenceSnapshot(settingsPath), token = await readOrCreateToken(settingsPath);
  const hostBundle = await stageCurrentHostBundle(settingsPath);
  const inferenceFile = inferenceCredential == null ? undefined : await persistInferenceCredential(settingsPath, inferenceCredential);
  const authMounts = await exportLocalDockerAuth(settingsPath), bootstrap = await stageLocalBootstrap(settingsPath);
  const waitReady = async (container: LocalContainer): Promise<void> => {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await gatewayReady(token)) return;
      const state = await inspectLocalContainer(client.run, container.id);
      if (state == null || !state.running) throw new Error("Local computer stopped before its gateway became ready; previous data was retained.");
      assertLocalContainerOwned(state, LOCAL_DOCKER_BOX_IMAGE);
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
    throw new Error("Local computer did not expose its gateway within three minutes.");
  };
  const bootstrapSha256 = createHash("sha256").update(LOCAL_BOOTSTRAP).digest("hex");
  const replace = inspected == null || options.forceReplace === true || inspected.schemaVersion !== LOCAL_DOCKER_SCHEMA_VERSION || inspected.hostSha256 !== hostBundle.sha256 || inspected.daemonSha256 !== hostBundle.boxExecDaemonSha256 || inspected.labels["com.beebot.local-vm.bootstrap-sha256"] !== bootstrapSha256 || (inferenceCredential != null && !inspected.hasInferenceCredential);
  if (replace) {
    // Refuse an incompatible upstream entrypoint instead of hiding its behavior.
    let image = await client.run(["image", "inspect", "--format", "{{json .Config.Entrypoint}}", LOCAL_DOCKER_BOX_IMAGE]);
    if (!image.ok && /No such image/i.test(image.output)) {
      const pulled = await client.run(["pull", "--platform", "linux/amd64", LOCAL_DOCKER_BOX_IMAGE]);
      if (pulled.ok) image = await client.run(["image", "inspect", "--format", "{{json .Config.Entrypoint}}", LOCAL_DOCKER_BOX_IMAGE]);
    }
    if (!image.ok || image.output !== '["/usr/local/bin/start-sand-box"]') throw new Error("The local Linux image is unavailable or has an unsupported entrypoint; the previous computer was retained.");
    await replaceLocalDockerContainer({ run: client.run, settingsPath, image: LOCAL_DOCKER_BOX_IMAGE, name: LOCAL_DOCKER_BOX_CONTAINER, ...(inspected == null ? {} : { old: inspected }), waitReady,
      createArgs: async (snapshot, transaction) => [
        "create", "--name", LOCAL_DOCKER_BOX_CONTAINER,
        "--label", LOCAL_DOCKER_OWNER_LABEL, "--label", `com.beebot.local-vm.transaction=${transaction}`,
        "--label", "com.beebot.local-vm.home-persistence=1", "--label", `com.beebot.local-vm.bootstrap-sha256=${bootstrapSha256}`,
        "--label", `com.grok-bot.local-vm.host-sha256=${hostBundle.sha256}`, "--label", `com.grok-bot.local-vm.box-exec-daemon-sha256=${hostBundle.boxExecDaemonSha256}`,
        "--label", `com.grok-bot.local-vm.inference-credential=${inferenceCredential == null ? "0" : "1"}`, "--label", `com.grok-bot.local-vm.schema-version=${LOCAL_DOCKER_SCHEMA_VERSION}`,
        "--platform", "linux/amd64", "--restart", "unless-stopped",
        "--env", "SAND_SUPERVISOR_ENABLED=1", "--env", "SAND_BOX_AUTO_UPDATE=0", "--env", "SAND_USE_EXISTING_BOX_EXEC_DAEMON=1", "--env", "SAND_TREE_SITTER_NODE_DEPS=/home/box/deps", "--env", "NODE_PATH=/home/box/deps", "--env", "SAND_GATEWAY_BIND_HOST=0.0.0.0", "--env", "SAND_HOST_PORT=1340", "--env", `SAND_GATEWAY_TOKEN=${token}`,
        "--env", `BEEBOT_DESKTOP_ASSIGNMENTS_PATH=${LOCAL_ASSIGNMENTS_PATH}`,
        ...(inferenceCredential == null ? [] : ["--env", "SAND_DEV_INFERENCE_TOKEN_FILE=/run/grok-bot/inference.json", "--env", `SAND_BACKEND_URL=${inferenceCredential.backendUrl}`]),
        "--publish", "127.0.0.1:1337:1337", "--publish", "127.0.0.1:1339:1339", "--publish", "127.0.0.1:1340:1340",
        "--publish", "127.0.0.1:6080:6080", "--publish", "127.0.0.1:6081:6081", "--publish", "127.0.0.1:8790:8790",
        "--volume", "grok-bot-local-vm-workspace:/workspace", "--volume", "grok-bot-local-vm-data:/home/box/sand-data", "--volume", `${snapshot.volume}:${LOCAL_HOME_MOUNT}`,
        "--env", `${LOCAL_INFERENCE_SNAPSHOT_ENV}=${LOCAL_INFERENCE_MOUNT}/current.json`, "--mount", `type=bind,src=${inferenceDirectory},dst=${LOCAL_INFERENCE_MOUNT},readonly`,
        "--mount", `type=bind,src=${hostBundle.path},dst=/home/box/sand-host/host-main.cjs,readonly`, "--mount", `type=bind,src=${dirname(hostBundle.boxExecDaemonPath)},dst=/home/box/box-exec-daemon,readonly`,
        "--mount", `type=bind,src=${bootstrap},dst=/run/beebot-bootstrap.sh,readonly`, "--entrypoint", "/bin/bash",
        ...(inferenceFile == null ? [] : ["--mount", `type=bind,src=${dirname(inferenceFile)},dst=/run/grok-bot,readonly`]), ...authMounts,
        LOCAL_DOCKER_BOX_IMAGE, "/run/beebot-bootstrap.sh",
      ],
    });
  } else {
    if (!inspected.running) await mutateOwnedContainer(client.run, inspected, LOCAL_DOCKER_BOX_IMAGE, "start");
    await waitReady(inspected);
  }
  return { baseUrl: LOCAL_DOCKER_GATEWAY_URL, token };
}

export async function startLocalDockerBox(settingsPath: string): Promise<GatewayConnection> {
  return await serializeLocalLifecycle(() => ensureLocalDockerBox(settingsPath));
}
export async function stopLocalDockerBox(): Promise<void> {
  await serializeLocalLifecycle(async () => {
    const client = await createLocalDockerClient(), inspected = await inspectLocalContainer(client.run, LOCAL_DOCKER_BOX_CONTAINER);
    if (inspected == null) return;
    assertLocalContainerOwned(inspected, LOCAL_DOCKER_BOX_IMAGE);
    if (inspected.running) await mutateOwnedContainer(client.run, inspected, LOCAL_DOCKER_BOX_IMAGE, "stop");
  });
}

export function createSettingsRoutedHostConnector(
  remote: SandRemoteHostConnector,
  settings: SandSettingsStore,
): SandRemoteHostConnector {
  const issueOptionalCredential = async (): Promise<InferenceCredential | undefined> => remote.issueInferenceCredential == null ? undefined : await Promise.race([
    remote.issueInferenceCredential(),
    new Promise<undefined>((resolve) => setTimeout(resolve, OPTIONAL_CREDENTIAL_TIMEOUT_MS)),
  ]);
  const localConnect = (): Promise<GatewayConnection> => {
    if (ensureInFlight == null) ensureInFlight = (async () => {
      const issued = await issueOptionalCredential();
      return await serializeLocalLifecycle(() => ensureLocalDockerBox(settings.settingsPath, issued));
    })().finally(() => { ensureInFlight = undefined; });
    return ensureInFlight;
  };
  return {
    connect: async () => settings.getBoxRuntime() === "local-docker" ? await localConnect() : await remote.connect(),
    ...(remote.issueLocalExecDaemonCredential == null ? {} : { issueLocalExecDaemonCredential: remote.issueLocalExecDaemonCredential.bind(remote) }),
    ...(remote.issueInferenceCredential == null ? {} : { issueInferenceCredential: remote.issueInferenceCredential.bind(remote) }),
    recreate: async (args): Promise<RecreateResult> => {
      if (settings.getBoxRuntime() !== "local-docker") {
        if (remote.recreate == null) throw new Error("Remote computer recreation is unavailable.");
        return await remote.recreate(args);
      }
      const issued = await issueOptionalCredential();
      await serializeLocalLifecycle(async () => {
        await assertNoInterruptedReplacement(settings.settingsPath);
        const client = await createLocalDockerClient(), inspected = await inspectLocalContainer(client.run, LOCAL_DOCKER_BOX_CONTAINER);
        if (inspected != null) await mutateOwnedContainer(client.run, inspected, LOCAL_DOCKER_BOX_IMAGE, "restart");
        await ensureLocalDockerBox(settings.settingsPath, issued, { client });
      });
      return { status: "started-untrackable" };
    },
    forceRecreate: async (): Promise<RecreateResult> => {
      if (settings.getBoxRuntime() !== "local-docker") {
        if (remote.forceRecreate == null) return { status: "rejected", reason: "Remote computer reset is unavailable." };
        return await remote.forceRecreate();
      }
      const issued = await issueOptionalCredential();
      await serializeLocalLifecycle(() => ensureLocalDockerBox(settings.settingsPath, issued, { forceReplace: true }));
      return { status: "started-untrackable" };
    },
  };
}
