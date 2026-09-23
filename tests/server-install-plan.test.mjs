import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const temp = await mkdtemp(path.join(tmpdir(), 'beebot-install-plan-'));
async function load(name) {
  const output = path.join(temp, name + '.mjs');
  await build({entryPoints:[path.resolve('source/client-provisioning/'+name+'.ts')], outfile:output, bundle:true, platform:'node', format:'esm', logLevel:'silent'});
  return import(pathToFileURL(output));
}
const {verifyNodeRelease, RELEASE_CONTEXT} = await load('release-manifest');
const {previewInstallation, parseInstallationOptions} = await load('install-plan');
const {ServerPreflight} = await load('manager');
test.after(() => rm(temp, {recursive:true,force:true}));
const now=1800000000000;
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const nodeRepository='ghcr.io/example-fixture/beebot-node', proxyRepository='docker.io/library/caddy';
const policy={keys:{fixture:publicKey.export({type:'spki',format:'pem'})},minimumSequence:2,repositories:[nodeRepository,proxyRepository]};
const digest='a'.repeat(64), image=nodeRepository+'@sha256:'+digest;
const manifest={format:1,product:'beebot-node',channel:'stable',version:'0.1.0',sequence:2,issuedAt:now-1000,expiresAt:now+86400000,installationApi:1,securityProfile:'trusted-devices-dpop-v1',images:{'linux/amd64':image,'linux/arm64':image},proxyImage:proxyRepository+'@sha256:'+'b'.repeat(64),minimumDiskKiB:2*1048576};
function envelope(value=manifest,key=privateKey,context=RELEASE_CONTEXT){
 const payload=Buffer.from(JSON.stringify(value));
 return JSON.stringify({keyId:'fixture',payload:payload.toString('base64'),signature:sign(null,Buffer.concat([Buffer.from(context),payload]),key).toString('base64')});
}
const code=expected=>error=>error.code===expected;
const inspected={target:{host:'node.example.test',user:'operator',port:22},fingerprint:'SHA256:'+'a'.repeat(43),checkedAt:now-100,report:{os:'Linux',arch:'x86_64',bash:'available',engine:'local_linux',compose:'available',home:'writable',diskKiB:9000000,installation:'absent'}};
const options={domain:'bot.example.test',name:'My BeeBot'};
const catalog=at=>[verifyNodeRelease(envelope(),policy,at)];

