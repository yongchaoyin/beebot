import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp, mkdir, readFile, readdir, writeFile, cp, rm, lstat, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {build,transform} from 'esbuild';
import {parse} from 'acorn';
import {execFileSync,spawnSync} from 'node:child_process';

const modules=await Promise.all(['local-docker-command','local-docker-auth','local-docker-lifecycle'].map(async name=>{
  const built=await build({entryPoints:[`source/electron-main/box/${name}.ts`],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
}));
const [command,auth,life]=modules;
const image='fixture-image',name='fixture-local-computer',oldId='a'.repeat(64),newId='b'.repeat(64);
async function temporary(t){const directory=await mkdtemp(path.join(tmpdir(),'beebot-local-linux-'));t.after(()=>rm(directory,{recursive:true,force:true}));return directory}
async function fixture(t,{running=true,owned=true}={}){
  const root=await temporary(t),settingsPath=path.join(root,'settings.json');await writeFile(settingsPath,'{}');
  const containers=new Map(),calls=[];
  const old={id:oldId,name,root:path.join(root,'old'),running,owned,image,hostSha256:'old-host',daemonSha256:'old-daemon',schemaVersion:'8',hasInferenceCredential:false,labels:{'com.grok-bot.local-vm':owned?'1':'0'}};
  containers.set(old.id,old);await mkdir(old.root,{recursive:true});
  const file=async(container,relative,content)=>{const target=path.join(container.root,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content);return target};
  await file(old,'home/box/chrome-profile/Default/Cookies','synthetic cookies');
  await file(old,'home/box/chrome-profile/Default/Login Data','synthetic login db');
  await file(old,'home/box/chrome-profile/Default/Cookies-wal','synthetic wal');
  await file(old,'home/box/chrome-profile/Fork-2/Default/Preferences','{"synthetic":true}');
  await symlink('/home/box/chrome-profile/Default/Cookies',path.join(old.root,'home/box/chrome-profile/Fork-2/Default/Cookies'));
  await file(old,'home/box/.sand-window-assignments.json',JSON.stringify({assignments:{'synthetic-bot':2},tokens:{'synthetic-bot':'synthetic-owner'}}));
  await file(old,'home/box/cli-config/config','synthetic cli config');
  let fail,corruptRestored=false;
  const locate=ref=>[...containers.values()].find(c=>c.id===ref||c.name===ref);
  const run=async args=>{
    calls.push([...args]);if(fail?.(args))return{ok:false,output:'fixture injected failure'};
    if(args[0]==='inspect'){
      const c=locate(args.at(-1));if(!c)return{ok:false,output:`Error: No such container: ${args.at(-1)}`};
      return{ok:true,output:JSON.stringify({Id:c.id,State:{Running:c.running},Config:{Image:c.image,Labels:{...c.labels,'com.grok-bot.local-vm':c.owned?'1':'0','com.grok-bot.local-vm.schema-version':c.schemaVersion}}})};
    }
    if(['stop','start','restart','rename'].includes(args[0])){
      const c=locate(args[1]);assert.ok(c);assert.equal(args[1],c.id,'mutations use immutable container IDs');
      if(args[0]==='rename'){if(locate(args[2]))return{ok:false,output:'name conflict'};c.name=args[2]}else c.running=args[0]!=='stop';return{ok:true,output:c.id};
    }
    if(args[0]==='create'){
      const labels={};for(let i=0;i<args.length;i++)if(args[i]==='--label'){const [key,...value]=args[++i].split('=');labels[key]=value.join('=')}
      const c={...old,id:newId,name:args[args.indexOf('--name')+1],root:path.join(root,'new'),running:false,owned:true,schemaVersion:'9',labels};
      containers.set(c.id,c);await mkdir(path.join(c.root,life.LOCAL_HOME_MOUNT),{recursive:true});return{ok:true,output:c.id};
    }
    if(args[0]==='cp'){
      if(args[1].includes(':')){
        const split=args[1].indexOf(':'),id=args[1].slice(0,split),source=args[1].slice(split+1),c=locate(id),from=path.join(c.root,source);
        try{await lstat(from)}catch(error){if(error.code==='ENOENT')return{ok:false,output:`Error response from daemon: Could not find the file ${source} in container ${id}`};throw error}
        await cp(from,args[2],{recursive:true,dereference:false,verbatimSymlinks:true});return{ok:true,output:''};
      }
      const split=args[2].indexOf(':'),c=locate(args[2].slice(0,split)),to=path.join(c.root,args[2].slice(split+1));await cp(args[1],to,{recursive:true,dereference:false,verbatimSymlinks:true});
      if(corruptRestored)await file(c,`${life.LOCAL_HOME_MOUNT}/chrome-profile/Default/Cookies`,'corrupted');
      return{ok:true,output:''};
    }
    assert.fail(`unexpected fake Docker command ${args[0]}`);
  };
  const execute=async waitReady=>life.replaceLocalDockerContainer({run,settingsPath,image,name,old:await life.inspectLocalContainer(run,name),createArgs:async(snapshot,transaction)=>['create','--name',name,'--label',`com.beebot.local-vm.transaction=${transaction}`,'--label','com.grok-bot.local-vm=1','--label','com.beebot.local-vm.home-persistence=1','--volume',`${snapshot.volume}:${life.LOCAL_HOME_MOUNT}`,image],waitReady:waitReady??(async()=>{})});
  return{root,old,containers,calls,run,file,settingsPath,execute,locate,setFailure:fn=>{fail=fn},corruptRestore:()=>{corruptRestored=true}};
}

test('local Docker resolution refuses remote hosts and never falls back to saved contexts',async()=>{
  for(const DOCKER_HOST of['ssh://fixture','tcp://fixture:2375','unix://relative','unix:///socket\nremote'])await assert.rejects(command.resolveLocalDockerEndpoint({env:{DOCKER_HOST},socket:async()=>'/safe/socket'}),/local Unix/);
  await assert.rejects(command.resolveLocalDockerEndpoint({env:{DOCKER_CONTEXT:'remote'},home:'/fixture',socket:async()=>undefined}),/No local Docker socket/);
});
test('an explicit local engine takes precedence and one operation freezes its verified socket',async()=>{
  let checks=0;const calls=[];
  const client=await command.createLocalDockerClient({env:{DOCKER_CONTEXT:'remote',DOCKER_HOST:'unix:///colima/socket',DOCKER_TLS_VERIFY:'1',PATH:'/fixture/bin'},home:'/fixture',socket:async value=>{checks++;assert.equal(value,'/colima/socket');return'/verified/colima.sock'},spawn:(cmd,args,options)=>{calls.push({cmd,args,options});const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();queueMicrotask(()=>child.emit('close',0));return child}});
  await client.run(['inspect','fixture']);await client.run(['stop','fixture']);assert.equal(checks,1);
  for(const call of calls){assert.deepEqual(call.args.slice(0,2),['--host','unix:///verified/colima.sock']);assert.equal(call.options.env.DOCKER_CONTEXT,undefined);assert.equal(call.options.env.DOCKER_HOST,undefined);assert.equal(call.options.env.DOCKER_TLS_VERIFY,undefined);assert.equal(call.options.env.PATH,'/fixture/bin')}
});
test('a regular file or missing explicit socket is rejected before spawning',async t=>{
  const root=await temporary(t),socket=path.join(root,'not-a-socket');await writeFile(socket,'fixture');
  await assert.rejects(command.createLocalDockerClient({env:{DOCKER_HOST:`unix://${socket}`},spawn:()=>assert.fail('must not spawn')}),/No local Docker socket/);
});
test('ownership and identity are rechecked for every destructive entry',async t=>{
  const f=await fixture(t,{owned:false});const old=await life.inspectLocalContainer(f.run,name);
  for(const operation of['stop','restart','rename'])await assert.rejects(life.mutateOwnedContainer(f.run,old,image,operation,['fixture-renamed']),/not owned/);
  await assert.rejects(f.execute(),/not owned/);assert.equal(f.calls.some(c=>['stop','restart','rename','create','cp'].includes(c[0])),false);
});
test('legacy replacement preserves browser databases, WAL, login links, config and assignments before starting',async t=>{
  const f=await fixture(t);await f.execute(async c=>{
    assert.equal(c.id,newId);const root=path.join(f.locate(newId).root,life.LOCAL_HOME_MOUNT);
    assert.equal(await readFile(path.join(root,'chrome-profile/Default/Cookies'),'utf8'),'synthetic cookies');
    assert.equal(await readFile(path.join(root,'chrome-profile/Default/Cookies-wal'),'utf8'),'synthetic wal');
    assert.ok((await lstat(path.join(root,'chrome-profile/Fork-2/Default/Cookies'))).isSymbolicLink());
    assert.deepEqual(JSON.parse(await readFile(path.join(root,'window-assignments.json'),'utf8')).assignments,{'synthetic-bot':2});
  });
  assert.equal(f.old.running,false);assert.match(f.old.name,/-previous-/);assert.equal(f.locate(name).id,newId);
  assert.equal(f.calls.some(c=>c[0]==='rm'),false);await assert.rejects(lstat(life.localLifecycleJournalPath(f.settingsPath)),{code:'ENOENT'});
  const stop=f.calls.findIndex(c=>c[0]==='stop'),copy=f.calls.findIndex(c=>c[0]==='cp'),create=f.calls.findIndex(c=>c[0]==='create'),start=f.calls.findIndex(c=>c[0]==='start');assert.ok(stop<copy&&copy<create&&create<start);
});
test('failed backup resumes the original container without creating or deleting anything',async t=>{
  const f=await fixture(t);f.setFailure(args=>args[0]==='cp');await assert.rejects(f.execute(),/preserve/);
  assert.equal(f.locate(name).id,oldId);assert.equal(f.old.running,true);assert.equal(f.calls.some(c=>['create','rename','rm'].includes(c[0])),false);
});
test('a corrupt assignment blocks replacement and keeps all original bytes',async t=>{
  const f=await fixture(t);await f.file(f.old,'home/box/.sand-window-assignments.json','not JSON');await assert.rejects(f.execute(),/assignments are corrupt/);
  assert.equal(f.old.running,true);assert.equal(f.locate(name).id,oldId);assert.equal(f.calls.some(c=>c[0]==='create'),false);
});
test('failed readiness retains the failed replacement and restores the old name and running state',async t=>{
  const f=await fixture(t);await assert.rejects(f.execute(async()=>{throw Error('fixture readiness failure')}),/readiness failure/);
  assert.equal(f.locate(name).id,oldId);assert.equal(f.old.running,true);assert.equal(f.locate(newId).running,false);assert.match(f.locate(newId).name,/-failed-/);assert.equal(f.calls.some(c=>c[0]==='rm'),false);
});
test('readback integrity mismatch refuses startup and rolls back',async t=>{
  const f=await fixture(t);f.corruptRestore();await assert.rejects(f.execute(),/did not match/);assert.equal(f.locate(name).id,oldId);assert.equal(f.calls.some(c=>c[0]==='start'&&c[1]===newId),false);
});
test('an interrupted transaction fails closed and does not create a blank replacement',async t=>{
  const f=await fixture(t);await life.writeReplacementJournal(f.settingsPath,{version:1,oldId});await assert.rejects(f.execute(),/interrupted/);assert.equal(f.calls.some(c=>c[0]!=='inspect'),false);
});
test('a second migration reads the real persistent home path, not its image symlink',async t=>{
  const f=await fixture(t);f.old.schemaVersion='9';f.old.labels['com.beebot.local-vm.home-persistence']='1';
  await f.file(f.old,`${life.LOCAL_HOME_MOUNT}/chrome-profile/Default/Cookies`,'persistent cookies');await f.file(f.old,`${life.LOCAL_HOME_MOUNT}/cli-config/fixture`,'persisted');await f.file(f.old,`${life.LOCAL_HOME_MOUNT}/home-config/fixture`,'persisted');
  await f.file(f.old,life.LOCAL_ASSIGNMENTS_PATH,JSON.stringify({assignments:{second:3},tokens:{second:'fixture'}}));
  await f.execute();assert.equal(await readFile(path.join(f.locate(newId).root,life.LOCAL_HOME_MOUNT,'chrome-profile/Default/Cookies'),'utf8'),'persistent cookies');
});

test('login export copies only required files and strips unrelated Codex configuration',async t=>{
  const root=await temporary(t),home=path.join(root,'home'),settings=path.join(root,'settings.json');await mkdir(path.join(home,'.codex'),{recursive:true});await mkdir(path.join(home,'.claude'),{recursive:true});
  await writeFile(path.join(home,'.codex/auth.json'),'{"tokens":{"fixture":"initial"}}');await writeFile(path.join(home,'.codex/config.toml'),'model = "fixture-model" # private note\nmodel_reasoning_effort = "high"\n[mcp_servers.private]\ncommand="sensitive-command"\n');await writeFile(path.join(home,'.codex/history.jsonl'),'must stay on Mac');await writeFile(path.join(home,'.claude/.credentials.json'),'{"synthetic":true}');await writeFile(path.join(home,'.claude/settings.json'),'must stay on Mac');
  const mounts=await auth.exportLocalDockerAuth(settings,{home,codexHome:path.join(home,'.codex')});assert.equal(mounts.length,4);assert.ok(mounts.every((v,i)=>i%2===0||v.includes('local-docker-auth/')));assert.ok(mounts.every(v=>!v.includes(`src=${home}`)));
  const codex=path.join(root,'local-docker-auth/codex'),claude=path.join(root,'local-docker-auth/claude');assert.deepEqual((await readdir(codex)).sort(),['auth.json','config.toml']);assert.deepEqual(await readdir(claude),['.credentials.json']);
  const config=await readFile(path.join(codex,'config.toml'),'utf8');assert.match(config,/fixture-model/);assert.match(config,/high/);assert.doesNotMatch(config,/private|sensitive|mcp/);assert.equal((await lstat(path.join(codex,'auth.json'))).mode&0o777,0o600);
});
test('unchanged source login preserves runtime refresh, changed and removed login propagates',async t=>{
  const root=await temporary(t),home=path.join(root,'home'),codexHome=path.join(home,'.codex'),settings=path.join(root,'settings.json');await mkdir(codexHome,{recursive:true});const source=path.join(codexHome,'auth.json'),target=path.join(root,'local-docker-auth/codex/auth.json');await writeFile(source,'{"synthetic":"source"}');
  await auth.exportLocalDockerAuth(settings,{home,codexHome});await writeFile(target,'{"synthetic":"runtime-refresh"}');await auth.exportLocalDockerAuth(settings,{home,codexHome});assert.equal(await readFile(target,'utf8'),'{"synthetic":"runtime-refresh"}');assert.equal(await readFile(source,'utf8'),'{"synthetic":"source"}');
  await writeFile(source,'{"synthetic":"new-login"}');await auth.exportLocalDockerAuth(settings,{home,codexHome});assert.equal(await readFile(target,'utf8'),'{"synthetic":"new-login"}');await rm(source);await auth.exportLocalDockerAuth(settings,{home,codexHome});await assert.rejects(lstat(target),{code:'ENOENT'});
});
test('login export refuses symlink credentials rather than following unrelated private files',async t=>{
  const root=await temporary(t),home=path.join(root,'home'),codexHome=path.join(home,'.codex');await mkdir(codexHome,{recursive:true});await writeFile(path.join(root,'unrelated'),'{}');await symlink(path.join(root,'unrelated'),path.join(codexHome,'auth.json'));
  await assert.rejects(auth.exportLocalDockerAuth(path.join(root,'settings.json'),{home,codexHome}),/regular file/);
});


test('the exact staged bootstrap is valid bash and retains explicit login-link boundaries',async()=>{
  const syntax=spawnSync('/bin/bash',['-n'],{input:life.LOCAL_BOOTSTRAP,encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr);
});

test('unsupported snapshot files refuse replacement and restore the old running state',async t=>{
  const f=await fixture(t);let injected=false;
  const run=async args=>{const result=await f.run(args);if(!injected&&args[0]==='cp'&&args[1]===`${oldId}:/home/box/chrome-profile`){injected=true;execFileSync('mkfifo',[path.join(args[2],'fixture-pipe')])}return result};
  await assert.rejects(life.replaceLocalDockerContainer({run,settingsPath:f.settingsPath,image,name,old:await life.inspectLocalContainer(run,name),createArgs:()=>assert.fail('must not create with unsupported snapshot'),waitReady:()=>assert.fail('must not start with unsupported snapshot')}),/unsupported special file/);
  assert.equal(f.old.running,true);assert.equal(f.locate(name).id,oldId);assert.equal(f.calls.some(c=>c[0]==='create'),false);
});

test('the actual settings connector preserves optional inference routing for connect, restart and replacement',async()=>{
  const source=await readFile('source/electron-main/box/local-docker-host-connector.ts','utf8');
  const {code}=await transform(source,{loader:'ts',format:'esm'});
  const ast=parse(code,{ecmaVersion:'latest',sourceType:'module'});
  const fn=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='createSettingsRoutedHostConnector');assert.ok(fn);
  const ensured=[],mutated=[],client={fixture:true},credential={accessToken:'synthetic-only',backendUrl:'https://synthetic.invalid',expiresAtMs:123};let issued=0,mode='local-docker',remoteCalls=0;
  const factory=new Function('ensureLocalDockerBox','serializeLocalLifecycle','createLocalDockerClient','inspectLocalContainer','mutateOwnedContainer','assertNoInterruptedReplacement','LOCAL_DOCKER_BOX_CONTAINER','LOCAL_DOCKER_BOX_IMAGE','OPTIONAL_CREDENTIAL_TIMEOUT_MS',`let ensureInFlight; return ${code.slice(fn.start,fn.end)};`);
  const create=factory(async(...args)=>{ensured.push(args);return{baseUrl:'fixture',token:'fixture'}},async action=>action(),async()=>client,async()=>({id:oldId}),async(...args)=>mutated.push(args),async()=>{},name,image,10);
  const routed=create({connect:async()=>{remoteCalls++;return{baseUrl:'remote',token:'fixture'}},issueInferenceCredential:async()=>{issued++;return credential},recreate:async()=>({status:'started-untrackable'}),forceRecreate:async()=>({status:'started-untrackable'})},{settingsPath:'/synthetic/settings.json',getBoxRuntime:()=>mode});
  await routed.connect();await routed.recreate({});await routed.forceRecreate();
  assert.equal(issued,3);assert.equal(ensured.length,3);for(const args of ensured){assert.equal(args[0],'/synthetic/settings.json');assert.equal(args[1],credential)}
  assert.deepEqual(ensured[1][2],{client});assert.deepEqual(ensured[2][2],{forceReplace:true});assert.equal(mutated.length,1);assert.equal(mutated[0][3],'restart');
  mode='remote';await routed.connect();await routed.recreate({});await routed.forceRecreate();assert.equal(remoteCalls,1);assert.equal(issued,3);assert.equal(ensured.length,3);
});
