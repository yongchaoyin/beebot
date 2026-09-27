import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, readlink, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DockerCommand } from "./local-docker-command.js";

export const LOCAL_HOME_MOUNT = "/var/lib/beebot-home";
export const LOCAL_ASSIGNMENTS_PATH = "/home/box/sand-data/local-linux-state/window-assignments.json";
export const LOCAL_BOOTSTRAP = `#!/bin/bash
set -euo pipefail
state=/var/lib/beebot-home
for pair in 'chrome-profile chrome-profile' 'cli-config cli-config' 'home-config .config'; do
  read -r bucket leaf <<< "$pair"
  mkdir -p "$state/$bucket"
  destination="/home/box/$leaf"
  if [ -L "$destination" ]; then
    [ "$(readlink "$destination")" = "$state/$bucket" ] || { echo 'Unexpected local home link; startup refused.' >&2; exit 1; }
  else
    if [ -e "$destination" ]; then
      [ -d "$destination" ] || { echo 'Unexpected local home file; startup refused.' >&2; exit 1; }
      cp -an "$destination/." "$state/$bucket/"
      rm -rf "$destination"
    fi
    ln -s "$state/$bucket" "$destination"
  fi
  chown -R box:box "$state/$bucket"
done
# The old container is stopped and the copy has been verified. Chromium's
# process/hostname singleton links cannot name a live process in this new one.
# Keep databases, WAL and the intentional shared login links unchanged.
find "$state/chrome-profile" -maxdepth 2 -type l '(' -name SingletonLock -o -name SingletonSocket -o -name SingletonCookie ')' -delete
if [ -f "$state/window-assignments.json" ]; then
  mkdir -p /home/box/sand-data/local-linux-state
  cp "$state/window-assignments.json" /home/box/sand-data/local-linux-state/window-assignments.json.bootstrap
  mv /home/box/sand-data/local-linux-state/window-assignments.json.bootstrap /home/box/sand-data/local-linux-state/window-assignments.json
  rm "$state/window-assignments.json"
fi
exec /usr/local/bin/start-sand-box "$@"
`;

export interface LocalContainer {
  readonly id: string; readonly running: boolean; readonly owned: boolean; readonly image: string;
  readonly hostSha256: string; readonly daemonSha256: string; readonly schemaVersion: string;
  readonly hasInferenceCredential: boolean;
  readonly labels: Readonly<Record<string, string>>;
}
export async function inspectLocalContainer(run: DockerCommand, name: string): Promise<LocalContainer | undefined> {
  const result = await run(["inspect", "--type", "container", "--format", "{{json .}}", name]);
  if (!result.ok) {
    if (/\bNo such (?:object|container):/i.test(result.output)) return undefined;
    throw new Error("Could not inspect the local computer; no container was changed.");
  }
  try {
    const value = JSON.parse(result.output) as { Id?: unknown; State?: { Running?: unknown }; Config?: { Image?: unknown; Labels?: Record<string, string> } };
    if (typeof value.Id !== "string" || !/^[a-f0-9]{64}$/.test(value.Id) || typeof value.Config?.Image !== "string") throw new Error();
    const labels = value.Config.Labels ?? {};
    return { id: value.Id, running: value.State?.Running === true, owned: labels["com.grok-bot.local-vm"] === "1", image: value.Config.Image,
      hostSha256: labels["com.grok-bot.local-vm.host-sha256"] ?? "", daemonSha256: labels["com.grok-bot.local-vm.box-exec-daemon-sha256"] ?? "",
      schemaVersion: labels["com.grok-bot.local-vm.schema-version"] ?? "", hasInferenceCredential: labels["com.grok-bot.local-vm.inference-credential"] === "1", labels };
  } catch { throw new Error("Docker returned invalid local computer identity; no container was changed."); }
}
export function assertLocalContainerOwned(container: LocalContainer, image: string): void {
  if (!container.owned || container.image !== image) throw new Error("Refusing to modify a local container not owned by BeeBot or using an unexpected image.");
}
export async function mutateOwnedContainer(run: DockerCommand, container: LocalContainer, image: string, operation: "stop" | "start" | "restart" | "rename", suffix: readonly string[] = []): Promise<void> {
  const current = await inspectLocalContainer(run, container.id);
  if (current == null) throw new Error("The local computer changed during this operation; retry after checking Docker.");
  assertLocalContainerOwned(current, image);
  const result = await run([operation, container.id, ...suffix]);
  if (!result.ok) throw new Error(`Could not ${operation} the owned local computer; its data was retained.`);
}
async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Local computer recovery storage must be a direct private directory.");
  await chmod(path, 0o700);
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}
async function fileManifest(root: string, relative = ""): Promise<Array<{ path: string; kind: string; sha256?: string; target?: string }>> {
  const entries: Array<{ path: string; kind: string; sha256?: string; target?: string }> = [];
  for (const name of (await readdir(join(root, relative))).sort()) {
    const path = join(relative, name), full = join(root, path), info = await lstat(full);
    if (info.isSymbolicLink()) entries.push({ path, kind: "symlink", target: await readlink(full) });
    else if (info.isDirectory()) { entries.push({ path, kind: "directory" }); entries.push(...await fileManifest(root, path)); }
    else if (info.isFile()) entries.push({ path, kind: "file", sha256: createHash("sha256").update(await readFile(full)).digest("hex") });
    else throw new Error("Local computer data contains an unsupported special file; the old container was retained.");
  }
  return entries;
}
async function copyOptional(run: DockerCommand, id: string, source: string, target: string): Promise<boolean> {
  const result = await run(["cp", `${id}:${source}`, target]);
  if (result.ok) return true;
  if (result.output.includes(`Could not find the file ${source} in container `)) return false;
  throw new Error("Could not preserve local computer data; the original container was retained.");
}

