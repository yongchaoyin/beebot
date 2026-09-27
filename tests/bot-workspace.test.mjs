import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const directory = await mkdtemp(path.join(os.tmpdir(), "beebot-workspaces-"));
after(() => rm(directory, { recursive: true, force: true }));
const source = `
export * from './source/host/box/agent-workspace.ts';
export * from './source/host/box/shared-desktop-sand-box.ts';
export {BoxFileUnreadableError} from './source/host/box/box-transfer.ts';
export {createContext} from './source/packages/context/core.ts';
export {shellExecutorResource} from './source/packages/agent-exec/shell.ts';
export {shellStreamExecutorResource} from './source/packages/agent-exec/shell-stream.ts';
export {backgroundShellExecutorResource} from './source/packages/agent-exec/background-shell.ts';
export {readExecutorResource} from './source/packages/agent-exec/read.ts';
export {workingDirectoryResource} from './source/packages/agent-exec/working-directory.ts';
export {ShellArgs} from './source/packages/proto/generated/agent/v1/shell_exec_pb.ts';
export {BackgroundShellSpawnArgs} from './source/packages/proto/generated/agent/v1/background_shell_exec_pb.ts';
export {ReadArgs} from './source/packages/proto/generated/agent/v1/read_exec_pb.ts';
export {createShellTool} from './source/packages/agent/tools/core/shell/create-shell-tool.ts';
export {createPromptCollectorGlue} from './source/host/runner/prompt-collector-glue.ts';
`;
await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", target: "node26", outfile: path.join(directory, "runtime.mjs"), packages: "external" });
// Resolve dependencies from the repository while keeping all fixture data temporary.
const { symlink } = await import("node:fs/promises");
await symlink(path.join(process.cwd(), "node_modules"), path.join(directory, "node_modules"));
const r = await import(pathToFileURL(path.join(directory, "runtime.mjs")));
const ctx = r.createContext();
const bytes = value => new TextEncoder().encode(JSON.stringify(value));

test("new Bots keep distinct workspaces across solo/group use and restoration; legacy paths remain stable", async () => {
  let saved = bytes({ assignments: { legacy: 2 }, tokens: { legacy: "fixture-owner" } });
  const calls = [];
  const inner = {
    maxWindows: () => 10,
    downloadFile: async (_ctx, _id, name) => { calls.push(name); return saved; },
    uploadFile: async (_ctx, _id, name, data) => { calls.push(name); saved = data; },
    ensureReady: async () => ({ remoteAccessor: {}, vncUrl: "primary" }),
    ensureWindow: async (_ctx, _id, index) => ({ windowIndex: index, computerUse: {}, vncUrl: `display-${index}` }),
  };
  const options = { persistAssignments: true, assignmentsPath: "/home/box/sand-data/local-linux-state/window-assignments.json" };
  const box = new r.SharedDesktopSandBox(inner, options);
  await Promise.all([box.ensureReady(ctx, "legacy"), box.ensureReady(ctx, "new-a"), box.ensureReady(ctx, "new-b")]);
  await box.flushPersistence();
  assert.equal(box.getAgentWorkspacePath("legacy"), "/workspace");
  assert.notEqual(box.getAgentWorkspacePath("new-a"), box.getAgentWorkspacePath("new-b"));
  assert.notEqual(box.getAgentWindowIndex("new-a"), box.getAgentWindowIndex("new-b"));
  const restored = new r.SharedDesktopSandBox(inner, options);
  await restored.ensureReady(ctx, "new-a");
  assert.equal(restored.getAgentWorkspacePath("new-a"), box.getAgentWorkspacePath("new-a"));
  assert.equal(restored.getAgentWindowIndex("new-a"), box.getAgentWindowIndex("new-a"));
  await restored.flushPersistence();
  assert.ok(calls.every(name => name === options.assignmentsPath));
});

test("assignment configuration rejects relative paths; IDs cannot choose workspace paths", () => {
  assert.throws(() => r.desktopAssignmentsPath({ BEEBOT_DESKTOP_ASSIGNMENTS_PATH: "../state" }), /absolute/);
  assert.equal(r.desktopAssignmentsPath({}), "/home/box/.sand-window-assignments.json");
  assert.match(r.agentWorkspacePath("../../other\nBot"), /^\/workspace\/bots\/[a-f0-9]{64}$/);
  const parsed = r.parseAssignments(bytes({ assignments: { a: 2, "": 3 }, workspaces: { a: "/root" } }), 10);
  assert.equal(parsed.workspaces.get("a"), "/workspace");
  assert.equal(parsed.assignments.has(""), false);
});

