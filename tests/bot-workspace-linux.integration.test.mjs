import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { build } from 'esbuild';

// Opt-in integration: actual workspace decorator and generated args -> Docker
// CLI executor -> real Linux shell/files. This is not an exec-daemon RPC or
// model/GUI test. No production container, host directory, or credentials mount.
test('real Linux: Bot defaults isolate same-name files and share explicit artifacts', {
  skip: process.env.BEEBOT_DOCKER_WORKSPACE_TEST !== '1', timeout: 45000,
}, async t => {
  const endpoint = process.env.BEEBOT_DOCKER_WORKSPACE_ENDPOINT;
  assert.ok(endpoint?.startsWith('unix:///'), 'An explicit local Docker socket is required');
  const image = process.env.BEEBOT_DOCKER_WORKSPACE_IMAGE;
  assert.ok(image, 'An existing local image with bash must be specified');
  const run = promisify(execFile);
  const docker = async args => run('docker', ['--host', endpoint, ...args], {
    timeout: 15000, maxBuffer: 1024 * 1024,
  });
  const imageId = (await docker(['image', 'inspect', '--format', '{{.Id}}', image])).stdout.trim();
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
  const name = `beebot-workspace-regression-${randomUUID()}`;
  let creationAttempted = false;
  t.after(async () => {
    if (!creationAttempted) return;
    try { await docker(['rm', '-fv', name]); }
    catch (error) { if (!/No such container/.test(error.stderr ?? '')) throw error; }
    const remaining = await docker(['ps', '-aq', '--filter', `name=^/${name}$`]);
    assert.equal(remaining.stdout.trim(), '', 'The fixture container must be removed');
  });
  creationAttempted = true;
  await docker(['run', '--pull=never', '-d', '--name', name,
    '--label', 'beebot.test=workspace-reliability', '--network', 'none', '--read-only',
    '--cap-drop=ALL', '--security-opt', 'no-new-privileges',
    '--tmpfs', '/workspace:rw,nosuid,nodev,mode=0755', '--tmpfs', '/tmp:rw,nosuid,nodev,mode=1777',
    '--env', 'HOME=/tmp', '--env', 'BASH_ENV=/dev/null', '--env', 'ENV=/dev/null',
    '--entrypoint', '/bin/sh', imageId, '-c', 'exec sleep 120']);
  assert.equal((await docker(['exec', name, 'uname', '-s'])).stdout.trim(), 'Linux');
  assert.equal((await docker(['inspect', '--format', '{{.HostConfig.NetworkMode}} {{len .HostConfig.Binds}}', name])).stdout.trim(), 'none 0');

  const { outputFiles } = await build({
    stdin: { contents: `
      export * from './source/host/box/agent-workspace.ts';
      export { createContext } from './source/packages/context/core.ts';
      export { shellExecutorResource } from './source/packages/agent-exec/shell.ts';
      export { shellStreamExecutorResource } from './source/packages/agent-exec/shell-stream.ts';
      export { backgroundShellExecutorResource } from './source/packages/agent-exec/background-shell.ts';
      export { readExecutorResource } from './source/packages/agent-exec/read.ts';
      export { ShellArgs } from './source/packages/proto/generated/agent/v1/shell_exec_pb.ts';
      export { BackgroundShellSpawnArgs } from './source/packages/proto/generated/agent/v1/background_shell_exec_pb.ts';
      export { ReadArgs } from './source/packages/proto/generated/agent/v1/read_exec_pb.ts';
    `, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
    bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node26', write: false, logLevel: 'silent',
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports, fileURLToPath(import.meta.url), dirname(fileURLToPath(import.meta.url)),
  );
  const r = module.exports;
  const ctx = r.createContext();
  const calls = [];
  const foreground = async args => {
    calls.push({ type: 'foreground', cwd: args.workingDirectory });
    const result = await docker(['exec', '-w', args.workingDirectory, name, '/bin/bash', '--noprofile', '--norc', '-c', args.command]);
    if (args.workingDirectory === '/') {
      // Assert preparation before attributing a missing cwd to the decorator.
      const status = await docker(['exec', name, 'find', '/workspace', '-maxdepth', '2', '-type', 'd']);
      t.diagnostic(`Preparation exit=0 stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}; directories: ${status.stdout.trim().replaceAll('\n', ', ')}`);
    }
    return { result: { case: 'success', value: { exitCode: 0, stdout: result.stdout, stderr: result.stderr } } };
  };
  const base = { get(resource) {
    if (resource === r.shellExecutorResource) return { execute: (_ctx, args) => foreground(args) };
    if (resource === r.shellStreamExecutorResource) return { async *execute(_ctx, args) { yield await foreground(args); } };
    if (resource === r.backgroundShellExecutorResource) return { async execute(_ctx, args) {
      calls.push({ type: 'background', cwd: args.workingDirectory });
      await docker(['exec', '-d', '-w', args.workingDirectory, name, '/bin/bash', '--noprofile', '--norc', '-c', args.command]);
      return { result: { case: 'success', value: { shellId: 'fixture' } } };
    } };
    if (resource === r.readExecutorResource) return { async execute(_ctx, args) {
      return (await docker(['exec', name, 'cat', '--', args.path])).stdout;
    } };
    return undefined;
  } };
  const a = r.withAgentWorkspace(base, r.agentWorkspacePath('fixture-bot-a'));
  const b = r.withAgentWorkspace(base, r.agentWorkspacePath('fixture-bot-b'));
  const shell = (scoped, command, workingDirectory) => scoped.get(r.shellExecutorResource).execute(ctx, new r.ShellArgs({ command, workingDirectory }));
  const read = (scoped, path) => scoped.get(r.readExecutorResource).execute(ctx, new r.ReadArgs({ path }));
  await shell(a, "printf 'A' > result.txt");
  await shell(b, "printf 'B' > result.txt");
  assert.equal(await read(a, 'result.txt'), 'A');
  assert.equal(await read(b, 'result.txt'), 'B');
  await shell(a, "printf 'team artifact' > deliverable.txt", '/workspace/shared');
  assert.equal(await read(b, '/workspace/shared/deliverable.txt'), 'team artifact');
  await a.get(r.backgroundShellExecutorResource).execute(ctx, new r.BackgroundShellSpawnArgs({
    command: "printf 'A background' > result.txt; printf done > background.done",
  }));
  await shell(a, 'for i in {1..50}; do test -f background.done && exit 0; sleep 0.05; done; exit 1');
  for await (const _ of b.get(r.shellStreamExecutorResource).execute(ctx, new r.ShellArgs({ command: "printf 'B stream' > result.txt" }))) { /* consume actual Linux completion */ }
  assert.equal(await read(a, 'result.txt'), 'A background');
  assert.equal(await read(b, 'result.txt'), 'B stream');
  // A fresh accessor (another turn / same Bot delegated context) reuses identity.
  const sameBot = r.withAgentWorkspace(base, r.agentWorkspacePath('fixture-bot-a'));
  assert.equal(await read(sameBot, 'result.txt'), 'A background');
  assert.ok(calls.some(call => call.type === 'background' && call.cwd === r.agentWorkspacePath('fixture-bot-a')));
  assert.ok(calls.some(call => call.cwd === r.agentWorkspacePath('fixture-bot-b')));
  t.diagnostic(`Linux wrapper→Docker CLI passed using existing ${imageId}; no host binds, network disabled; fixture cleanup verified`);
});
