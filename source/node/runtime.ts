import { spawn, type ChildProcess } from "node:child_process";
import { signalOwnedRuntime } from "./owned-process-signal.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { BotAvatar } from "../shared/agents/bot-avatar.js";

export interface RuntimeBot extends BotAvatar { id: string; name: string; description: string }
export interface RuntimeInput { runId: string; bot: RuntimeBot; prompt: string }
export interface RuntimeResult { text: string; transcript: unknown[] }
export class RuntimeExecutionError extends Error {
  constructor(readonly code: "failed" | "uncertain" | "needs_input" | "cancelled", message: string) {
    super(message);
    this.name = "RuntimeExecutionError";
  }
}

interface HostProcess {
  child: ChildProcess;
  stopped: Promise<void>;
  url: string;
  token: string;
  agentId: string;
  stop?: Promise<void>;
}
interface RunReceipt {
  digest: string;
  status: "running" | "succeeded" | "failed" | "uncertain" | "needs_input" | "cancelled";
  result?: RuntimeResult;
  message?: string;
}
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const records = (value: unknown): JsonObject[] => Array.isArray(value) ? value.map(object) : [];
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** Only bootstrap OS variables are inherited. Provider keys must be explicitly supplied. */
export function runtimeEnvironment(explicit: NodeJS.ProcessEnv = {}, inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TZ", "SystemRoot", "COMSPEC", "PATHEXT"]) {
    if (inherited[key] !== undefined) result[key] = inherited[key];
  }
  for (const [key, value] of Object.entries(explicit)) {
    // A model/tool subprocess must never inherit the controller's identity or bootstrap controls.
    if (/^(BEEBOT_|SAND_|ELECTRON_|NODE_OPTIONS$|NODE_EXTRA_CA_CERTS$|NODE_PATH$|LD_|DYLD_)/i.test(key) && key !== "SAND_AGENT_MOCK_RESPONSE") continue;
    if (value !== undefined) result[key] = value;
  }
  return result;
}

async function readJson(file: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
async function durableJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, file);
  const directory = await open(path.dirname(file), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}
async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Cannot allocate local runtime port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  // The daemon checks the port again and fails closed if another process won this race.
  return address.port;
}
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new RuntimeExecutionError("cancelled", "Execution cancelled");
}
async function rpc(host: HostProcess, method: string, args: unknown, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`${host.url}/api/${method}`, {
    method: "POST", headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
    body: JSON.stringify(args), signal: method === "sendPrompt" ? signal : AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });
  const result: unknown = await response.json();
  if (!response.ok) throw new Error(`Runtime ${method}: ${String(object(result).error ?? response.status)}`);
  return result;
}
function visibleText(entries: JsonObject[]): string {
  return entries.flatMap(entry => {
    if (entry.kind === "message" && entry.role === "assistant" && typeof entry.content === "string") return [entry.content];
    const message = object(entry.message);
    if (entry.kind === "send-message" && message.type === "text" && typeof message.content === "string") return [message.content];
    return [];
  }).join("\n\n");
}
function requiresInput(entries: JsonObject[]): boolean {
  return entries.some(entry => {
    const message = object(entry.message);
    return entry.status === "pending" && /approval|permission/.test(String(entry.kind)) ||
      ["widget", "question", "select", "form", "secret-request", "request-secret", "confirmation"].includes(String(message.type)) &&
      entry.response == null && message.response == null && entry.dismissed !== true;
  });
}

/** Trusted single-owner runtime. Directory separation is persistence isolation, not a security sandbox. */
export class HostRuntime {
  private readonly hosts = new Map<string, HostProcess>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly closing = new AbortController();
  private closePromise: Promise<void> | undefined;
  constructor(private readonly options: { dataDir: string; hostEntry: string; settings?: Record<string, unknown>; env?: NodeJS.ProcessEnv }) {}

  execute(input: RuntimeInput, signal: AbortSignal): Promise<RuntimeResult> {
    if (!input.bot.id || !input.runId || !input.prompt.trim()) return Promise.reject(new Error("bot id, run id and prompt are required"));
    const combined = AbortSignal.any([signal, this.closing.signal]);
    const predecessor = this.queues.get(input.bot.id) ?? Promise.resolve();
    const execution = predecessor.catch(() => {}).then(() => {
      throwIfAborted(combined);
      return this.executeOnce(input, combined);
    });
    this.queues.set(input.bot.id, execution);
    void execution.finally(() => {
      if (this.queues.get(input.bot.id) === execution) this.queues.delete(input.bot.id);
    }).catch(() => {});
    return execution;
  }