test("all legacy Bots sharing the primary seat keep their old workspace when seats migrate", async () => {
  let saved = bytes({ assignments: { legacyA: 1, legacyB: 1 } });
  const decorated = [];
  const inner = {
    maxWindows: () => 4,
    downloadFile: async () => saved,
    uploadFile: async (_ctx, _id, _name, data) => { saved = data; },
    ensureReady: async () => ({ remoteAccessor: {}, vncUrl: "primary" }),
    ensureWindow: async (_ctx, _id, index) => ({ windowIndex: index, computerUse: {}, vncUrl: `display-${index}` }),
  };
  const box = new r.SharedDesktopSandBox(inner, { persistAssignments: true, decorateAccessor(accessor, workspace) { decorated.push(workspace); return accessor; } });
  await box.ensureReady(ctx, "legacyA");
  await box.ensureReady(ctx, "legacyB");
  await box.flushPersistence();
  assert.deepEqual(decorated, ["/workspace", "/workspace"]);
  assert.notEqual(box.getAgentWindowIndex("legacyA"), box.getAgentWindowIndex("legacyB"));
  const restored = new r.SharedDesktopSandBox(inner, { persistAssignments: true });
  await restored.ensureAssignmentsLoaded(ctx);
  assert.equal(restored.getAgentWorkspacePath("legacyA"), "/workspace");
  assert.equal(restored.getAgentWorkspacePath("legacyB"), "/workspace");
});

test("foreground/background/read use the same Bot workspace and retain explicit shared paths", async () => {
  const seen = [];
  const base = { get(resource) {
    return { async execute(_ctx, args) { seen.push({ resource, args }); return { result: { case: "success", value: { exitCode: 0 } } }; } };
  } };
  const workspace = r.agentWorkspacePath("a");
  const scoped = r.withAgentWorkspace(base, workspace);
  const original = new r.ShellArgs({ command: "pwd" });
  await scoped.get(r.shellExecutorResource).execute(ctx, original);
  await scoped.get(r.backgroundShellExecutorResource).execute(ctx, new r.BackgroundShellSpawnArgs({ command: "pwd" }));
  await scoped.get(r.readExecutorResource).execute(ctx, new r.ReadArgs({ path: "result.txt" }));
  await scoped.get(r.shellExecutorResource).execute(ctx, new r.ShellArgs({ command: "pwd", workingDirectory: "/workspace/shared" }));
  assert.equal(original.workingDirectory, "");
  assert.equal(seen[1].args.workingDirectory, workspace);
  assert.equal(seen[2].args.workingDirectory, workspace);
  assert.equal(seen[3].args.path, `${workspace}/result.txt`);
  assert.equal(seen[4].args.workingDirectory, "/workspace/shared");
  assert.equal(await scoped.get(r.workingDirectoryResource).resolve(ctx, "nested"), `${workspace}/nested`);
});

test("two Bots executing the same filename do not overwrite each other (real shell, temporary mapped filesystem)", async () => {
  const root = path.join(directory, "filesystem");
  await mkdir(root);
  const run = promisify(execFile);
  const base = { get() { return { async execute(_ctx, args) {
    const command = args.command.replaceAll("/workspace", root);
    const cwd = args.workingDirectory.replace("/workspace", root);
    const result = await run("/bin/bash", ["-c", command], { cwd });
    return { result: { case: "success", value: { exitCode: 0, ...result } } };
  } }; } };
  for (const id of ["a", "b"]) {
    const scoped = r.withAgentWorkspace(base, r.agentWorkspacePath(id));
    await scoped.get(r.shellExecutorResource).execute(ctx, new r.ShellArgs({ command: `printf '${id}' > result.txt` }));
  }
  assert.equal(await readFile(r.agentWorkspacePath("a").replace("/workspace", root) + "/result.txt", "utf8"), "a");
  assert.equal(await readFile(r.agentWorkspacePath("b").replace("/workspace", root) + "/result.txt", "utf8"), "b");
});

test("execution guidance does not advertise a GUI or private credentials on headless Node", () => {
  for (const flags of [{}, { isComputerUseSubagent: true }, { isBrowserUseSubagent: true }]) {
    const glue = r.createPromptCollectorGlue({ remoteBoxHasDesktop: false, ...flags });
    assert.match(glue.getRemoteBoxSection(), /has no graphical desktop/);
    assert.equal(glue.getComputerSection(), null);
    assert.doesNotMatch(glue.getRemoteBoxSection(), /Nothing on it touches|every agent.*browser login|box's browser|browser downloads|configured browser state|drive this.*(?:desktop|browser)/i);
    assert.match(glue.getRemoteBoxSection(), /Read and Shell share the Bot's filesystem/);
  }
  const desktop = r.createPromptCollectorGlue({ remoteBoxHasDesktop: true });
  assert.match(desktop.getRemoteBoxSection(), /box's browser share one filesystem/);
  assert.match(desktop.getRemoteBoxSection(), /configured browser state survive turns/);
});


test("the actual Shell tool resolves the Bot cwd before preflight/review", async () => {
  let reviewed;
  let executed = 0;
  const scoped = r.withAgentWorkspace({ get() { return { async execute() { executed++; } }; } }, r.agentWorkspacePath("reviewed"));
  const tool = r.createShellTool(scoped, { surface: "isolated_box", preflight: async (_ctx, request) => {
    reviewed = request;
    return { allow: false, reason: "fixture denied" };
  } });
  const args = (async function* () { yield JSON.stringify({ command: "pwd", working_directory: "nested" }); })();
  await assert.rejects(tool.execute(ctx, { emitPartialToolCall() {} }, args, { toolCallId: "review-fixture" }), /fixture denied/);
  assert.equal(reviewed.workingDirectory, `${r.agentWorkspacePath("reviewed")}/nested`);
  assert.equal(executed, 0);
});
