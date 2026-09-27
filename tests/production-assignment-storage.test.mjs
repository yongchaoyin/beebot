import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  stdin: { contents: `
    export { createProductionBoxInner } from './source/host/box/production.ts';
    export { productionBoxGeneratedPorts } from './source/host/box/generated-production.ts';
    export { agentWorkspacePath } from './source/host/box/agent-workspace.ts';
    export { createContext } from './source/packages/context/core.ts';
    export { shellExecutorResource } from './source/packages/agent-exec/shell.ts';
    export { readExecutorResource } from './source/packages/agent-exec/read.ts';
    export { ReadArgs } from './source/packages/proto/generated/agent/v1/read_exec_pb.ts';
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
  bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node26', write: false, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', '__filename', '__dirname', outputFiles[0].text)(
  createRequire(import.meta.url), module, module.exports, fileURLToPath(import.meta.url), dirname(fileURLToPath(import.meta.url)),
);
const r = module.exports;

async function fixture(t, initial) {
  const root = await mkdtemp(join(tmpdir(), 'beebot-production-assignments-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const protectedRoot = join(root, 'sand-data');
  const assignmentPath = join(protectedRoot, 'local-linux-state', 'window-assignments.json');
  await mkdir(dirname(assignmentPath), { recursive: true });
  if (initial) await writeFile(assignmentPath, JSON.stringify(initial));
  const before = process.env.BEEBOT_DESKTOP_ASSIGNMENTS_PATH;
  process.env.BEEBOT_DESKTOP_ASSIGNMENTS_PATH = assignmentPath;
  t.after(() => {
    if (before === undefined) delete process.env.BEEBOT_DESKTOP_ASSIGNMENTS_PATH;
    else process.env.BEEBOT_DESKTOP_ASSIGNMENTS_PATH = before;
  });
  const reads = [], shells = [], retries = [];
  const base = { get(resource) {
    if (resource === r.shellExecutorResource) return { async execute(_ctx, args) {
      shells.push(args.command);
      return { result: { case: 'success', value: { exitCode: 0 } } };
    } };
    if (resource === r.readExecutorResource) return { async execute(_ctx, args) {
      reads.push(args.path);
      return readFile(args.path, 'utf8');
    } };
    return resource.remoteImplementation({});
  } };
  const construct = () => {
    const box = r.createProductionBoxInner({
      protectedBoxPaths: [protectedRoot], telemetry: { reportDaemonPing() {} },
      generated: {
        // Only network/execution is a fixture; the composition and generated
        // Read guard are the actual production implementations.
        ...r.productionBoxGeneratedPorts,
        createTransport: options => options,
        createControlClient: () => ({ async ping() { return {}; } }),
        createExecClient: () => ({ async *exec() { throw new Error('Unexpected RPC'); } }),
        createResourceAccessor: () => base,
      },
    });
    // Advance the existing 30s retry policy deterministically if a regression
    // mistakenly routes trusted metadata through the model read guard.
    let now = 0;
    box.options.now = () => now;
    box.options.sleep = async ms => { retries.push(ms); now += ms; };
    t.after(() => box.dispose());
    return box;
  };
  return { root, assignmentPath, protectedRoot, reads, shells, retries, construct };
}

test('production restores protected assignment metadata while both model Read and downloads stay guarded', { timeout: 5000 }, async t => {
  const f = await fixture(t, { assignments: { legacy: 2 }, tokens: { legacy: 'fixture-owner' } });
  const box = f.construct();
  const ctx = r.createContext();
  const connection = await box.ensureReady(ctx, 'legacy');
  assert.equal(box.getAgentWorkspacePath('legacy'), '/workspace');
  assert.equal(box.getAgentWindowIndex('legacy'), 2);
  assert.deepEqual(f.retries, []);
  await assert.rejects(box.downloadFile(ctx, 'legacy', f.assignmentPath), /protected host-only store/);
  await assert.rejects(connection.remoteAccessor.get(r.readExecutorResource).execute(ctx, new r.ReadArgs({ path: f.assignmentPath })), /protected host-only store/);
  const alias = join(f.root, 'assignment-alias');
  await symlink(f.assignmentPath, alias);
  await assert.rejects(connection.remoteAccessor.get(r.readExecutorResource).execute(ctx, new r.ReadArgs({ path: alias })), /protected host-only store/);
  assert.deepEqual(f.reads, []);
  const allowed = join(f.root, 'normal.txt');
  await writeFile(allowed, 'ordinary file');
  assert.equal(await connection.remoteAccessor.get(r.readExecutorResource).execute(ctx, new r.ReadArgs({ path: allowed })), 'ordinary file');
  assert.deepEqual(f.reads, [allowed]);
});

test('production creates and atomically restores new metadata inside the protected store without model execution', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const box = f.construct();
  const ctx = r.createContext();
  await box.ensureReady(ctx, 'new-bot');
  await box.flushPersistence();
  const persisted = JSON.parse(await readFile(f.assignmentPath, 'utf8'));
  assert.equal(persisted.workspaces['new-bot'], r.agentWorkspacePath('new-bot'));
  assert.equal(persisted.assignments['new-bot'], box.getAgentWindowIndex('new-bot'));
  assert.equal(typeof persisted.tokens['new-bot'], 'string');
  const restored = f.construct();
  await restored.ensureReady(ctx, 'new-bot');
  assert.equal(restored.getAgentWorkspacePath('new-bot'), r.agentWorkspacePath('new-bot'));
  assert.equal(restored.getAgentWindowIndex('new-bot'), box.getAgentWindowIndex('new-bot'));
  assert.deepEqual(f.retries, []);
  assert.deepEqual(f.reads, []);
  assert.ok(f.shells.every(command => !command.includes(f.assignmentPath)), 'Internal metadata writes must not be sent through model shell resources');
  await assert.rejects(restored.downloadFile(ctx, 'new-bot', f.assignmentPath), /protected host-only store/);
});