  /** Called only after the controller records an owner's explicit external-effects review. */
  reconcile(bot: RuntimeBot, runId: string): Promise<void> {
    if (this.queues.has(bot.id)) return Promise.reject(new Error("Cannot reconcile a Bot with an active execution"));
    const work = this.reconcileOnce(bot, runId);
    this.queues.set(bot.id, work);
    void work.finally(() => { if (this.queues.get(bot.id) === work) this.queues.delete(bot.id); }).catch(() => {});
    return work;
  }

  private async reconcileOnce(bot: RuntimeBot, runId: string): Promise<void> {
    const botRoot = path.resolve(this.options.dataDir, "runtime-bots", digest(bot.id));
    const activePath = path.join(botRoot, "active-run.json");
    const active = await readJson(activePath);
    if (active === undefined) return;
    if (object(active).runId !== runId) throw new Error("Reconciliation does not match the Bot's interrupted run");
    const current = this.hosts.get(bot.id);
    if (current) await this.stopHost(bot.id, current);
    const discovery = object(await readJson(path.join(botRoot, "host/gateway.json")));
    const previousPid = object(active).pid ?? discovery.pid;
    if (typeof previousPid === "number") {
      let alive = true;
      for (let attempt = 0; attempt < 50; attempt++) {
        try { process.kill(previousPid, 0); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") { alive = false; break; } throw error; }
        await delay(100);
      }
      // Never signal a PID from a stale file: it might have been reused by an
      // unrelated process. Controller-owned children are stopped above.
      if (alive) throw new Error("Previous Bot process has not stopped; reconciliation remains fenced");
    }
    const archive = path.join(botRoot, "runs", `${digest(runId)}.reconciled.json`);
    const history = object(await readJson(archive));
    const markers = object(history.retiredMarkers);
    for (const name of ["ack-obligations.json", "host-pending-wakes.json", "host-upgrade-resume.json"]) {
      const file = path.join(botRoot, "host", name);
      const value = await readJson(file);
      if (value !== undefined && markers[name] === undefined) markers[name] = value;
    }
    await durableJson(archive, { runId, reconciledAt: Date.now(), retiredMarkers: markers });
    for (const name of Object.keys(markers)) {
      if (!["ack-obligations.json", "host-pending-wakes.json", "host-upgrade-resume.json"].includes(name)) continue;
      // Preserve history in the archive, but explicitly retire automatic wakeups
      // belonging to the reviewed run before this Bot can start again.
      await durableJson(path.join(botRoot, "host", name), { version: 1, pending: [] });
    }
    await rm(activePath);
    const directory = await open(botRoot, "r");
    try { await directory.sync(); } finally { await directory.close(); }
  }

  private async executeOnce(input: RuntimeInput, signal: AbortSignal): Promise<RuntimeResult> {
    const botRoot = path.resolve(this.options.dataDir, "runtime-bots", digest(input.bot.id));
    const runsRoot = path.join(botRoot, "runs");
    await mkdir(runsRoot, { recursive: true, mode: 0o700 });
    const receiptPath = path.join(runsRoot, `${digest(input.runId)}.json`);
    const activePath = path.join(botRoot, "active-run.json");
    const inputDigest = digest(JSON.stringify([input.bot.id, input.prompt]));
    const existing = await readJson(receiptPath) as RunReceipt | undefined;
    if (existing) {
      if (existing.digest !== inputDigest) throw new Error("runId already used with different input");
      if (existing.status === "succeeded" && existing.result) return existing.result;
      throw new RuntimeExecutionError(existing.status === "running" ? "uncertain" : existing.status as RuntimeExecutionError["code"], existing.message ?? "Run was already dispatched; it will not be sent again");
    }
    if (await readJson(activePath) !== undefined) throw new RuntimeExecutionError("uncertain", "Bot has an interrupted execution requiring reconciliation before further work");
    if (this.options.env?.SAND_AGENT_MOCK_RESPONSE == null &&
        (this.options.settings?.inferenceProvider == null || this.options.settings.inferenceProvider === "cursor")) {
      throw new RuntimeExecutionError("failed", "Configure an explicit server model before executing a goal");
    }
    const host = await this.ensureHost(input.bot, botRoot, signal);
    const before = records(await rpc(host, "getAgentTranscript", { id: host.agentId }, signal));
    const priorIds = new Set(before.map(entry => entry.id));
    const oldTrays = new Map(records(await rpc(host, "getTrays", {}, signal)).map(entry => [entry.id, JSON.stringify(entry)]));
    const oldOutline = new Set(records(await rpc(host, "getConversationOutline", { id: host.agentId }, signal)).map(entry => entry.id));
    throwIfAborted(signal);
    await durableJson(receiptPath, { digest: inputDigest, status: "running" } satisfies RunReceipt);
    await durableJson(activePath, { runId: input.runId, startedAt: Date.now(), pid: host.child.pid });
    const requestAbort = new AbortController();
    const requestSignal = AbortSignal.any([signal, requestAbort.signal]);
    let settled = false;
    let confirmed = false;
    let waiting = false;
    let processStopped = false;
    let monitorFailure: unknown;
    const onExit = () => {
      if (!settled) { processStopped = true; requestAbort.abort(); }
    };
    host.child.once("exit", onExit);
    host.child.once("error", onExit);
    if (host.child.exitCode !== null || host.child.signalCode !== null) onExit();
    const monitor = (async () => {
      while (!settled && !requestSignal.aborted) {
        await delay(350, undefined, { signal: requestSignal }).catch(() => {});
        if (settled || requestSignal.aborted) break;
        try {
          const health = object(await (await fetch(`${host.url}/health`, { signal: AbortSignal.any([requestSignal, AbortSignal.timeout(3_000)]) })).json());
          if (health.busyOnlyAwaitingApproval === true) { waiting = true; requestAbort.abort(); }
        } catch (error) { if (!requestSignal.aborted) { monitorFailure = error; requestAbort.abort(); } }
      }
    })();
    try {
      // This POST is never retried, including when only the response was lost.
      await rpc(host, "sendPrompt", { agentId: host.agentId, prompt: input.prompt, clientNonce: input.runId }, requestSignal);
      // A foreground turn may have delegated shells or subagents. Their durable
      // wake markers remain present until their completion has been consumed.
      while (true) {
        const outstanding = records(await rpc(host, "getAsyncTasks", { id: host.agentId }, requestSignal));
        const health = object(await (await fetch(`${host.url}/health`, { signal: requestSignal })).json());
        if (!outstanding.length && health.isBusy !== true) break;
        await delay(350, undefined, { signal: requestSignal });
      }
      confirmed = true;
      const transcript = records(await rpc(host, "getAgentTranscript", { id: host.agentId }, requestSignal)).filter(entry => !priorIds.has(entry.id));
      const trays = records(await rpc(host, "getTrays", {}, requestSignal));
      const failure = trays.find(entry => entry.kind === "error" && (entry.agentId == null || entry.agentId === host.agentId) && oldTrays.get(entry.id) !== JSON.stringify(entry));
      if (failure) throw new RuntimeExecutionError("failed", `${String(failure.title)}: ${String(failure.detail)}`);
      const outline = records(await rpc(host, "getConversationOutline", { id: host.agentId }, requestSignal));
      const failedTool = outline.find(entry => !oldOutline.has(entry.id) && entry.kind === "tool-call" && entry.status === "failed");
      if (failedTool) throw new RuntimeExecutionError("failed", `Tool failed: ${String(failedTool.name)}`);
      if (requiresInput(transcript)) throw new RuntimeExecutionError("needs_input", "Bot is waiting for user input");
      const text = visibleText(transcript);
      if (!text.trim()) throw new RuntimeExecutionError("failed", "Turn ended without a visible response");
      const result = { text, transcript };
      await durableJson(receiptPath, { digest: inputDigest, status: "succeeded", result } satisfies RunReceipt);
      await rm(activePath);
      return result;
    } catch (error) {
      const resolved = waiting ? new RuntimeExecutionError("needs_input", "Bot is waiting for approval; this execution was stopped")
        : signal.aborted ? new RuntimeExecutionError("cancelled", "Execution stopped; external effects require reconciliation before this bot runs again")
        : error instanceof RuntimeExecutionError ? error
        : new RuntimeExecutionError("uncertain", processStopped ? "Runtime process exited during execution" : monitorFailure ? "Runtime health became unavailable" : `Execution result is uncertain: ${error instanceof Error ? error.message : String(error)}`);
      // Process cleanup must not depend on a writable receipt directory. If a
      // disk/permission error prevents the receipt update, keep the old running
      // receipt and active fence, but still stop the owned runtime first.
      await this.stopHost(input.bot.id, host);
      await durableJson(receiptPath, { digest: inputDigest, status: resolved.code, message: resolved.message } satisfies RunReceipt);
      // A definite completed failure is safe to inspect and continue. Anything interrupted stays fenced.
      if (confirmed && resolved.code === "failed") await rm(activePath);
      throw resolved;
    } finally {
      settled = true;
      requestAbort.abort();
      await monitor;
      host.child.off("exit", onExit);
      host.child.off("error", onExit);
    }
  }

  private async ensureHost(bot: RuntimeBot, botRoot: string, signal: AbortSignal): Promise<HostProcess> {
    const current = this.hosts.get(bot.id);
    if (current && current.child.exitCode === null && current.child.signalCode === null) return current;
    await mkdir(botRoot, { recursive: true, mode: 0o700 });
    const sandRoot = path.join(botRoot, "host");
    await mkdir(sandRoot, { recursive: true, mode: 0o700 });
    const description = [bot.description, "", "Server execution environment:",
      `This Bot runs on ${process.platform}, separately from the user's Mac client.`,
      `Your persistent shell working directory is ${path.join(sandRoot, "box-workspace")}.`,
      "Use relative paths or this actual directory in shell command text. /workspace is a virtual alias accepted by tool path and working_directory arguments; it is not a mounted path in shell commands.",
      "This server currently provides shell and file tools without a graphical desktop. It does not have access to the client's screen or files unless the user has separately provided them.",
    ].join("\n");
    const mappingPath = path.join(botRoot, "agent.json");
    const mapping = object(await readJson(mappingPath));
    const avatar = {
      ...(bot.avatarColor === undefined ? {} : { avatarColor: bot.avatarColor }),
      ...(bot.avatarShape === undefined ? {} : { avatarShape: bot.avatarShape }),
    };
    const syncProfile = async (agentId: string): Promise<boolean> => {
      if (!/^[a-f0-9-]{36}$/.test(agentId)) throw new Error("Invalid persisted Bot agent identity");
      const profilePath = path.join(sandRoot, "agents", agentId, "profile.json");
      const profile = object(await readJson(profilePath));
      if (profile.name === bot.name.trim() && profile.description === description.trim()
        && Object.entries(avatar).every(([key, value]) => profile[key] === value)) return false;
      await durableJson(profilePath, { ...profile, name: bot.name.trim(), description: description.trim(), ...avatar });
      return true;
    };
    // Profile changes in a live desktop Host enqueue an autonomous model turn.
    // Configure the stopped Host before its file watchers and runners start.
    if (typeof mapping.agentId === "string") await syncProfile(mapping.agentId);
    const settingsPath = path.join(sandRoot, "settings.json");
    const settings = object(await readJson(settingsPath));
    await durableJson(settingsPath, { ...settings, ...this.options.settings, version: 1, autoUpdateWhenIdleOptIn: false, egressTunnelEnabled: false });
    const token = randomBytes(32).toString("base64url");
    const daemonToken = randomBytes(32).toString("base64url");
    const daemonPort = await availableLoopbackPort();
    throwIfAborted(signal);
    const logHandle = await open(path.join(botRoot, "host.log"), "a", 0o600);
    const child = spawn(process.execPath, [path.resolve(this.options.hostEntry)], {
      cwd: botRoot, detached: process.platform !== "win32",
      env: { ...runtimeEnvironment(this.options.env), SAND_DATA_ROOT: sandRoot, SAND_GATEWAY_BIND_HOST: "127.0.0.1", SAND_GATEWAY_TOKEN: token,
        SAND_BOX_EXEC_DAEMON_PORT: String(daemonPort), SAND_BOX_EXEC_DAEMON_AUTH_TOKEN: daemonToken, SAND_DISABLE_SEND_ACCEPT_RETURN: "1" },
      stdio: ["ignore", logHandle.fd, logHandle.fd, "ipc"],
    });
    let spawnError: Error | undefined;
    const stopped = new Promise<void>(resolve => {
      child.once("exit", () => resolve());
      child.once("error", error => { spawnError = error; resolve(); });
    });
    await logHandle.close();
    const host: HostProcess = { child, stopped, url: "", token, agentId: "" };
    this.hosts.set(bot.id, host);
    try {
      const timeout = Date.now() + 45_000;
      while (true) {
        throwIfAborted(signal);
        if (spawnError || child.exitCode !== null || child.signalCode !== null) throw spawnError ?? new Error(`Host startup exited; inspect ${path.join(botRoot, "host.log")}`);
        const discovery = object(await readJson(path.join(sandRoot, "gateway.json")));
        if (discovery.pid === child.pid && discovery.token === token && Number.isInteger(discovery.port)) {
          host.url = `http://127.0.0.1:${String(discovery.port)}`;
          break;
        }
        if (Date.now() > timeout) throw new Error(`Host startup timed out; inspect ${path.join(botRoot, "host.log")}`);
        await delay(100, undefined, { signal });
      }
      const agents = records(await rpc(host, "listAgents", {}, signal));
      if (typeof mapping.agentId === "string") {
        if (!agents.some(agent => agent.id === mapping.agentId)) throw new Error("Persisted Bot agent is missing; refusing to replace its identity");
        host.agentId = mapping.agentId;
      } else if (agents.length === 1 && typeof agents[0]?.id === "string") {
        // Recover the narrow createAgent -> local mapping crash window inside this Bot-only host.
        host.agentId = agents[0].id;
      } else if (agents.length > 0) throw new Error("Ambiguous Bot identity; refusing to choose another agent");
      else {
        const result = object(await rpc(host, "createAgent", { name: bot.name, description, ...avatar, clientNonce: `bot:${bot.id}`, isIntroductionSuppressed: true }, signal));
        const agent = object(result.agent);
        if (typeof agent.id !== "string") throw new Error("Runtime did not return an agent identity");
        host.agentId = agent.id;
      }
      await durableJson(mappingPath, { botId: bot.id, agentId: host.agentId });
      if (typeof mapping.agentId !== "string") {
        // First boot may materialize the Host's default agent. Keep that identity,
        // but stop it before configuring its profile so no untracked rename turn
        // can execute tools before the controller's durable run receipt exists.
        await this.stopHost(bot.id, host);
        await syncProfile(host.agentId);
        return this.ensureHost(bot, botRoot, signal);
      }
      return host;
    } catch (error) {
      await this.stopHost(bot.id, host);
      throw error;
    }
  }

  private stopHost(botId: string, host: HostProcess): Promise<void> {
    if (host.stop) return host.stop;
    host.stop = (async () => {
      const send = async (signal: NodeJS.Signals) => {
        if (!host.child.pid) return;
        await signalOwnedRuntime(host.child.pid, signal);
      };
      if (host.child.exitCode === null && host.child.signalCode === null) host.child.kill("SIGTERM");
      const grace = new AbortController();
      await Promise.race([host.stopped, delay(5_000, undefined, { signal: grace.signal }).catch(() => {})]);
      grace.abort();
      // If the Host crashed, its daemon may still be alive. Let that daemon reap its
      // separately grouped shell commands before forcing the Host group down.
      if (host.child.pid && process.platform !== "win32") {
        let groupAlive = false;
        try { process.kill(-host.child.pid, 0); groupAlive = true; } catch {}
        if (groupAlive) { await send("SIGTERM"); await delay(1_500); }
      }
      // The Host can exit before descendants do; always clear the entire owned group.
      await send("SIGKILL");
      await host.stopped;
      if (this.hosts.get(botId) === host) this.hosts.delete(botId);
    })();
    return host.stop;
  }

  close(): Promise<void> {
    this.closePromise ??= (async () => {
      this.closing.abort();
      await Promise.allSettled([...this.queues.values()]);
      await Promise.all([...this.hosts].map(([id, host]) => this.stopHost(id, host)));
    })();
    return this.closePromise;
  }
}
