import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(path.join(os.tmpdir(), "beebot-desktop-capability-"));
after(() => rm(directory, { recursive: true, force: true }));
await build({ stdin: { contents: `
export * from './source/host/box/box-capabilities.ts';
export * from './source/host/ports/box.ts';
export {HostBox} from './source/host/extensions/forever-box/host-box.ts';
export {SharedDesktopSandBox} from './source/host/box/shared-desktop-sand-box.ts';
export {createProductionBoxInner} from './source/host/box/production.ts';
export {productionBoxGeneratedPorts} from './source/host/box/generated-production.ts';
export {createRemoteBoxResourceAccessor} from './source/host/runner/remote-box-resources.ts';
export {createComputerUseCoordination} from './source/host/runner/computer-use.ts';
export {createTurnAgentComposition} from './source/host/runner/turn-agent-composition.ts';
export {buildTurnTools} from './source/host/runner/tools/turn-toolset.ts';
export {createHostRunnerComposition} from './source/host/host-runner-composition.ts';
export {createContext} from './source/packages/context/core.ts';
export {computerUseExecutorResource} from './source/packages/agent-exec/computer-use.ts';
export {shellExecutorResource} from './source/packages/agent-exec/shell.ts';
export {RegistryResourceAccessor} from './source/packages/agent-exec/resource-provider.ts';
`, resolveDir: repoRoot, loader: "ts" }, bundle: true, platform: "node", format: "esm", target: "node26", packages: "external", outfile: path.join(directory, "runtime.mjs") });
await symlink(path.join(repoRoot, "node_modules"), path.join(directory, "node_modules"));
const r = await import(pathToFileURL(path.join(directory, "runtime.mjs")));
const ctx = r.createContext();

test("desktop capability is explicit, live and preserved by HostBox alongside the Bot workspace", () => {
  assert.equal(r.boxHasDesktop({ maxWindows: () => 100, isAvailable: () => true }), false);
  const inner = { desktop: false, hasDesktop() { return this.desktop; }, getAgentWorkspacePath(id) { return `/workspace/${id}`; } };
  const box = new r.HostBox(inner);
  assert.equal(box.hasDesktop(), false);
  assert.equal(box.getAgentWorkspacePath("one"), "/workspace/one");
  inner.desktop = true;
  assert.equal(box.hasDesktop(), true);
  assert.equal(new r.HostBox({}).getAgentWorkspacePath("legacy"), undefined);
  assert.equal(r.boxHasDesktop(new r.SharedDesktopSandBox({})), true);
});

test("standalone production box permits shell but rejects Computer as unavailable, not monitor exhaustion", async () => {
  let shellCalls = 0;
  const base = new r.RegistryResourceAccessor();
  base.register(r.shellExecutorResource, { async execute() { shellCalls++; return "shell-result"; } });
  base.register(r.computerUseExecutorResource, { async execute() { assert.fail("headless Computer must not reach transport"); } });
  const box = r.createProductionBoxInner({ sharedDesktop: false, protectedBoxPaths: [], telemetry: { track() {} }, generated: {
    ...r.productionBoxGeneratedPorts,
    createTransport: options => options,
    createControlClient: () => ({ async ping() {} }),
    createExecClient: () => ({}),
    createResourceAccessor: () => base,
  } });
  try {
    assert.equal(box.hasDesktop(), false);
    const ready = await box.ensureReady(ctx, "headless");
    assert.equal(ready.vncUrl, "");
    assert.equal(await ready.remoteAccessor.get(r.shellExecutorResource).execute(ctx, {}), "shell-result");
    await assert.rejects(ready.remoteAccessor.get(r.computerUseExecutorResource).execute(ctx, {}), error => {
      assert.ok(error instanceof r.SandBoxDesktopUnavailableError);
      assert.match(error.message, /no graphical desktop or browser/);
      assert.doesNotMatch(error.message, /monitor|starting|try again/i);
      return true;
    });
    assert.equal(shellCalls, 1);
    const occupied = r.productionBoxGeneratedPorts.withNoMonitorComputerUse(base);
    await assert.rejects(occupied.get(r.computerUseExecutorResource).execute(ctx, {}), r.SandBoxNoMonitorAvailableError);
  } finally { await box.dispose(); }
});

