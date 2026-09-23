import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { parse } from 'acorn';
import { patchOriginalLanding } from '../scripts/lib/router-renderer-patch.mjs';
const snippet = await readFile(new URL('../scripts/lib/beebot-server-preflight.snippet.js', import.meta.url), 'utf8');
const workbench = await readFile(new URL('../scripts/lib/beebot-node-workbench.snippet.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await tick(); } assert.fail('Expected preflight UI state'); }
function deferred() { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; }
const plain = value => JSON.parse(JSON.stringify(value));
const fingerprint = 'SHA256:' + 'a'.repeat(43);
const target = { host: 'node.example.test', user: 'operator', port: 22 };
const challenge = { id: 'challenge', target, fingerprint, expiresAt: Date.now() + 300000 };
const goodReport = { target, fingerprint, checkedAt: Date.now(), installed: false, executionProbe: 'not_run', status: 'needs_attention', blockers: ['docker_missing', 'compose_missing'], report: { os: 'Linux', arch: 'x86_64', diskKiB: 9000000 } };
async function boot(t, handler) {
  const w = new Window({ url: 'https://beebot.local/settings' }); w.__sandUiLanguage = 'zh';
  const calls = [];
  w.desktop = {
    nodes: { onChanged: () => () => {}, request: async request => { assert.equal(request.action, 'list'); return []; } },
    serverPreflight: { request: async request => {
      calls.push(plain(request)); const custom = await handler?.(request); if (custom !== undefined) return custom;
      return { ok: true, value: request.action === 'open' ? { sessionId: 's1' } : request.action === 'scan' ? { ...challenge, target: plain(request.target) } : request.action === 'inspect' ? goodReport : request.action === 'chooseKey' ? { label: 'id_ed25519', canceled: false } : null };
    } },
  };
  w.document.body.innerHTML = '<textarea aria-label="Chat draft">草稿与引用不变</textarea><section id="settings"></section>';
  w.eval(workbench); w.eval(snippet); const host = w.document.getElementById('settings'); let dispose = w.__beebotMountServersSettings(host);
  const field = name => host.querySelector(`[data-preflight-field="${name}"]`), action = name => host.querySelector(`[data-preflight-action="${name}"]`);
  const input = (name, value) => { const node = field(name); node.value = value; node.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const open = () => { host.querySelector('[data-server-preflight]').open = true; };
  const scan = async () => { open(); input('host', target.host); input('user', target.user); action('scan').click(); await until(() => !host.querySelector('.bb-preflight-confirm').hidden); };
  const check = () => { field('trust').checked = true; field('trust').dispatchEvent(new w.Event('change')); action('inspect').click(); };
  t.after(async () => { dispose?.(); await w.happyDOM.close(); });
  return { w, host, calls, field, action, input, open, scan, check, close: () => { dispose?.(); dispose = null; } };
}
test('preflight is collapsed inside existing Servers, with no network, dialog or chat action on mount', async t => {
  const h = await boot(t); await tick();
  assert.equal(h.host.querySelector('[data-server-preflight]').open, false); assert.equal(h.calls.length, 0);
  assert.equal(h.host.querySelectorAll('[role=dialog]').length, 0); assert.match(h.host.textContent, /只读检查/);
  assert.equal(h.w.document.querySelector('textarea').value, '草稿与引用不变');
});
test('scan displays fingerprint; authentication requires explicit user verification', async t => {
  const h = await boot(t); await h.scan();
  assert.equal(h.action('inspect').disabled, true); h.action('inspect').click(); await tick();
  assert.equal(h.calls.filter(c => c.action === 'inspect').length, 0); assert.match(h.host.querySelector('code').textContent, /^SHA256:/);
  h.check(); await until(() => h.host.textContent.includes('检查完成，有事项需要处理'));
  assert.deepEqual(h.calls.find(c => c.action === 'inspect'), { action: 'inspect', sessionId: 's1', challengeId: 'challenge', fingerprint });
  assert.match(h.host.textContent, /未安装 Docker/); assert.match(h.host.textContent, /没有安装或变更服务/);
});
test('editing target invalidates confirmation without discarding target or chat drafts', async t => {
  const h = await boot(t); await h.scan(); h.field('trust').checked = true;
  h.input('host', 'other.test'); assert.equal(h.field('trust').checked, false); assert.equal(h.action('inspect').disabled, true);
  assert.equal(h.field('host').value, 'other.test'); assert.equal(h.w.document.querySelector('textarea').value, '草稿与引用不变');
  assert.ok(h.calls.some(c => c.action === 'cancel' && c.sessionId === 's1'));
});
test('late inspection after editing never labels the replacement server as checked', async t => {
  const gate = deferred(); const h = await boot(t, r => r.action === 'inspect' ? gate.promise : undefined);
  await h.scan(); h.check(); await until(() => h.calls.some(c => c.action === 'inspect'));
  h.input('host', 'replacement.test'); gate.resolve({ ok: true, value: goodReport }); await tick();
  assert.equal(h.host.querySelector('.bb-preflight-result').textContent, ''); assert.equal(h.field('host').value, 'replacement.test');
});
test('opening response after close is disposed, not inherited by a new settings screen', async t => {
  const gate = deferred(); const h = await boot(t, r => r.action === 'open' ? gate.promise : undefined);
  h.open(); h.input('host', target.host); h.input('user', target.user); h.action('scan').click(); await until(() => h.calls.length > 0);
  h.close(); gate.resolve({ ok: true, value: { sessionId: 'old' } }); await until(() => h.calls.some(c => c.action === 'close' && c.sessionId === 'old'));
  assert.equal(h.calls.filter(c => c.action === 'scan').length, 0); assert.equal(h.host.childElementCount, 0);
});
test('closing the core workbench without wrapper cleanup also cancels preflight', async t => {
  const h = await boot(t); await h.scan(); h.host.replaceChildren();
  await until(() => h.calls.some(c => c.action === 'close' && c.sessionId === 's1'));
});
test('explicit cancel ends only preflight and keeps form editable', async t => {
  const gate = deferred(); const h = await boot(t, r => r.action === 'scan' ? gate.promise : undefined);
  h.open(); h.input('host', target.host); h.input('user', target.user); h.action('scan').click(); await until(() => h.calls.some(c => c.action === 'scan'));
  h.action('cancel').click(); gate.resolve({ ok: true, value: challenge }); await tick();
  assert.match(h.host.textContent, /本次检查已取消/); assert.equal(h.action('scan').disabled, false); assert.equal(h.host.querySelector('.bb-preflight-confirm').hidden, true);
  assert.equal(h.calls.some(c => ['cancelGoal', 'submitGoal', 'login', 'apply'].includes(c.action)), false);
});
test('authentication failure preserves input and does not offer password or blindly retry', async t => {
  const h = await boot(t, r => r.action === 'inspect' ? { ok: false, error: { code: 'AUTHENTICATION_FAILED', detail: 'Bearer SECRET' } } : undefined);
  await h.scan(); h.check(); await until(() => h.host.textContent.includes('SSH 密钥认证失败'));
  assert.equal(h.field('user').value, target.user); assert.equal(h.host.querySelector('input[type=password]'), null);
  assert.equal(h.host.textContent.includes('SECRET'), false); assert.equal(h.calls.filter(c => c.action === 'inspect').length, 1);
});
test('language switch preserves exact input nodes, composition and focus', async t => {
  const h = await boot(t); h.open(); const input = h.field('host'); input.focus(); input.value = 'half-typed';
  input.dispatchEvent(new h.w.CompositionEvent('compositionstart', { bubbles: true }));
  h.w.__sandUiLanguage = 'en'; h.w.dispatchEvent(new h.w.Event('sand-ui-language-changed'));
  assert.equal(h.field('host'), input); assert.equal(h.w.document.activeElement, input); assert.equal(input.value, 'half-typed');
  h.action('scan').click(); await tick(); assert.equal(h.calls.length, 0);
});
test('native key selection exposes only a label and returning to agent invalidates fingerprint', async t => {
  const h = await boot(t); h.open(); h.action('chooseKey').click(); await until(() => h.host.textContent.includes('id_ed25519'));
  assert.equal(h.action('useAgent').disabled, false); await h.scan(); h.action('useAgent').click(); await until(() => h.action('useAgent').disabled);
  assert.equal(h.host.querySelector('.bb-preflight-confirm').hidden, true); assert.equal(h.calls.some(c => 'path' in c || 'password' in c), false);
});
test('wrong-server or claimed-ready inspection results fail visibly', async t => {
  for (const value of [{ ...goodReport, target: { ...target, host: 'wrong.test' } }, { ...goodReport, installed: true }]) {
    const h = await boot(t, r => r.action === 'inspect' ? { ok: true, value } : undefined);
    await h.scan(); h.check(); await until(() => h.host.textContent.includes('检查结果格式无法确认'));
    assert.equal(h.host.querySelector('.bb-preflight-result').textContent, ''); h.close();
  }
});
test('packaged renderer contains additive preflight and leaves Servers/security source untouched', async () => {
  const original = await readFile(new URL('../src/app/dist/renderer/assets/index-UbX-y3il.js', import.meta.url), 'utf8');
  const patched = patchOriginalLanding(original); parse(patched, { ecmaVersion: 'latest', sourceType: 'module' });
  assert.ok(patched.includes('data-server-preflight') || patched.includes('dataset.serverPreflight'));
  assert.ok(patched.includes('Confirm identity & check'));
  const preload = await readFile(new URL('../source/electron-preload/preload.ts', import.meta.url), 'utf8'); assert.match(preload, /ipc.invoke\("beebot:server-preflight", request\)/);
  const entry = await readFile(new URL('../scripts/electron-main-production-activation.mjs', import.meta.url), 'utf8');
  assert.match(entry, /installServerPreflightIpc\(\{ app, ipcMain, BrowserWindow, dialog \}/);
});
