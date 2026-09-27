import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const { outputFiles } = await build({
  stdin: { contents: [
    'export * from "./source/host/local-exec/local-exec-provider.ts";',
    'export * from "./source/host/local-exec/local-exec-machine.ts";',
    'export * from "./source/host/local-exec/local-tool-approvals.ts";',
    'export * from "./source/host/local-exec/local-exec-daemon.ts";',
    'export * from "./source/host/extensions/local-exec/local-exec-bridge.ts";',
    'export * from "./source/host/extensions/local-exec/gateway-local-exec-sand-box.ts";',
    'export * from "./source/shared/local-tool-permission-machinery.ts";',
    'export * from "./source/shared/node/local-shell-directory.ts";',
    'export * from "./source/local-exec-daemon/production-executor.ts";',
    'export * from "./source/packages/context/core.ts";',
  ].join('\n'), resolveDir: root, loader: 'ts' },
  bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node26', write: false, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', '__filename', '__dirname', outputFiles[0].text)(
  createRequire(import.meta.url), module, module.exports, fileURLToPath(import.meta.url), dirname(fileURLToPath(import.meta.url)),
);
const api = module.exports;
const collect = async iterable => { const result = []; for await (const item of iterable) result.push(item); return result; };
const shell = (workingDirectory, type = 'shellStreamArgs') => ({ id: 1, message: { case: type, value: { command: 'fixture-command', ...(workingDirectory === undefined ? {} : { workingDirectory }) } } });
const frame = (requestId = 'request', workingDirectory = '') => ({ kind: 'exec', requestId, serverMessage: shell(workingDirectory) });

function providerFixture(t, { permission, execute } = {}) {
  const seen = { executions: [], cancellations: [], outputs: [], counts: [] };
  const provider = new api.SandLocalExecProvider({
    root: '/fixture-root',
    resolveConnection: async () => { throw new Error('No network is permitted in this fixture'); },
    fetch: async () => { throw new Error('No network is permitted in this fixture'); },
    isLocalUseBlocked: permission,
    onInflightChange: value => seen.counts.push(value),
    executor: {
      decodeServerMessage: value => structuredClone(value),
      async *execute(message, signal) {
        seen.executions.push({ message, signal });
        if (execute) yield* execute(message, signal);
        else yield { kind: 'control', message: { finished: true } };
      },
      cancel: id => seen.cancellations.push(id),
      throwControl: error => ({ error }),
    },
  });
  // Capture the existing transport boundary; no server or production profile.
  provider.enqueue = value => seen.outputs.push(value);
  t.after(() => provider.close());
  return { provider, seen };
}

for (const kind of ['exec', 'upload', 'download']) {
  test(`cancel during asynchronous ${kind} permission checking prevents execution`, { timeout: 5000 }, async t => {
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    const { provider, seen } = providerFixture(t, { permission: async () => { entered.resolve(); return release.promise; } });
    const request = kind === 'exec' ? frame() : { kind, requestId: 'request', path: '/fixture-root/never-opened', bytesBase64: '' };
    const pending = provider.handleRequest(request);
    await entered.promise;
    await provider.handleRequest({ kind: 'cancel', requestId: 'request' });
    release.resolve(undefined);
    await pending;
    assert.equal(seen.executions.length, 0);
    assert.deepEqual(seen.outputs, []);
    assert.deepEqual(seen.cancellations, []);
    assert.equal(provider.pendingAuthorizations.size, 0);
  });
}

test('closing a provider while permission is pending does not start the command', { timeout: 5000 }, async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const { provider, seen } = providerFixture(t, { permission: async () => { entered.resolve(); return release.promise; } });
  const pending = provider.handleRequest(frame());
  await entered.promise;
  provider.close();
  release.resolve(undefined);
  await pending;
  assert.equal(seen.executions.length, 0);
});

test('permission rejection executes nothing; success remains once and ongoing cancellation reaches executor', { timeout: 5000 }, async t => {
  let allowed = false;
  const started = Promise.withResolvers();
  const { provider, seen } = providerFixture(t, {
    permission: () => allowed ? undefined : 'declined',
    execute: async function* (_message, signal) {
      started.resolve();
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    },
  });
  await provider.handleRequest(frame('denied'));
  assert.equal(seen.executions.length, 0);
  assert.equal(seen.outputs[0].message.error, 'declined');
  allowed = true;
  const pending = provider.handleRequest(frame('running'));
  await started.promise;
  await provider.handleRequest(frame('running'));
  assert.equal(seen.executions.length, 1);
  assert.equal(seen.executions[0].signal.aborted, false);
  await provider.handleRequest({ kind: 'cancel', requestId: 'running' });
  await pending;
  assert.equal(seen.executions[0].signal.aborted, true);
  assert.deepEqual(seen.cancellations, [seen.executions[0].message.id]);
  assert.deepEqual(seen.counts, [1, 0]);
});