/** The original stopped container and a verified private snapshot survive replacement.
 * A crash journal blocks a fresh create instead of silently selecting empty state. */
export async function prepareLocalHomeSnapshot(args: { run: DockerCommand; old?: LocalContainer; settingsPath: string; image: string; volumePrefix?: string }): Promise<{ directory: string; volume: string; manifest: string }> {
  const root = join(dirname(args.settingsPath), "local-docker-recovery"); await privateDirectory(root);
  const directory = join(root, randomUUID()); await privateDirectory(directory);
  if (args.old != null) {
    assertLocalContainerOwned(args.old, args.image);
    const current = await inspectLocalContainer(args.run, args.old.id);
    if (current == null || current.running) throw new Error("Local computer must be stopped before preserving browser data.");
    assertLocalContainerOwned(current, args.image);
  }
  for (const [source, name] of [["/home/box/chrome-profile", "chrome-profile"], ["/home/box/cli-config", "cli-config"], ["/home/box/.config", "home-config"]] as const) {
    const target = join(directory, name);
    const persistentSource = args.old?.labels["com.beebot.local-vm.home-persistence"] === "1" ? `${LOCAL_HOME_MOUNT}/${name}` : source;
    const copied = args.old != null && await copyOptional(args.run, args.old.id, persistentSource, target);
    if (!copied) await mkdir(target, { mode: 0o700 });
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Local computer home data must be a direct directory; the original container was retained.");
  }
  if (args.old != null) {
    const path = args.old.labels["com.beebot.local-vm.home-persistence"] !== "1" ? "/home/box/.sand-window-assignments.json" : LOCAL_ASSIGNMENTS_PATH;
    const target = join(directory, "window-assignments.json");
    if (await copyOptional(args.run, args.old.id, path, target)) {
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error("Local desktop assignments are not a valid regular file; the original container was retained.");
      let value;
      try { value = JSON.parse(await readFile(target, "utf8")); } catch { throw new Error("Local desktop assignments are corrupt; the original container was retained."); }
      if (value == null || typeof value !== "object" || Array.isArray(value) || value.assignments == null || typeof value.assignments !== "object" || Array.isArray(value.assignments)) throw new Error("Local desktop assignments are corrupt; the original container was retained.");
    }
  }
  const manifest = JSON.stringify(await fileManifest(directory));
  await writeFile(`${directory}.manifest.json`, manifest, { mode: 0o600, flag: "wx" });
  return { directory, manifest, volume: `${args.volumePrefix ?? "grok-bot-local-vm"}-home-${randomUUID()}` };
}
export async function installLocalHomeSnapshot(run: DockerCommand, container: LocalContainer, image: string, snapshot: { directory: string; manifest: string }): Promise<void> {
  assertLocalContainerOwned(container, image);
  const current = await inspectLocalContainer(run, container.id);
  if (current == null || current.running) throw new Error("Replacement must remain stopped while restoring local computer data.");
  assertLocalContainerOwned(current, image);
  if (JSON.stringify(await fileManifest(snapshot.directory)) !== snapshot.manifest) throw new Error("Local computer recovery snapshot changed; startup was refused.");
  const result = await run(["cp", `${snapshot.directory}/.`, `${container.id}:${LOCAL_HOME_MOUNT}`]);
  if (!result.ok) throw new Error("Could not restore local computer data; the previous container was retained.");
  const verification = `${snapshot.directory}.restore-check`;
  await privateDirectory(verification);
  const copiedBack = await run(["cp", `${container.id}:${LOCAL_HOME_MOUNT}/.`, verification]);
  if (!copiedBack.ok || JSON.stringify(await fileManifest(verification)) !== snapshot.manifest) throw new Error("Restored local computer data did not match its recovery snapshot; startup was refused.");
  await rm(verification, { recursive: true });
}
export async function stageLocalBootstrap(settingsPath: string): Promise<string> {
  const root = join(dirname(settingsPath), "local-docker-bootstrap"); await privateDirectory(root);
  const path = join(root, `${createHash("sha256").update(LOCAL_BOOTSTRAP).digest("hex")}.sh`);
  try { if (await readFile(path, "utf8") !== LOCAL_BOOTSTRAP) throw new Error("Local computer bootstrap integrity mismatch."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await writeFile(path, LOCAL_BOOTSTRAP, { flag: "wx", mode: 0o600 }); }
  return path;
}
export function localLifecycleJournalPath(settingsPath: string): string { return join(dirname(settingsPath), "local-docker-replacement.json"); }
export async function assertNoInterruptedReplacement(settingsPath: string): Promise<void> {
  try { await lstat(localLifecycleJournalPath(settingsPath)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  throw new Error("A local computer replacement was interrupted. Its recovery record and previous container were retained; recover that operation before creating another computer.");
}
export async function writeReplacementJournal(settingsPath: string, value: unknown): Promise<void> { await atomicJson(localLifecycleJournalPath(settingsPath), value); }
export async function clearReplacementJournal(settingsPath: string): Promise<void> { await rm(localLifecycleJournalPath(settingsPath), { force: true }); }

export async function replaceLocalDockerContainer(args: {
  run: DockerCommand; settingsPath: string; image: string; name: string; old?: LocalContainer;
  createArgs(snapshot: { volume: string }, transaction: string): Promise<readonly string[]>;
  waitReady(container: LocalContainer): Promise<void>;
}): Promise<void> {
  await assertNoInterruptedReplacement(args.settingsPath);
  if (args.old != null) assertLocalContainerOwned(args.old, args.image);
  const transaction = randomUUID(), backupName = `${args.name}-previous-${transaction}`;
  let renamed = false, created: LocalContainer | undefined;
  await writeReplacementJournal(args.settingsPath, { version: 1, transaction, oldId: args.old?.id, oldWasRunning: args.old?.running ?? false, backupName });
  try {
    if (args.old?.running) await mutateOwnedContainer(args.run, args.old, args.image, "stop");
    const snapshot = await prepareLocalHomeSnapshot({ ...args, volumePrefix: args.name });
    await writeReplacementJournal(args.settingsPath, { version: 1, transaction, oldId: args.old?.id, oldWasRunning: args.old?.running ?? false, backupName, snapshot: snapshot.directory, volume: snapshot.volume });
    if (args.old != null) { await mutateOwnedContainer(args.run, args.old, args.image, "rename", [backupName]); renamed = true; }
    const result = await args.run(await args.createArgs(snapshot, transaction));
    created = await inspectLocalContainer(args.run, args.name);
    if (created?.labels["com.beebot.local-vm.transaction"] !== transaction) throw new Error("Replacement container identity could not be verified; no unrelated container was changed.");
    assertLocalContainerOwned(created, args.image);
    if (!result.ok) throw new Error("Could not create the replacement local computer.");
    await installLocalHomeSnapshot(args.run, created, args.image, snapshot);
    await mutateOwnedContainer(args.run, created, args.image, "start");
    await args.waitReady(created);
    await clearReplacementJournal(args.settingsPath);
  } catch (error) {
    try {
      if (created != null && created.labels["com.beebot.local-vm.transaction"] === transaction) {
        const live = await inspectLocalContainer(args.run, created.id);
        if (live?.running) await mutateOwnedContainer(args.run, live, args.image, "stop");
        if (live != null) await mutateOwnedContainer(args.run, live, args.image, "rename", [`${args.name}-failed-${transaction}`]);
      }
      if (args.old != null) {
        if (renamed) await mutateOwnedContainer(args.run, args.old, args.image, "rename", [args.name]);
        if (args.old.running) await mutateOwnedContainer(args.run, args.old, args.image, "start");
      }
      await clearReplacementJournal(args.settingsPath);
    } catch {
      throw new Error("Local computer replacement failed and could not be fully restored. The recovery record, previous container and data were retained; do not delete them.");
    }
    throw error;
  }
}
