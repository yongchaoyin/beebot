// Explicit opt-in via direct invocation; not part of tests/*.test.mjs.
// Requires system OpenSSH binaries. Starts an ephemeral loopback-only daemon
// as this CI user, with generated fixture keys. Never reads production keys,
// modifies ssh config/known_hosts, opens a public port, installs or uses sudo.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
const root = await mkdtemp(path.join(os.tmpdir(), 'beebot-preflight-real-'));
let daemon;
const stopped = async () => {
  if (!daemon) return;
  const child = daemon; daemon = undefined;
  if (child.exitCode === null && child.signalCode === null) {
    const exit = once(child, 'close'); child.kill('SIGTERM');
    await Promise.race([exit, delay(3000).then(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); })]);
    if (child.exitCode === null && child.signalCode === null) await exit;
  }
};
test.after(async () => { await stopped(); await rm(root, { recursive: true, force: true }); });
for (const binary of ['/usr/bin/ssh', '/usr/bin/ssh-keyscan', '/usr/bin/ssh-keygen', '/usr/sbin/sshd']) await access(binary); // Fail, not skip, when explicitly requested.
await build({ entryPoints: [path.resolve('source/client-provisioning/manager.ts')], outfile: path.join(root, 'manager.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node26' });
const { ServerPreflight } = await import(pathToFileURL(path.join(root, 'manager.mjs')));
for (const key of ['host-a', 'host-b', 'client', 'wrong-client']) execFileSync('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', path.join(root, key)], { stdio: 'pipe' });
const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening'); const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const username = os.userInfo().username;
assert.match(username, /^[a-z_][a-z0-9_-]*\$?$/i);
const target = { host: '127.0.0.1', user: username, port };
async function start(hostKey) {
  await stopped();
  const config = path.join(root, 'sshd_config');
  await writeFile(config, `Port ${port}\nListenAddress 127.0.0.1\nHostKey ${path.join(root, hostKey)}\nPidFile ${path.join(root, 'pid')}\nAuthorizedKeysFile ${path.join(root, 'client.pub')}\nAllowUsers ${username}\nStrictModes no\nUsePAM no\nPermitRootLogin prohibit-password\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPubkeyAuthentication yes\nPermitUserEnvironment no\nAllowAgentForwarding no\nAllowTcpForwarding no\nX11Forwarding no\nPrintMotd no\nLogLevel ERROR\n`, { mode: 0o600 });
  // StrictModes=no only for fixture AuthorizedKeysFile under temporary /tmp.
  // Client host verification remains production StrictHostKeyChecking=yes.
  let diagnostics = '';
  daemon = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', config], { stdio: ['ignore', 'ignore', 'pipe'] });
  daemon.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4000); });
  for (let i = 0; i < 100; i++) {
    await delay(30);
    if (daemon.exitCode !== null) throw new Error('Fixture SSH daemon did not start: ' + diagnostics);
    try { if (execFileSync('/usr/bin/ssh-keyscan', ['-T', '1', '-p', String(port), '-t', 'ed25519', '127.0.0.1'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).includes('ssh-ed25519')) return; } catch { /* bound startup polling for this fixture only */ }
  }
  throw new Error('Fixture SSH startup timed out');
}
const fingerprint = name => execFileSync('/usr/bin/ssh-keygen', ['-l', '-E', 'sha256', '-f', path.join(root, name + '.pub')], { encoding: 'utf8' }).trim().split(/\s+/)[1];

test('real OpenSSH: selected key authenticates only after independently verified pinned fingerprint', { timeout: 30000 }, async () => {
  await start('host-a'); const manager = new ServerPreflight();
  await manager.setIdentity(path.join(root, 'client'));
  const challenge = await manager.scan(target);
  assert.equal(challenge.fingerprint, fingerprint('host-a'));
  await assert.rejects(manager.inspect(challenge.id, 'SHA256:wrong'), error => error.code === 'FINGERPRINT_MISMATCH');
  const result = await manager.inspect(challenge.id, challenge.fingerprint);
  assert.equal(result.report.os, 'Linux'); assert.equal(result.installed, false); assert.equal(result.executionProbe, 'not_run');
  assert.deepEqual(result.target, target);
  await assert.rejects(manager.inspect(challenge.id, challenge.fingerprint), error => error.code === 'EXPIRED_CHALLENGE');
  manager.cancel();
});
test('real OpenSSH: wrong client key is a safe authentication error, with no raw key path', { timeout: 30000 }, async () => {
  const manager = new ServerPreflight(); await manager.setIdentity(path.join(root, 'wrong-client'));
  const challenge = await manager.scan(target);
  await assert.rejects(manager.inspect(challenge.id, challenge.fingerprint), error => error.code === 'AUTHENTICATION_FAILED' && !error.message.includes(root));
  manager.cancel();
});
test('real OpenSSH: replacing host identity after scan fails closed instead of accepting new key', { timeout: 30000 }, async () => {
  const manager = new ServerPreflight(); await manager.setIdentity(path.join(root, 'client'));
  const old = await manager.scan(target);
  await start('host-b');
  await assert.rejects(manager.inspect(old.id, old.fingerprint), error => error.code === 'HOST_KEY_CHANGED');
  const updated = await manager.scan(target);
  assert.notEqual(updated.fingerprint, old.fingerprint); assert.equal(updated.fingerprint, fingerprint('host-b'));
  assert.equal((await manager.inspect(updated.id, updated.fingerprint)).installed, false);
  manager.cancel(); await stopped();
});