test('a duplicate arriving during approval cannot start another command', { timeout: 5000 }, async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const { provider, seen } = providerFixture(t, { permission: async () => { entered.resolve(); return release.promise; } });
  const pending = provider.handleRequest(frame());
  await entered.promise;
  await provider.handleRequest(frame());
  release.resolve(undefined);
  await pending;
  assert.equal(seen.executions.length, 1);
  assert.equal(seen.outputs.length, 1);
  assert.deepEqual(seen.cancellations, []);
});

function bridgeFixture() {
  const sent = [];
  let id = 0;
  const bridge = new api.SandLocalExecBridge({ clock: { now: () => 1 }, blockedReason: () => undefined,
    responseWatchdog: { arm: () => ({ kick() {}, dispose() {} }) }, randomId: () => `id-${++id}` });
  bridge.registerProvider(value => sent.push(value));
  bridge.submitResponses({ providerId: sent[0].providerId, frames: [{ kind: 'hello', localRoot: '/fixture-root', terminalsFolder: '/fixture-root/terminals' }] });
  sent.length = 0;
  return { bridge, sent };
}

test('bridge sends no execution for a signal cancelled before dispatch, and keeps active cancellation', async () => {
  const { bridge, sent } = bridgeFixture();
  const cancelled = new AbortController(); cancelled.abort();
  assert.deepEqual(await collect(bridge.request({ signal: cancelled.signal }, { kind: 'exec' })), []);
  assert.deepEqual(sent, []);
  assert.equal(bridge.pending.size, 0);
  const controller = new AbortController();
  const active = collect(bridge.request({ signal: controller.signal }, { kind: 'exec' }));
  assert.equal(sent[0].kind, 'exec');
  controller.abort();
  await active;
  assert.deepEqual(sent.map(value => value.kind), ['exec', 'cancel']);
  assert.equal(sent[0].requestId, sent[1].requestId);
  assert.equal(bridge.pending.size, 0);
});

test('approval binds normalized actual directory and command, retaining terminal attachment permission', () => {
  const describe = (cwd, root = '/root', type) => api.describeLocalExec(shell(cwd, type), '/root/terminals', root);
  const original = describe('project/../one');
  assert.equal(original.target, 'Working directory: "/root/one"\n\nfixture-command');
  assert.equal(api.localToolApprovalCovers(original, describe('/root/one')), true);
  assert.equal(api.localToolApprovalCovers(original, describe('two')), false);
  assert.equal(api.localToolApprovalCovers(describe(''), describe('', '/other-root')), false);
  assert.equal(api.localToolApprovalCovers({ action: 'run-command', target: 'fixture-command' }, original), false);
  assert.equal(describe('').target, describe('/root').target);
  assert.equal(original.target, describe('one', '/root', 'backgroundShellSpawnArgs').target);
  assert.equal(describe('one', '/root', 'backgroundShellSpawnArgs').outlivesScope, true);
  assert.equal(api.localToolApprovalCovers(original, api.describeLocalExec({ message: { case: 'forceBackgroundShellArgs', value: {} } }, '/root/terminals')), true);
  assert.equal(api.localToolApprovalCovers(original, api.describeLocalExec({ message: { case: 'readArgs', value: { path: '/root/terminals/3.txt' } } }, '/root/terminals')), true);
  assert.equal(api.describeLocalExec(shell('relative'), '/root/terminals'), undefined);
});

test('directory normalization uses target platform rather than Host platform', () => {
  assert.equal(api.resolveLocalShellDirectory('/Users/bot', '../shared'), '/Users/shared');
  assert.equal(api.resolveLocalShellDirectory('C:\\Users\\bot', '..\\shared'), 'C:\\Users\\shared');
  assert.equal(api.resolveLocalShellDirectory('C:\\Users\\bot', '\\shared'), 'C:\\shared');
  assert.equal(api.resolveLocalShellDirectory('C:\\Users\\bot', 'D:relative'), undefined);
  assert.equal(api.resolveLocalShellDirectory('\\\\server\\share\\bot', '..\\shared'), '\\\\server\\share\\shared');
});

test('Host gateway and Mac provider ask about identical actual directories without changing wire format', async t => {
  const { bridge } = bridgeFixture();
  const asks = [], received = [];
  const { provider, seen } = providerFixture(t, { permission: ({ describes }) => { received.push(describes); return undefined; } });
  bridge.request = async function* (_context, value) {
    await provider.handleRequest({ ...value, requestId: 'gateway' });
    yield { kind: 'control', message: { case: 'streamClose' } };
  };
  const manager = new api.GatewayLocalExecManager(bridge, {
    blockedReason: () => undefined, requiresApproval: () => true,
    authorize: async (_scope, request) => { asks.push(request); return { allowed: true, reason: '', approvalId: 'fixture-approval' }; },
  }, () => '/fixture-root/terminals', { decodeClient: value => value, decodeControl: value => value });
  for (const cwd of ['', 'project', '/other-absolute']) {
    await collect(manager.createExecInstance(api.createContext(), () => ({ ...shell(cwd), toJson() { return shell(cwd); } })));
  }
  assert.equal(seen.executions.length, 3);
  assert.deepEqual(asks.map(value => value.target), received.map(value => value.target));
  assert.deepEqual(asks.map(value => value.target.split('\n')[0]), [
    'Working directory: "/fixture-root"', 'Working directory: "/fixture-root/project"', 'Working directory: "/other-absolute"',
  ]);
});

