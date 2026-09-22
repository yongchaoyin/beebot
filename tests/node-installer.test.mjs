import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync, rmSync, existsSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../deploy/install-node.sh', import.meta.url));
const digest = 'sha256:' + 'a'.repeat(64);
function lab(t, extra = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'beebot-installer-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'installation'), log = path.join(root, 'commands.log');
  // Explicit process mocks: these tests never install Docker, bind ports or deploy a server.
  const docker = `#!/usr/bin/env node
const fs = require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(process.env.LAB_LOG,JSON.stringify(args)+'\\n');
const has=s=>args.includes(s), out=s=>console.log(s);
if(args[0]==='context')out(args[1]==='show'?'default':process.env.LAB_ENDPOINT||'unix:///var/run/docker.sock');
else if(args[0]==='info')out('linux');
else if(args[0]==='image') { const f=args[args.indexOf('--format')+1]||'';out(f.includes('install-api')?(process.env.LAB_CONTRACT||'1'):f.includes('User')?'node':f.includes('.Id')?'${digest}':'{}'); }
else if(args[0]==='volume') { if(!process.env.LAB_VOLUME)process.exit(1);out(process.env.LAB_VOLUME); }
else if(args[0]==='compose') { if(has('verify')&&process.env.LAB_VERIFY_FAIL)process.exit(1); if(has('up')&&process.env.LAB_UP_FAIL)process.exit(1); }
`;
  writeFileSync(path.join(root, 'docker'), docker); chmodSync(path.join(root, 'docker'), 0o755);
  // The repository CI is macOS, but this is explicitly a Linux installer process fixture.
  writeFileSync(path.join(root, 'uname'), '#!/bin/sh\necho Linux\n'); chmodSync(path.join(root, 'uname'), 0o755);
  const env = { ...process.env, DOCKER_HOST: '', PATH: root + path.delimiter + process.env.PATH, LAB_LOG: log, ...extra };
  return { dir, log, root, run(action, more = [], replaceDefaults = false) {
    const defaults = ['--image', digest, '--domain', 'bot.example.test', '--directory', dir];
    if (replaceDefaults) for (const flag of ['--image', '--domain', '--directory']) { if (more.includes(flag)) defaults.splice(defaults.indexOf(flag), 2); }
    return spawnSync('bash', [script, action, ...defaults, ...more], { env, encoding: 'utf8', timeout: 15000 });
  }};
}
test('plan has no filesystem or Docker side effects', t => {
  const l = lab(t); const r = l.run('plan'); assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(l.dir)); assert.ok(!existsSync(l.log)); assert.match(r.stdout, /Models are not configured/);
});
for (const [label, args] of [
  ['mutable image', ['--image', 'beebot:latest']], ['duplicate input', ['--domain', 'other.test']],
  ['password argument', ['--password', 'fixture-only']], ['command injection', ['--instance', 'bad;touch bad']],
  ['invalid slug', ['--instance', '../other']], ['control characters', ['--name', 'hello\nworld']],
  ['IP address', ['--domain', '127.0.0.1']], ['malformed DNS', ['--domain', 'bot..example.test']],
  ['hostname injection', ['--domain', 'bot.test;touch x']],
]) test(`rejects ${label} before Docker`, t => {
  const l = lab(t); const r = l.run('apply', args, label !== 'duplicate input'); assert.notEqual(r.status, 0); assert.ok(!existsSync(l.log));
});
test('refuses remote Docker contexts and unsupported images', t => {
  for (const extra of [{ LAB_ENDPOINT: 'ssh://other' }, { LAB_CONTRACT: 'old' }, { DOCKER_HOST: 'tcp://other:2375' }]) {
    const l = lab(t, extra), r = l.run('apply'); assert.notEqual(r.status, 0, r.stdout); assert.ok(!existsSync(l.dir));
  }
});
// Apply-path checks are Linux-only because GNU stat and /proc are genuine prerequisites.
const linux = { skip: process.platform !== 'linux' };
test('apply uses bounded services and keeps identity on an exact retry', linux, t => {
  const l = lab(t); const r = l.run('apply'); assert.equal(r.status, 0, r.stderr);
  const id = readFileSync(path.join(l.dir, 'installation.id'), 'utf8');
  assert.equal(l.run('apply').status, 0); assert.equal(readFileSync(path.join(l.dir, 'installation.id'), 'utf8'), id);
  const compose = readFileSync(path.join(l.dir, 'compose.yml'), 'utf8');
  assert.equal(statSync(path.join(l.dir, '.env')).mode & 0o777, 0o600);
  assert.match(compose, /no-new-privileges/); assert.match(compose, /setup-output, file/); assert.doesNotMatch(compose, /docker.sock|privileged:|CUSTOM_API_KEY|7331:7331/);
  assert.match(readFileSync(l.log, 'utf8'), /"--if-absent"/); assert.match(readFileSync(l.log, 'utf8'), /"--wait-timeout","120"/);
});
test('changed managed files and foreign volumes are never adopted', linux, t => {
  const l = lab(t); assert.equal(l.run('apply').status, 0);
  writeFileSync(path.join(l.dir, 'compose.yml'), 'operator customization');
  assert.notEqual(l.run('apply').status, 0); assert.equal(readFileSync(path.join(l.dir, 'compose.yml'), 'utf8'), 'operator customization');
  const other = lab(t, { LAB_VOLUME: 'another-installation' }); assert.notEqual(other.run('apply').status, 0);
  assert.doesNotMatch(readFileSync(other.log, 'utf8'), /"up"|"run"/);
});
test('TLS/identity verification failure keeps deployment and returns a distinct status', linux, t => {
  const l = lab(t, { LAB_VERIFY_FAIL: '1' }), r = l.run('apply'); assert.equal(r.status, 3, r.stderr);
  assert.ok(existsSync(path.join(l.dir, 'installation.manifest'))); assert.match(r.stderr, /Installation retained/);
  assert.doesNotMatch(readFileSync(l.log, 'utf8'), /"down"|"prune"|"volume","rm"/);
});
test('refuses unrelated directories, held locks and symlinked identity files', linux, t => {
  const unrelated = lab(t); mkdirSync(unrelated.dir, { mode: 0o700 }); writeFileSync(path.join(unrelated.dir, 'keep'), 'operator data');
  assert.notEqual(unrelated.run('apply').status, 0); assert.equal(readFileSync(path.join(unrelated.dir, 'keep'), 'utf8'), 'operator data');
  const locked = lab(t); mkdirSync(locked.dir, { mode: 0o700 }); mkdirSync(path.join(locked.dir, '.install.lock')); assert.notEqual(locked.run('apply').status, 0);
  const linked = lab(t); assert.equal(linked.run('apply').status, 0); rmSync(path.join(linked.dir, 'installation.id'));
  const target = path.join(linked.root, 'must-not-create'); symlinkSync(target, path.join(linked.dir, 'installation.id'));
  assert.notEqual(linked.run('apply').status, 0); assert.ok(!existsSync(target));
});
