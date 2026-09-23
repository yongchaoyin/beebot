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


const planFor = request => ({ schemaVersion: 1, id: 'plan-fixture', target, fingerprint, checkedAt: goodReport.checkedAt,
  options: request.options, origin: 'https://' + request.options.domain, directory: '$HOME/.local/share/beebot/server',
  release: null, blockers: ['release_unavailable', 'execution_not_enabled'], expiresAt: Date.now() + 200000,
  specificationDigest: 'a'.repeat(64), status: 'review_only', canInstall: false, installed: false, executionProbe: 'not_run' });
async function planHarness(t, override) {
  const h = await boot(t, request => request.action === 'previewInstall' ? override?.(request) ?? { ok: true, value: planFor(request) } : undefined);
  await h.scan(); h.check(); await until(() => !h.host.querySelector('[data-install-plan]').hidden);
  const section = h.host.querySelector('[data-install-plan]'); section.open = true;
  const domain = h.host.querySelector('[data-install-field=domain]'), name = h.host.querySelector('[data-install-field=name]');
  domain.value = 'bot.example.test'; domain.dispatchEvent(new h.w.Event('input'));
  return { ...h, section, domain, name, submit: () => h.host.querySelector('[data-install-plan-form]').dispatchEvent(new h.w.Event('submit',{cancelable:true})) };
}
test('installation planning remains hidden until a verified inspection and never auto-requests a plan', async t => {
  const h = await boot(t); assert.equal(h.host.querySelector('[data-install-plan]').hidden, true);
  await h.scan(); assert.equal(h.host.querySelector('[data-install-plan]').hidden, true);
  h.check(); await until(() => !h.host.querySelector('[data-install-plan]').hidden);
  assert.equal(h.host.querySelector('[data-install-plan]').open, false);
  assert.equal(h.calls.some(c => c.action === 'previewInstall'), false);
});
test('preview displays verified target, intended resources and missing release without an apply action', async t => {
  const h = await planHarness(t); h.submit(); await until(() => h.section.textContent.includes('安装计划 · 尚未执行'));
  assert.deepEqual(h.calls.find(c => c.action === 'previewInstall'), { action: 'previewInstall', sessionId: 's1', options: { domain: 'bot.example.test', name: 'My BeeBot' } });
  assert.match(h.section.textContent, /operator@node.example.test:22/); assert.match(h.section.textContent, /正式发行包：尚不可用/);
  assert.match(h.section.textContent, /80\/443/); assert.match(h.section.textContent, /实际安装、设备绑定与模型配置尚未开放/);
  assert.equal(h.host.querySelectorAll('[data-preflight-action=apply],[data-preflight-action=install],[role=dialog]').length,0);
  assert.equal(h.w.document.querySelector('textarea').value,'草稿与引用不变');
});
test('editing install options discards a late plan but retains the confirmed host observation', async t => {
  const gate = deferred(); let req;
  const h = await planHarness(t, request => { req=request; return gate.promise; });
  h.submit(); await until(() => !!req);
  h.domain.value='new.example.test'; h.domain.dispatchEvent(new h.w.Event('input'));
  gate.resolve({ok:true,value:planFor(req)});await tick();
  assert.equal(h.section.querySelector('.bb-preflight-result').textContent,'');
  assert.equal(h.section.hidden,false); assert.equal(h.domain.value,'new.example.test');
});
test('editing SSH target discards pending plan and requires a new confirmed inspection', async t => {
  const gate=deferred();let req; const h=await planHarness(t,r=>{req=r;return gate.promise;});
  h.submit();await until(()=>!!req);h.input('host','other.test');gate.resolve({ok:true,value:planFor(req)});await tick();
  assert.equal(h.section.hidden,true);assert.equal(h.section.querySelector('.bb-preflight-result').textContent,'');
});
test('closing Settings discards pending preview and does not cancel Bot/server work', async t => {
  const gate=deferred();let req;const h=await planHarness(t,r=>{req=r;return gate.promise;});
  h.submit();await until(()=>!!req);h.close();gate.resolve({ok:true,value:planFor(req)});await tick();
  assert.equal(h.host.childElementCount,0);assert.equal(h.calls.some(c=>['apply','submitGoal','cancelGoal'].includes(c.action)),false);
});
test('language change preserves installation draft, composition, exact nodes and keyboard focus', async t => {
  const h=await planHarness(t);h.name.value='我的服务器';h.name.focus();
  h.name.dispatchEvent(new h.w.Event('compositionstart',{bubbles:true}));h.submit();await tick();assert.equal(h.calls.some(c=>c.action==='previewInstall'),false);
  h.w.__sandUiLanguage='en';h.w.dispatchEvent(new h.w.Event('sand-ui-language-changed'));
  assert.equal(h.host.querySelector('[data-install-field=name]'),h.name);assert.equal(h.name.value,'我的服务器');assert.equal(h.w.document.activeElement,h.name);
  h.name.dispatchEvent(new h.w.Event('compositionend',{bubbles:true}));h.submit();await until(()=>h.section.textContent.includes('Installation plan · not executed'));
});
test('duplicate preview clicks coalesce and errors retain the draft', async t => {
  const gate=deferred();const h=await planHarness(t,()=>gate.promise);h.submit();h.submit();await tick();
  assert.equal(h.calls.filter(c=>c.action==='previewInstall').length,1);
  gate.resolve({ok:false,error:{code:'EXPIRED_PREFLIGHT'}});await until(()=>h.section.textContent.includes('环境检查已过期'));
  assert.equal(h.domain.value,'bot.example.test');assert.equal(h.name.value,'My BeeBot');
});
test('forged target or ready/install claims cannot render as an accepted plan', async t => {
  for(const patch of [{target:{...target,host:'attacker.test'}},{canInstall:true},{installed:true},{status:'ready'},{expiresAt:1},{blockers:[]}]) {
    const h=await planHarness(t,r=>({ok:true,value:{...planFor(r),...patch}}));h.submit();await until(()=>h.section.textContent.includes('检查结果格式无法确认'));
    assert.equal(h.section.querySelector('.bb-preflight-result').textContent,'');h.close();
  }
});
test('untrusted release and native errors have stable messages without leaking diagnostics',async t=>{
  const h=await planHarness(t,()=>({ok:false,error:{code:'UNTRUSTED_RELEASE',message:'private-key=SECRET'}}));h.submit();
  await until(()=>h.section.textContent.includes('发行来源或签名无法确认'));assert.doesNotMatch(h.host.textContent,/SECRET|private-key/);
});