test('existing approval persistence retains the command-and-cwd target exactly', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'beebot-local-approval-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'approvals.json');
  const approval = { id: 'fixture', ...api.describeLocalExec(shell('/root/a\n"b'), '/root/terminals', '/root') };
  await api.recordLocalToolApproval(approval, path);
  const restored = (await api.readLiveLocalToolApprovals(path, join(directory, 'retired.json'))).get('fixture');
  assert.equal(restored.target, approval.target);
  assert.equal(api.localToolApprovalCovers(restored, approval), true);
  assert.equal(api.localToolApprovalCovers(restored, api.describeLocalExec(shell('/root/a'), '/root/terminals', '/root')), false);
});

test('actual daemon permission check refuses cwd changes while preserving ask/always/never and running-terminal access', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'beebot-local-permission-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const approvalsPath = join(directory, 'approvals.json');
  const terminalsFolder = '/fixture-root/terminals';
  const approval = { id: 'approved', ...api.describeLocalExec(shell('one'), terminalsFolder, '/fixture-root') };
  await api.recordLocalToolApproval(approval, approvalsPath);
  let permission = 'ask', providerOptions;
  const daemon = await api.runLocalExecDaemon({
    publishDiscovery: false,
    approvalsPath, retirementsPath: join(directory, 'retirements.json'),
    connectionPath: join(directory, 'connection.json'), credentialPath: join(directory, 'credential.json'),
    supervisorHeartbeatPath: join(directory, 'heartbeat.json'), discoveryPath: join(directory, 'discovery.json'),
    settingsStore: { getLocalToolPermission: () => permission }, executor: {},
    providerFactory: options => { providerOptions = options; return { start() {}, close() {} }; },
  });
  t.after(() => daemon.close());
  const { provider, seen } = providerFixture(t, { permission: providerOptions.isLocalUseBlocked });
  await provider.handleRequest({ ...frame('right', 'one'), approvalId: 'approved' });
  assert.equal(seen.executions.length, 1);
  await provider.handleRequest({ ...frame('wrong', 'two'), approvalId: 'approved' });
  assert.equal(seen.executions.length, 1);
  assert.match(seen.outputs.at(-1).message.error, /not approved/);
  const rootChanged = api.describeLocalExec(shell('one'), terminalsFolder, '/different-root');
  assert.match(await providerOptions.isLocalUseBlocked({ approvalId: 'approved', describes: rootChanged, terminalsFolder }), /not approved/);
  const followup = api.describeLocalExec({ message: { case: 'forceBackgroundShellArgs', value: {} } }, terminalsFolder);
  assert.equal(await providerOptions.isLocalUseBlocked({ approvalId: 'approved', describes: followup, terminalsFolder }), undefined);
  permission = 'always';
  await provider.handleRequest(frame('always', 'two'));
  assert.equal(seen.executions.length, 2);
  permission = 'never';
  await provider.handleRequest({ ...frame('never', 'one'), approvalId: 'approved' });
  assert.equal(seen.executions.length, 2);
  assert.match(seen.outputs.at(-1).message.error, /turned off/);
});

test('directory validation never falls back, including omitted cwd when the root is absent', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'beebot-local-cwd-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'project'));
  await writeFile(join(directory, 'file'), 'fixture');
  for (const requested of ['missing', 'file']) {
    await assert.rejects(api.resolveShellWorkingDirectory({ root: directory, requested }), /Nothing ran/);
  }
  await assert.rejects(api.resolveShellWorkingDirectory({ root: join(directory, 'absent'), requested: '' }), /Nothing ran/);
  assert.deepEqual(await api.resolveShellWorkingDirectory({ root: directory, requested: '' }), { workingDirectory: directory });
  assert.deepEqual(await api.resolveShellWorkingDirectory({ root: directory, requested: 'project' }), { workingDirectory: join(directory, 'project') });
});

for (const kind of ['shellStreamArgs', 'backgroundShellSpawnArgs']) {
  test(`production ${kind} rejects a missing cwd before creating a shell`, { timeout: 5000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'beebot-local-production-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const executor = api.createDefaultProductionLocalExecExecutor({ root: directory });
    const decoded = executor.decodeServerMessage({ id: 41, [kind]: { command: 'fixture-command-that-must-never-run', workingDirectory: join(directory, 'absent') } });
    const outputs = await collect(executor.execute(decoded, new AbortController().signal));
    const errors = outputs.filter(value => value.kind === 'control' && value.message.throw);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message.throw.error, /requested working directory.*Nothing ran/);
    assert.equal(outputs.some(value => value.kind === 'client'), false);
  });
}