test("direct runner Computer calls fail before connecting headless Node while Shell remains usable", async () => {
  let connections = 0;
  let shellCalls = 0;
  const base = new r.RegistryResourceAccessor();
  base.register(r.shellExecutorResource, { async execute() { shellCalls++; return "shell-result"; } });
  const accessor = r.createRemoteBoxResourceAccessor({
    remoteBox: { async ensureReady() { connections++; return { remoteAccessor: base, terminalsFolder: "/tmp/fixture" }; } },
    remoteBoxHasDesktop: false,
    resolveBoxId: () => "headless", getConversationId: () => "headless",
    setRemoteBoxTerminalsFolder() {}, autoReviewGate: { assertNoPendingApproval() {}, currentModes: () => ({}) },
    computerUse: { getOrCreateNavigationProbe() { assert.fail("headless Node has no navigation baseline"); }, recordAuditIntent() {} },
    auditShellCommand() {}, probeNavigationAfterComputerUse() { assert.fail("headless Node has no navigation probe"); },
  });
  await assert.rejects(accessor.get(r.computerUseExecutorResource).execute(ctx, { actions: [] }), r.SandBoxDesktopUnavailableError);
  assert.equal(connections, 0);
  assert.equal(await accessor.get(r.shellExecutorResource).execute(ctx, { command: "pwd" }), "shell-result");
  assert.equal(connections, 1);
  assert.equal(shellCalls, 1);
});

test("unsupported desktop prewarming never invokes a browser startup shell command", async () => {
  let shells = 0;
  const remoteAccessor = new r.RegistryResourceAccessor();
  remoteAccessor.register(r.computerUseExecutorResource, r.noDesktopComputerUseExecutor);
  remoteAccessor.register(r.shellExecutorResource, { async execute() { shells++; } });
  const connection = { remoteAccessor };
  const coordinator = r.createComputerUseCoordination({ ctx, remoteBox: { async ensureReady() { return connection; } }, getConversationId: () => "one", resolveBoxId: () => "one", actionAuditor: () => undefined });
  assert.equal(await coordinator.prepareRemoteBox({ agentId: "one", boxId: "one" }), connection);
  assert.equal(await coordinator.preparationFor("one"), connection);
  assert.equal(shells, 0);
});

function toolHost(box, role = "main") {
  const tool = name => ({ name, toolIdentifier: name, description: () => name, parameters: {}, async execute() {} });
  return {
    get remoteBoxHasDesktop() { return r.boxHasDesktop(box); },
    getRemoteBoxAvailable: () => true,
    isSubagentRunner: role !== "main", isBoxScopedSubagent: role !== "main",
    isComputerUseSubagent: role === "computer", isBrowserUseSubagent: role === "browser",
    getConversationId: () => "one", cloudAgentsDisabledByTeam: () => true, spotlightEnabled: () => false,
    factories: { boxShell: () => tool("Shell"), boxRead: () => tool("Read"), sendMessage: () => tool("SendMessage"), computer: () => tool("Computer"), browser: () => [tool("browser_navigate")], screenshot: () => tool("Screenshot"), requestBoxHelp: () => tool("request_box_help") },
  };
}

for (const role of ["main", "computer", "browser"]) {
  test(`actual ${role} tool builder follows capability changes and retains shell/file tools`, () => {
    const box = { desktop: false, hasDesktop() { return this.desktop; } };
    const host = toolHost(box, role);
    const offered = () => r.buildTurnTools(host, {}).getAllTools().map(tool => tool.name);
    const desktopTool = { main: "Screenshot", computer: "Computer", browser: "browser_navigate" }[role];
    assert.ok(offered().includes("Shell"));
    assert.ok(offered().includes("Read"));
    assert.ok(!offered().includes(desktopTool));
    box.desktop = true;
    assert.ok(offered().includes(desktopTool));
    box.desktop = false;
    assert.ok(!offered().includes(desktopTool));
  });
}

test("actual subagent configuration offers computer/browser roles only for a desktop-capable box", () => {
  const box = { desktop: false, hasDesktop() { return this.desktop; } };
  const composition = r.createTurnAgentComposition({ toolHost: toolHost(box), isBrowserUseSubagentEnabled: () => true, getSubagentConfigs: () => [] });
  assert.deepEqual(composition.buildSubagentConfigsForRun(), []);
  box.desktop = true;
  assert.equal(composition.buildSubagentConfigsForRun().length, 2);
  box.desktop = false;
  assert.deepEqual(composition.buildSubagentConfigsForRun(), []);
});

test("actual solo and Group Host composition carries the live box capability into each runner", async () => {
  const box = { desktop: false, hasDesktop() { return this.desktop; } };
  const options = [];
  const composition = r.createHostRunnerComposition({
    ctx: {}, extensions: { api: name => name === "forever-box" ? { box } : {} },
    buildRunner(value) { options.push(value); return new Proxy({}, { get: () => () => {} }); },
    emitGatewayEvent() {},
  });
  try {
    const hooks = { transport: { onUpdate() {} } };
    composition.createRunner({ id: "solo", dbPath: path.join(directory, "solo.sqlite") }, hooks);
    composition.createGroupMemberRunner({ id: "peer", dbPath: path.join(directory, "group.sqlite") }, hooks, {});
    assert.equal(options.length, 2);
    for (const runner of options) assert.equal(runner.remoteBoxHasDesktop, false);
    box.desktop = true;
    for (const runner of options) assert.equal(runner.remoteBoxHasDesktop, true);
    box.desktop = false;
    for (const runner of options) assert.equal(runner.remoteBoxHasDesktop, false);
  } finally { await composition.dispose(); }
});