test('real Ed25519 signature authenticates exact release bytes and immutable Node/proxy images',()=>{
 const result=verifyNodeRelease(envelope(),policy,now);
 assert.deepEqual(result.manifest,manifest);assert.match(result.digest,/^[a-f0-9]{64}$/);
 assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.manifest));assert.ok(Object.isFrozen(result.manifest.images));
});
test('unknown signer, supplied keys and unrelated signatures cannot establish release trust',()=>{
 assert.throws(()=>verifyNodeRelease(envelope(),{...policy,keys:{}},now),code('UNTRUSTED_RELEASE'));
 const forged=JSON.parse(envelope());forged.publicKey=policy.keys.fixture;
 assert.throws(()=>verifyNodeRelease(JSON.stringify(forged),policy,now),code('INVALID_RELEASE'));
 const other=generateKeyPairSync('ed25519');
 assert.throws(()=>verifyNodeRelease(envelope(manifest,other.privateKey),policy,now),code('UNTRUSTED_RELEASE'));
 assert.throws(()=>verifyNodeRelease(envelope(manifest,privateKey,''),policy,now),code('UNTRUSTED_RELEASE'));
});
test('signed bytes cannot be edited after signing',()=>{
 const signed=JSON.parse(envelope());signed.payload=Buffer.from(JSON.stringify({...manifest,version:'0.2.0'})).toString('base64');
 assert.throws(()=>verifyNodeRelease(JSON.stringify(signed),policy,now),code('UNTRUSTED_RELEASE'));
});
test('malformed, oversized, noncanonical encodings and wrong signature length are rejected',()=>{
 for(const input of ['bad', 'x'.repeat(32769), 'null', '[]', '{}']) assert.throws(()=>verifyNodeRelease(input,policy,now),code('INVALID_RELEASE'));
 for(const field of ['signature','payload']) for(const value of ['', '???', JSON.parse(envelope())[field]+'\n','AAAA']) {
  const bad={...JSON.parse(envelope()),[field]:value};assert.throws(()=>verifyNodeRelease(JSON.stringify(bad),policy,now));
 }
});
test('wrong key family is never treated as Ed25519',()=>{
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
 assert.throws(()=>verifyNodeRelease(envelope(),{...policy,keys:{fixture:rsa.publicKey.export({type:'spki',format:'pem'})}},now),code('UNTRUSTED_RELEASE'));
});
test('expiry and minimum approved sequence block outdated offers',()=>{
 assert.throws(()=>verifyNodeRelease(envelope(),policy,manifest.expiresAt),code('EXPIRED_RELEASE'));
 assert.throws(()=>verifyNodeRelease(envelope({...manifest,sequence:1}),policy,now),code('RELEASE_ROLLBACK'));
});
for(const [field,value] of [['issuedAt',now+1],['expiresAt',now-2000],['expiresAt',now+40*86400000],['sequence',0],['minimumDiskKiB',1],['minimumDiskKiB',Infinity],['version','latest'],['channel','preview'],['installationApi',2],['securityProfile','legacy'],['product','other'],['format',2]]) {
 test(`release rejects incompatible field ${field}=${value}`,()=>assert.throws(()=>verifyNodeRelease(envelope({...manifest,[field]:value}),policy,now),code('INVALID_RELEASE')));
}
test('all release repositories are exact approved names and both service images are pinned',()=>{
 for(const bad of ['node:latest','sha256:'+digest,nodeRepository+'-evil@sha256:'+digest,nodeRepository+':v1@sha256:'+digest,'https://'+image,image+';id']) {
  assert.throws(()=>verifyNodeRelease(envelope({...manifest,images:{'linux/amd64':bad}}),policy,now));
 }
 assert.throws(()=>verifyNodeRelease(envelope({...manifest,proxyImage:'caddy:2'}),policy,now),code('INVALID_RELEASE'));
 assert.throws(()=>verifyNodeRelease(envelope({...manifest,images:{}}),policy,now),code('INVALID_RELEASE'));
 assert.throws(()=>verifyNodeRelease(envelope({...manifest,images:{'windows/amd64':image}}),policy,now),code('INVALID_RELEASE'));
 assert.throws(()=>verifyNodeRelease(envelope({...manifest,command:'sudo anything'}),policy,now),code('INVALID_RELEASE'));
});
test('installation options reject shell syntax, URL credentials, IPs and mutation fields',()=>{
 assert.deepEqual(parseInstallationOptions(options),options);
 for(const domain of ['https://bot.test','user@bot.test','bot.test:443','localhost','127.0.0.1','bot.test;id','*.example.test','a..test','-a.test','Bot.test','bot.test/',' bot.test']) assert.throws(()=>parseInstallationOptions({...options,domain}),code('INVALID_INSTALL_OPTIONS'));
 for(const name of ['', 'a\nb', ' a', 'x'.repeat(101), 'a\u202eb']) assert.throws(()=>parseInstallationOptions({...options,name}),code('INVALID_INSTALL_OPTIONS'));
 for(const extra of ['image','command','directory','password','fingerprint','report','keys']) assert.throws(()=>parseInstallationOptions({...options,[extra]:'untrusted'}),code('INVALID_INSTALL_OPTIONS'));
});
test('preview binds confirmed host, options, platform, release and freshness without permission to install',()=>{
 const p=previewInstallation(inspected,options,now,catalog);
 assert.equal(p.target.host,inspected.target.host);assert.equal(p.fingerprint,inspected.fingerprint);
 assert.equal(p.platform,'linux/amd64');assert.equal(p.release.image,image);assert.equal(p.release.proxyImage,manifest.proxyImage);
 assert.equal(p.origin,'https://bot.example.test');assert.equal(p.directory,'$HOME/.local/share/beebot/server');
 assert.equal(p.canInstall,false);assert.equal(p.installed,false);assert.equal(p.status,'review_only');assert.equal(p.executionProbe,'not_run');
 assert.deepEqual(p.blockers,['execution_not_enabled']);assert.ok(p.prerequisitesToVerify.includes('device_enrollment'));
 assert.equal(p.expiresAt,inspected.checkedAt+300000);
 const same=previewInstallation(inspected,options,now,catalog);assert.equal(p.specificationDigest,same.specificationDigest);assert.notEqual(p.id,same.id);
 const changed=previewInstallation(inspected,{...options,domain:'new.test'},now,catalog);assert.notEqual(changed.specificationDigest,p.specificationDigest);
 assert.doesNotMatch(JSON.stringify(p),/privateKey|known_hosts|\/\.ssh\//);
});
test('no published release is an explicit blocker, never a default tag or invented image',()=>{
 const p=previewInstallation(inspected,options,now);
 assert.equal(p.release,null);assert.ok(p.blockers.includes('release_unavailable'));assert.equal(p.canInstall,false);
});
test('preview requires a recent main-process observation and rejects clock rollback',()=>{
 assert.throws(()=>previewInstallation(undefined,options,now),code('PREFLIGHT_REQUIRED'));
 for(const checkedAt of [now-300000,now+1,NaN]) assert.throws(()=>previewInstallation({...inspected,checkedAt},options,now),code('EXPIRED_PREFLIGHT'));
 assert.throws(()=>previewInstallation({...inspected,fingerprint:'new'},options,now),code('PREFLIGHT_REQUIRED'));
});
test('architecture and actual release storage requirements remain hard planning blockers',()=>{
 const arm={...inspected,report:{...inspected.report,arch:'aarch64'}};
 assert.equal(previewInstallation(arm,options,now,catalog).platform,'linux/arm64');
 const onlyX64=at=>[verifyNodeRelease(envelope({...manifest,images:{'linux/amd64':image}}),policy,at)];
 assert.ok(previewInstallation(arm,options,now,onlyX64).blockers.includes('release_platform_unavailable'));
 const larger=at=>[verifyNodeRelease(envelope({...manifest,minimumDiskKiB:10000000}),policy,at)];
 assert.ok(previewInstallation(inspected,options,now,larger).blockers.includes('release_disk_low'));
 for(const installation of ['managed_present','occupied','locked','symlink','unknown']) assert.ok(previewInstallation({...inspected,report:{...inspected.report,installation}},options,now,catalog).blockers.includes('installation_'+installation));
});
test('catalog selection prefers highest compatible signed sequence and refuses duplicate identities',()=>{
 const releases=[verifyNodeRelease(envelope(),policy,now),verifyNodeRelease(envelope({...manifest,version:'0.2.0',sequence:3}),policy,now)];
 assert.equal(previewInstallation(inspected,options,now,()=>releases).release.sequence,3);
 assert.throws(()=>previewInstallation(inspected,options,now,()=>[releases[0],releases[0]]),code('INVALID_CATALOG'));
});
test('plan cannot outlive release expiry',()=>{
 const expire=at=>[verifyNodeRelease(envelope({...manifest,expiresAt:now+50}),policy,at)];
 assert.equal(previewInstallation(inspected,options,now,expire).expiresAt,now+50);
});
const hostBlob=Buffer.concat([Buffer.from([0,0,0,11]),Buffer.from('ssh-ed25519'),Buffer.from([0,0,0,32]),randomBytes(32)]);
const report='BEEBOT_PREFLIGHT_V1\nos=Linux\narch=x86_64\nbash=available\nengine=local_linux\ncompose=available\nhome=writable\ndiskKiB=9000000\ninstallation=absent\n';
async function inspectedManager(){
 const calls=[];let time=now;
 const m=new ServerPreflight(async req=>{calls.push(req);return {status:0,stdout:req.program.endsWith('keyscan')?`host ssh-ed25519 ${hostBlob.toString('base64')}\n`:report,stderr:''}},()=>time);
 const challenge=await m.scan(inspected.target);const result=await m.inspect(challenge.id,challenge.fingerprint);
 return {m,calls,result,advance:ms=>time+=ms};
}
test('actual SSH manager previews from its own observation, never a renderer-supplied report',async()=>{
 const {m,calls,result}=await inspectedManager();result.report.installation='occupied';
 const p=m.previewInstall(options);assert.equal(p.blockers.includes('installation_occupied'),false);
 assert.equal(calls.length,2); // keyscan and one constant probe; plan has no remote execution.
 assert.throws(()=>m.previewInstall({...options,report:inspected.report}),code('INVALID_INSTALL_OPTIONS'));
});
test('cancel, identity changes, fresh scan and expiration invalidate the prior inspection',async()=>{
 for(const action of ['cancel','identity','scan','expire']){
  const {m,advance}=await inspectedManager();
  if(action==='cancel')m.cancel();if(action==='identity')await m.setIdentity(undefined);if(action==='scan')await m.scan({...inspected.target,host:'other.test'});if(action==='expire')advance(300000);
  assert.throws(()=>m.previewInstall(options),code(action==='expire'?'EXPIRED_PREFLIGHT':'PREFLIGHT_REQUIRED'));
 }
});
