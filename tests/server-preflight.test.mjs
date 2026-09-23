import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile, stat, symlink, chmod, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const temporary = await mkdtemp(path.join(tmpdir(), 'beebot-preflight-test-'));
async function load(name) {
  const outfile = path.join(temporary, name.replaceAll('/', '-') + '.mjs');
  await build({ entryPoints: [path.resolve('source', name + '.ts')], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  return import(pathToFileURL(outfile));
}
const { parseTarget, readHostKey, parseHostReport, summarizeHost, HOST_PROBE } = await load('client-provisioning/preflight');
const { ServerPreflight } = await load('client-provisioning/manager');
const { runBounded } = await load('client-provisioning/process');
test.after(() => rm(temporary, { recursive: true, force: true }));
const target = { host: 'node.example.test', port: 22, user: 'operator' };
const blob = Buffer.concat([Buffer.from([0,0,0,11]), Buffer.from('ssh-ed25519'), Buffer.from([0,0,0,32]), randomBytes(32)]);
const key = blob.toString('base64');
const scanned = `${target.host} ssh-ed25519 ${key}\n`;
const report = 'BEEBOT_PREFLIGHT_V1\nos=Linux\narch=x86_64\nbash=available\nengine=local_linux\ncompose=available\nhome=writable\ndiskKiB=9000000\ninstallation=absent\n';
const expectCode = code => error => error.code === code;
const ok = stdout => ({ status: 0, stdout, stderr: '' });
function fake(run, now) { return new ServerPreflight(async request => request.program.endsWith('keyscan') ? ok(scanned) : run(request), now); }

test('direct DNS/IPv4/IPv6 and explicit account/port are normalized, not shell syntax', () => {
  for (const host of ['SERVER.example.test', '127.0.0.1', '::1', '2001:db8::1']) assert.equal(parseTarget({ ...target, host }).host, host.toLowerCase());
  assert.ok(Object.isFrozen(parseTarget(target)));
  for (const host of ['-oProxyCommand=x', 'node;id', 'node x', 'n\nother', 'host,user', '10.0.0.0/24', 'ssh://host', 'a@host', 'a..test', '*.test', '', '[::1]', ' a.test']) assert.throws(() => parseTarget({ ...target, host }), expectCode('INVALID_TARGET'));
  for (const user of ['x;id', '-root', 'a@b', 'a b', '']) assert.throws(() => parseTarget({ ...target, user }), expectCode('INVALID_TARGET'));
  for (const port of [0, 65536, 2.5, '22', NaN]) assert.throws(() => parseTarget({ ...target, port }), expectCode('INVALID_TARGET'));
  for (const input of [null, [], { ...target, password: 'not-accepted' }, { ...target, command: 'id' }]) assert.throws(() => parseTarget(input), expectCode('INVALID_TARGET'));
});
test('host fingerprints use independently calculated SSH public key digest', () => {
  assert.deepEqual(readHostKey('# banner\n' + scanned + scanned), { key, fingerprint: 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '') });
  for (const input of ['', '# only a banner\n']) assert.throws(() => readHostKey(input), expectCode('NO_HOST_KEY'));
  const other = Buffer.from(blob); other[50] ^= 1;
  assert.throws(() => readHostKey(scanned + `host ssh-ed25519 ${other.toString('base64')}\n`), expectCode('AMBIGUOUS_HOST_KEY'));
  for (const input of ['ssh-rsa whatever', scanned.replace(key, 'AAAA'), scanned.replace('ssh-ed25519', 'ssh-rsa'), 'command="x" ' + scanned]) assert.throws(() => readHostKey(input), expectCode('INVALID_HOST_KEY'));
  assert.throws(() => readHostKey('x'.repeat(8193)), expectCode('OUTPUT_LIMIT'));
});
test('probe response is strict, bounded and never upgrades prerequisites to ready', () => {
  const summary = summarizeHost(parseHostReport(report));
  assert.equal(summary.status, 'prerequisites_observed'); assert.equal(summary.installed, false); assert.equal(summary.executionProbe, 'not_run');
  for (const input of [report + 'secret=x\n', 'banner\n' + report, report.replace('os=Linux', 'os=\x1b[31mLinux'), report.replace('arch=x86_64', 'os=Linux'), report.replace('diskKiB=9000000', 'diskKiB=1e9'), report.replace('diskKiB=9000000', 'diskKiB=-1'), report.trim(), report.replace('engine=local_linux', 'engine=ready'), report.replace('home=writable', '__proto__=writable'), report.replace('os=Linux', 'os=Linux\r')]) assert.throws(() => parseHostReport(input), expectCode('INVALID_REPORT'));
});
for (const [before, after, expected] of [
  ['os=Linux', 'os=Darwin', 'unsupported_platform'], ['arch=x86_64', 'arch=other', 'unsupported_platform'],
  ['bash=available', 'bash=missing', 'bash_missing'], ['engine=local_linux', 'engine=remote_context', 'docker_remote_context'],
  ['engine=local_linux', 'engine=missing', 'docker_missing'], ['engine=local_linux', 'engine=unavailable', 'docker_unavailable'],
  ['compose=available', 'compose=missing', 'compose_missing'], ['home=writable', 'home=readonly', 'home_readonly'],
  ['diskKiB=9000000', 'diskKiB=0', 'disk_low'], ['diskKiB=9000000', 'diskKiB=unknown', 'disk_unknown'],
  ...['managed_present', 'locked', 'occupied', 'symlink', 'unknown'].map(value => ['installation=absent', `installation=${value}`, `installation_${value}`]),
]) test(`preflight reports ${expected} without authorizing installation`, () => {
  const result = summarizeHost(parseHostReport(report.replace(before, after)));
  assert.equal(result.status, 'needs_attention'); assert.ok(result.blockers.includes(expected)); assert.equal(result.installed, false);
});
test('scan never authenticates; verified check pins host key and executes only static probe', async () => {
  const calls = []; let hostsPath;
  const manager = new ServerPreflight(async request => {
    calls.push(request);
    if (request.program.endsWith('keyscan')) return ok(scanned);
    const { args } = request;
    assert.equal(request.input, HOST_PROBE); assert.deepEqual(args.slice(0, 4), ['-F', '/dev/null', '-T', '-p']);
    for (const option of ['StrictHostKeyChecking=yes', 'ForwardAgent=no', 'PermitLocalCommand=no', 'ProxyCommand=none', 'ControlMaster=no', 'ControlPath=none', 'PasswordAuthentication=no', 'IdentityFile=none']) assert.ok(args.includes(option), option);
    hostsPath = JSON.parse(args.find(v => v.startsWith('UserKnownHostsFile=')).split('=').slice(1).join('='));
    assert.equal((await stat(hostsPath)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(hostsPath))).mode & 0o777, 0o700);
    assert.equal(await readFile(hostsPath, 'utf8'), `beebot-preflight,[beebot-preflight]:22 ssh-ed25519 ${key}\n`);
    return ok(report);
  });
  const challenge = await manager.scan(target);
  assert.equal(calls.length, 1); assert.equal(calls[0].input, undefined); assert.equal(challenge.key, undefined);
  const result = await manager.inspect(challenge.id, challenge.fingerprint);
  assert.equal(result.target.host, target.host); assert.equal(result.installed, false); assert.ok(result.checkedAt > 0);
  await assert.rejects(stat(hostsPath), { code: 'ENOENT' });
  await assert.rejects(manager.inspect(challenge.id, challenge.fingerprint), expectCode('EXPIRED_CHALLENGE'));
});
test('wrong, expired or cancelled confirmation does not connect', async () => {
  let now = 100, checks = 0; const manager = fake(() => { checks++; return ok(report); }, () => now);
  const challenge = await manager.scan(target);
  await assert.rejects(manager.inspect(challenge.id, 'SHA256:wrong'), expectCode('FINGERPRINT_MISMATCH'));
  await assert.rejects(manager.inspect('wrong', challenge.fingerprint), expectCode('EXPIRED_CHALLENGE'));
  now += 300000; await assert.rejects(manager.inspect(challenge.id, challenge.fingerprint), expectCode('EXPIRED_CHALLENGE'));
  const next = await manager.scan(target); manager.cancel(); await assert.rejects(manager.inspect(next.id, next.fingerprint), expectCode('EXPIRED_CHALLENGE'));
  assert.equal(checks, 0);
});
test('late scan responses cannot replace a newer server identity', async () => {
  let first; const manager = new ServerPreflight(request => request.args.includes('first.test') ? new Promise(resolve => first = resolve) : Promise.resolve(ok(scanned)));
  const old = manager.scan({ ...target, host: 'first.test' }); const fresh = await manager.scan(target);
  first(ok(scanned)); await assert.rejects(old, expectCode('CANCELLED'));
  await assert.rejects(manager.inspect(fresh.id, 'wrong'), expectCode('FINGERPRINT_MISMATCH'));
});
test('cancelled inspection cannot return success, and temporary pin is removed', async () => {
  let release, hostsPath, started; const start = new Promise(resolve => started = resolve);
  const manager = fake(request => { hostsPath = JSON.parse(request.args.find(v => v.startsWith('UserKnownHostsFile=')).slice(19)); started(); return new Promise(resolve => release = resolve); });
  const c = await manager.scan(target); const result = manager.inspect(c.id, c.fingerprint); await start;
  manager.cancel(); release(ok(report)); await assert.rejects(result, expectCode('CANCELLED')); await assert.rejects(stat(hostsPath), { code: 'ENOENT' });
});
for (const [stderr, code] of [
  ['REMOTE HOST IDENTIFICATION HAS CHANGED!', 'HOST_KEY_CHANGED'], ['Host key verification failed.', 'HOST_KEY_CHANGED'],
  ['Permission denied (publickey).', 'AUTHENTICATION_FAILED'], ['Load key "/private/key": error', 'AUTHENTICATION_FAILED'],
  ['network failed Bearer private-value', 'CONNECTION_FAILED'],
]) test(`SSH ${code} does not expose raw diagnostics or permit retrying old consent`, async () => {
  const manager = fake(() => ({ status: 255, stdout: 'setup?code=private', stderr })); const c = await manager.scan(target);
  await assert.rejects(manager.inspect(c.id, c.fingerprint), error => error.code === code && !error.message.includes('private'));
  await assert.rejects(manager.inspect(c.id, c.fingerprint), expectCode('EXPIRED_CHALLENGE'));
});
test('key selection validates private regular path and clears old confirmation', async () => {
  const dir = await mkdtemp(path.join(temporary, 'keys-')), file = path.join(dir, 'id_ed25519'); await writeFile(file, 'fixture-only', { mode: 0o600 });
  let args; const manager = fake(request => { args = request.args; return ok(report); });
  const stale = await manager.scan(target); await manager.setIdentity(file);
  await assert.rejects(manager.inspect(stale.id, stale.fingerprint), expectCode('EXPIRED_CHALLENGE'));
  const c = await manager.scan(target); await manager.inspect(c.id, c.fingerprint);
  assert.ok(args.includes('IdentityAgent=none')); assert.equal(args[args.indexOf('-i') + 1], file);
  await symlink(file, path.join(dir, 'link'));
  for (const invalid of ['relative', file + '%h', dir, path.join(dir, 'link')]) await assert.rejects(manager.setIdentity(invalid));
  await chmod(file, 0o644); await assert.rejects(manager.setIdentity(file), expectCode('INVALID_KEY_FILE'));
});
test('real bounded process limits output, times out and removes application secrets', async () => {
  const base = { program: process.execPath, signal: new AbortController().signal, timeoutMs: 5000, maxBytes: 10000 };
  process.env.BEEBOT_PREFLIGHT_SECRET_FIXTURE = 'must-not-forward';
  try {
    const result = await runBounded({ ...base, args: ['-e', 'process.stdout.write(JSON.stringify(process.env))'] });
    assert.equal(result.status, 0); assert.ok(!result.stdout.includes('must-not-forward')); assert.ok(!result.stdout.includes('BEEBOT_PREFLIGHT_SECRET_FIXTURE'));
  } finally { delete process.env.BEEBOT_PREFLIGHT_SECRET_FIXTURE; }
  await assert.rejects(runBounded({ ...base, args: ['-e', 'process.stdout.write("x".repeat(20000))'] }), expectCode('OUTPUT_LIMIT'));
  await assert.rejects(runBounded({ ...base, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 100 }), expectCode('TIMEOUT'));
  await assert.rejects(runBounded({ ...base, program: path.join(temporary, 'missing-ssh'), args: [] }), expectCode('SSH_UNAVAILABLE'));
});
test('actual child is cancelled rather than leaving a background SSH operation', async () => {
  const controller = new AbortController();
  const result = runBounded({ program: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], signal: controller.signal, timeoutMs: 5000, maxBytes: 1024 });
  controller.abort(); await assert.rejects(result, expectCode('CANCELLED'));
  await assert.rejects(runBounded({ program: process.execPath, args: [], signal: controller.signal, timeoutMs: 1000, maxBytes: 1024 }), expectCode('CANCELLED'));
});
test('actual POSIX probe leaves the selected home unchanged and does not read config or keys', async () => {
  const home = await mkdtemp(path.join(temporary, 'home-'));
  await writeFile(path.join(home, 'keep'), 'sensitive-fixture');
  const result = spawnSync('/bin/sh', ['-s'], { input: HOST_PROBE, encoding: 'utf8', env: { HOME: home, PATH: '/usr/bin:/bin' }, timeout: 5000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(parseHostReport(result.stdout).installation, 'absent');
  assert.deepEqual(await readdir(home), ['keep']); assert.ok(!result.stdout.includes('sensitive-fixture')); assert.equal(await readFile(path.join(home, 'keep'), 'utf8'), 'sensitive-fixture');
});
test('same unmodified probe detects managed/locked/foreign/symlink default directories', async () => {
  const home = await mkdtemp(path.join(temporary, 'existing-')), dir = path.join(home, '.local/share/beebot/server');
  await mkdir(dir, { recursive: true });
  const check = () => { const r = spawnSync('/bin/sh', ['-s'], { input: HOST_PROBE, encoding: 'utf8', env: { HOME: home }, timeout: 5000 }); assert.equal(r.status, 0, r.stderr); return parseHostReport(r.stdout).installation; };
  assert.equal(check(), 'occupied'); await writeFile(path.join(dir, 'installation.manifest'), 'do-not-read-this'); await writeFile(path.join(dir, 'installation.id'), 'do-not-read-this'); assert.equal(check(), 'managed_present');
  await mkdir(path.join(dir, '.install.lock')); assert.equal(check(), 'locked'); await rm(dir, { recursive: true }); await symlink(home, dir); assert.equal(check(), 'symlink');
});
test('probe never contacts a remote Docker context and uses explicit local endpoint for info', async () => {
  const home = await mkdtemp(path.join(temporary, 'docker-')), log = path.join(home, 'calls');
  for (const endpoint of ['tcp://other.test:2376', 'ssh://other.test', 'unix:///var/run/docker.sock']) {
    // Fixed shell function is a Docker fixture; the production probe is unmodified.
    const fixture = `docker() { printf '%s\\n' "$*" >> "$LOG"; case "$*" in 'context inspect '*) printf '%s\\n' "$ENDPOINT";; *'info --format '*) printf 'linux\\n';; *'compose version') return 0;; *) return 1;; esac; }\n`;
    await writeFile(log, '');
    const r = spawnSync('/bin/sh', ['-s'], { input: fixture + HOST_PROBE, encoding: 'utf8', env: { HOME: home, LOG: log, ENDPOINT: endpoint }, timeout: 5000 });
    assert.equal(r.status, 0, r.stderr); const parsed = parseHostReport(r.stdout); const calls = await readFile(log, 'utf8');
    if (endpoint.startsWith('unix:')) { assert.equal(parsed.engine, 'local_linux'); assert.match(calls, /--host unix:\/\/\/var\/run\/docker.sock info/); }
    else { assert.equal(parsed.engine, 'remote_context'); assert.doesNotMatch(calls, /info|compose/); }
    assert.doesNotMatch(calls, /pull|run |up |build|volume|prune|restart/);
  }
});
