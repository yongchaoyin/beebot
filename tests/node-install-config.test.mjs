import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync, readdirSync, chmodSync, symlinkSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';

const repo = fileURLToPath(new URL('..', import.meta.url));
const root = mkdtempSync(path.join(tmpdir(), 'beebot-install-config-'));
after(() => rmSync(root, { recursive: true, force: true }));
const banner = { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' };
const configModule = path.join(root, 'config.mjs'), cli = path.join(root, 'node', 'main.mjs');
await build({ entryPoints: [path.join(repo, 'source/node/config.ts')], outfile: configModule, bundle: true, platform: 'node', format: 'esm', target: 'node26', banner });
// The real CLI, HTTP controller, auth and SQLite run here. Only task execution is a fixture.
await build({ entryPoints: [path.join(repo, 'source/node/main.ts')], outfile: cli, bundle: true, platform: 'node', format: 'esm', target: 'node26', banner,
  plugins: [{ name: 'explicit-no-model-runtime-fixture', setup(builder) {
    builder.onResolve({ filter: /^\.\/runtime\.js$/ }, args => args.importer.endsWith('/node/main.ts') ? { path: './runtime.js', external: true } : undefined);
  }}] });
writeFileSync(path.join(root, 'node', 'package.json'), '{"type":"module"}');
writeFileSync(path.join(root, 'node', 'runtime.js'), 'export class HostRuntime { async execute() { throw new Error("Task execution is not exercised by installation tests"); } async close() {} }');
mkdirSync(path.join(root, 'dist/host'), { recursive: true });
writeFileSync(path.join(root, 'dist/host/host-main.cjs'), '// availability-only fixture, not an executed Host');
const api = await import(pathToFileURL(configModule));
const key = 'fixture-only-model-credential';
function directory() { return mkdtempSync(path.join(root, 'data-')); }
function invoke(command, dir, args = [], input) {
  return spawnSync(process.execPath, [cli, command, '--data-dir', dir, ...args], { encoding: 'utf8', input, timeout: 15000, env: { PATH: process.env.PATH, HOME: root } });
}

test('repeated init reuses identical identity and refuses mismatches without rewriting', () => {
  const dir = directory(); const options = { name: 'Server A', publicUrl: 'https://a.example.test', bindHost: '0.0.0.0', tlsTermination: 'trusted-proxy' };
  const created = api.initializeOrReuseConfig(dir, options, true), before = readFileSync(path.join(dir, 'node.json'));
  assert.deepEqual(api.initializeOrReuseConfig(dir, options, true), created);
  for (const changed of [{ name: 'Server B' }, { publicUrl: 'https://b.example.test' }]) assert.throws(() => api.initializeOrReuseConfig(dir, { ...options, ...changed }, true), /refusing to overwrite/);
  assert.throws(() => api.initializeOrReuseConfig(dir, options, false));
  assert.deepEqual(readFileSync(path.join(dir, 'node.json')), before);
  assert.notEqual(api.initializeConfig(directory()).nodeId, created.nodeId);
});
test('configure-model atomically stores a private key and preserves node identity', () => {
  const dir = directory(), original = api.initializeConfig(dir);
  api.configureNodeModel(dir, 'https://model.example.test/v1', 'fixture-model', key);
  const first = api.loadConfig(dir), raw = readFileSync(path.join(dir, 'node.json'), 'utf8');
  assert.equal(first.nodeId, original.nodeId); assert.ok(!raw.includes(key));
  assert.equal(statSync(first.model.apiKeyFile).mode & 0o777, 0o600);
  assert.equal(readFileSync(first.model.apiKeyFile, 'utf8').trim(), key);
  api.configureNodeModel(dir, 'https://model.example.test/v1', 'fixture-model-2', key + '-2');
  assert.ok(existsSync(first.model.apiKeyFile), 'old key is preserved for operator-managed rollback');
  assert.notEqual(api.loadConfig(dir).model.apiKeyFile, first.model.apiKeyFile);
  assert.ok(!existsSync(path.join(dir, '.configure-model.lock')));
});
test('invalid configuration and unsafe credential directories leave config unchanged', () => {
  const dir = directory(); api.initializeConfig(dir); const before = readFileSync(path.join(dir, 'node.json'));
  assert.throws(() => api.configureNodeModel(dir, 'file:///tmp/endpoint', 'model', key));
  assert.deepEqual(readFileSync(path.join(dir, 'node.json')), before);
  assert.equal(readdirSync(path.join(dir, 'credentials')).length, 0);
  chmodSync(path.join(dir, 'credentials'), 0o755);
  assert.throws(() => api.configureNodeModel(dir, 'https://model.example.test', 'model', key), /private/);
  rmSync(path.join(dir, 'credentials'), { recursive: true }); symlinkSync(directory(), path.join(dir, 'credentials'));
  assert.throws(() => api.configureNodeModel(dir, 'https://model.example.test', 'model', key), /private/);
  assert.deepEqual(readFileSync(path.join(dir, 'node.json')), before);
});
test('CLI rejects keys in argv, accepts stdin, and doctor does not leak or claim execution', () => {
  const dir = directory(); assert.equal(invoke('init', dir).status, 0);
  const absent = invoke('doctor', dir); assert.equal(absent.status, 2, absent.stderr);
  assert.equal(JSON.parse(absent.stdout).readiness.model, 'not_configured');
  const args = ['--base-url', 'https://model.example.test/v1', '--model-id', 'fixture-model'];
  const refused = invoke('configure-model', dir, [...args, '--api-key', key]);
  assert.notEqual(refused.status, 0); assert.ok(![refused.stdout, refused.stderr].join('').includes(key));
  const configured = invoke('configure-model', dir, [...args, '--api-key-stdin'], key + '\n');
  assert.equal(configured.status, 0, configured.stderr); assert.ok(!configured.stdout.includes(key));
  const report = invoke('doctor', dir); assert.equal(report.status, 0, report.stderr);
  assert.equal(JSON.parse(report.stdout).readiness.model, 'configured_not_tested');
  assert.equal(JSON.parse(report.stdout).readiness.executionProbe, 'not_run'); assert.ok(!report.stdout.includes(key));
});

async function port() { const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const value = probe.address().port; await new Promise(resolve => probe.close(resolve)); return value; }
async function until(check, message) { for (let i = 0; i < 150; i++) { if (await check()) return; await delay(50); } throw new Error(message); }

for (const query of ['', '?source=installation-test']) test(`managed CLI setup keeps codes out of logs and removes consumed receipt (${query || 'plain route'})`, { timeout: 30000 }, async t => {
  const dir = directory(); const config = api.initializeConfig(dir); config.port = await port(); config.publicUrl = `http://127.0.0.1:${config.port}`;
  writeFileSync(path.join(dir, 'node.json'), JSON.stringify(config), { mode: 0o600 });
  const child = spawn(process.execPath, [cli, 'start', '--data-dir', dir, '--setup-output', 'file'], { env: { PATH: process.env.PATH, HOME: root }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await exited; clearTimeout(timer); } });
  const file = path.join(dir, 'setup-link.json');
  await until(() => existsSync(file), 'Setup file not created: ' + output);
  const result = invoke('setup-link', dir); assert.equal(result.status, 0, result.stderr);
  const link = result.stdout.trim(), code = new URL(link).searchParams.get('code'); assert.equal(code.length, 43); assert.ok(!output.includes(code));
  assert.equal(invoke('verify', dir).status, 0);
  const page = await fetch(link), html = await page.text(); assert.equal(page.status, 200, html);
  const fields = { flow_id: /name="flow_id" value="([^"]+)"/.exec(html)[1], csrf: /name="csrf" value="([^"]+)"/.exec(html)[1], username: 'owner', password: 'installation-test-only-passphrase' };
  const response = await fetch(config.publicUrl + '/setup' + query, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: config.publicUrl, Cookie: page.headers.get('set-cookie').split(';')[0] }, body: new URLSearchParams(fields) });
  assert.equal(response.status, 200, await response.text());
  await until(() => !existsSync(file), 'Consumed receipt not removed');
  assert.notEqual(invoke('setup-link', dir).status, 0); assert.ok(!output.includes(code));
});
