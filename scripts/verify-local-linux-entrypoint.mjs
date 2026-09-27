// Opt-in smoke of the actual image entrypoint and packaged Host. All resources,
// account data and RPC inputs belong to a new disposable offline fixture.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';

if(process.env.BEEBOT_DOCKER_ENTRYPOINT_TEST!=='1')throw Error('Explicit BEEBOT_DOCKER_ENTRYPOINT_TEST=1 is required.');
const [hostArgument,daemonArgument]=process.argv.slice(2);
if(!hostArgument||!daemonArgument)throw Error('Pass the built host-main.cjs and box-exec-daemon/main.cjs paths.');
const host=path.resolve(hostArgument),daemon=path.resolve(daemonArgument);
const [hostBytes,daemonBytes]=await Promise.all([readFile(host),readFile(daemon)]);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const compiled=await build({stdin:{contents:'export * from "./source/electron-main/box/local-docker-command.ts"; export * from "./source/electron-main/box/local-docker-lifecycle.ts";',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const api=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const client=await api.createLocalDockerClient(),uuid=randomUUID(),name=`beebot-entrypoint-${uuid}`,image='public.ecr.aws/k0i0n2g5/cursorenvironments/universal:sand-box-latest';
const temporary=await mkdtemp(path.join(tmpdir(),'beebot-entrypoint-')),settings=path.join(temporary,'settings.json'),token=`fixture-${randomUUID()}`;
const volumes=['workspace','data','home'].map(kind=>`${name}-${kind}`),checks=[];
const report={passed:false,checks,hostSha256:digest(hostBytes),mountedDaemonSha256:digest(daemonBytes),scope:'Actual upstream start-sand-box and supervisor launch the supplied Host. Existing image exec-daemon is selected exactly as production local Docker (SAND_USE_EXISTING_BOX_EXEC_DAEMON=1); mounted reconstructed daemon is not claimed active. Synthetic Bot, offline network, no published ports, no production mounts/auth/model/messages.'};
const output=path.resolve('.build/local-linux-entrypoint-report.json');await mkdir(path.dirname(output),{recursive:true});
let container;
const command=async args=>{const result=await client.run(args);if(!result.ok)throw Error(`Fixture Docker ${args[0]} failed: ${result.output}`);return result.output};
const pause=()=>new Promise(resolve=>setTimeout(resolve,500));
const node=(source,...args)=>command(['exec',container,'/exec-daemon/node','-e',source,...args]);
const waitGateway=async()=>{
  const deadline=Date.now()+180000;
  while(Date.now()<deadline){const result=await client.run(['exec',container,'/exec-daemon/node','-e','fetch("http://127.0.0.1:1340/health",{signal:AbortSignal.timeout(1500)}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(h=>{if(h.ok!==true)throw Error()}).catch(()=>process.exitCode=1)']);if(result.ok)return;await pause()}
  throw Error('Actual Host/Gateway did not become ready within 180s');
};
const request=async(method,body={})=>JSON.parse(await node('fetch("http://127.0.0.1:1340/api/"+process.argv[1],{method:"POST",headers:{authorization:"Bearer "+process.env.SAND_GATEWAY_TOKEN,"content-type":"application/json"},body:process.argv[2],signal:AbortSignal.timeout(60000)}).then(async r=>{if(!r.ok)throw Error("gateway request "+r.status+": "+await r.text());console.log(await r.text())}).catch(e=>{console.error(e.message);process.exitCode=1})',method,JSON.stringify(body)));
try{
  const imageState=JSON.parse(await command(['image','inspect','--format','{{json .}}',image]));assert.deepEqual(imageState.Config.Entrypoint,['/usr/local/bin/start-sand-box']);report.imageId=imageState.Id;
  await writeFile(settings,'{}',{mode:0o600});const bootstrap=await api.stageLocalBootstrap(settings);report.bootstrapSha256=digest(await readFile(bootstrap));
  // Compile the real generated Connect client and exec resource serialization.
  // Only the supplied Shell/Read arguments below are fixture data.
  const probe=await build({stdin:{contents:`
    import assert from 'node:assert/strict';
    import {createBoxRemoteResourceAccessor} from './source/host/box/box-remote-accessor.ts';
    import {productionBoxGeneratedPorts} from './source/host/box/generated-production.ts';
    import {createContext} from './source/packages/context/core.ts';
    import {shellExecutorResource} from './source/packages/agent-exec/shell.ts';
    import {readExecutorResource} from './source/packages/agent-exec/read.ts';
    import {buildHostShellArgs} from './source/host/box/box-shell-command.ts';
    import {ReadArgs} from './source/packages/proto/generated/agent/v1/read_exec_pb.ts';
    (async()=>{const ctx=createContext().withTimeout(20000),accessor=createBoxRemoteResourceAccessor({host:'127.0.0.1',port:process.argv[2]?1339:1337,authToken:'local',...(process.argv[2]?{headers:{'x-sand-display':process.argv[2],'x-sand-window-owner':process.argv[3]}}:{})},productionBoxGeneratedPorts);
    const shell=await accessor.get(shellExecutorResource).execute(ctx,buildHostShellArgs({command:"pwd; printf 'synthetic-rpc-file' > entrypoint-smoke.txt",name:'fixture-shell',workingDirectory:'/workspace',toolCallId:'synthetic-entrypoint-smoke'}));
    assert.equal(shell.result.case,'success',JSON.stringify(shell.toJson()));assert.equal(shell.result.value.exitCode,0);assert.equal(shell.result.value.stdout.trim(),'/workspace');
    const read=await accessor.get(readExecutorResource).execute(ctx,new ReadArgs({path:'/workspace/entrypoint-smoke.txt'}));assert.equal(read.result.case,'success',JSON.stringify(read.toJson()));assert.equal(read.result.value.output.case,'content');assert.equal(read.result.value.output.value,'synthetic-rpc-file');
    console.log(JSON.stringify({shell:true,read:true,workingDirectory:'/workspace'}));process.exit(0);
    })().catch(e=>{console.error(e.stack);process.exit(1)});
  `,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',target:'node22',logLevel:'silent'});
  const probePath=path.join(temporary,'probe.cjs');await writeFile(probePath,probe.outputFiles[0].text,{mode:0o600});
  for(const volume of volumes)await command(['volume','create','--label',`beebot.test=${name}`,volume]);
  const created=await command(['create','--platform','linux/amd64','--name',name,'--label',`beebot.test=${name}`,'--network','none','--env','SAND_SUPERVISOR_ENABLED=1','--env','SAND_BOX_AUTO_UPDATE=0','--env','SAND_USE_EXISTING_BOX_EXEC_DAEMON=1','--env','SAND_TREE_SITTER_NODE_DEPS=/home/box/deps','--env','NODE_PATH=/home/box/deps','--env','SAND_GATEWAY_BIND_HOST=127.0.0.1','--env','SAND_HOST_PORT=1340','--env',`SAND_GATEWAY_TOKEN=${token}`,'--env',`BEEBOT_DESKTOP_ASSIGNMENTS_PATH=${api.LOCAL_ASSIGNMENTS_PATH}`,'--volume',`${volumes[0]}:/workspace`,'--volume',`${volumes[1]}:/home/box/sand-data`,'--volume',`${volumes[2]}:${api.LOCAL_HOME_MOUNT}`,'--mount',`type=bind,src=${host},dst=/home/box/sand-host/host-main.cjs,readonly`,'--mount',`type=bind,src=${path.dirname(daemon)},dst=/home/box/box-exec-daemon,readonly`,'--mount',`type=bind,src=${bootstrap},dst=/run/beebot-bootstrap.sh,readonly`,'--mount',`type=bind,src=${probePath},dst=/run/beebot-fixture-probe.cjs,readonly`,'--entrypoint','/bin/bash',image,'/run/beebot-bootstrap.sh']);
  assert.match(created,/^[a-f0-9]{64}$/);container=created;
  await command(['start',container]);
  await waitGateway();checks.push('actual upstream entrypoint/supervisor and supplied Host expose gateway health');
  const empty=await request('listAgents');assert.ok(Array.isArray(empty));assert.equal(empty.length,0);checks.push('fresh actual Host has no implicit Bot');
  const minted=await request('createAgent',{name:'Synthetic lifecycle fixture',description:'Disposable integration fixture',isIntroductionSuppressed:true,isKickstartRequested:false});const agentId=minted.agent?.id;assert.equal(typeof agentId,'string');assert.ok(agentId.length>0);
  // Restart after seeding: the next Host sees the assignment before any startup
  // observer can cache an empty map. A non-default fork proves actual loading.
  const owner=randomUUID();
  await node('const fs=require("node:fs"),path=require("node:path");fs.mkdirSync(path.dirname(process.argv[1]),{recursive:true,mode:0o700});fs.writeFileSync(process.argv[1],JSON.stringify({assignments:{[process.argv[2]]:7},tokens:{[process.argv[2]]:process.argv[3]}}),{mode:0o600});',api.LOCAL_ASSIGNMENTS_PATH,agentId,owner);
  await command(['restart',container]);await waitGateway();
  const box=await request('ensureForeverBox',{id:agentId});assert.equal(box.state,'running');assert.match(box.vncUrl,/:6081(?:\/|$)/);assert.match(decodeURIComponent(new URL(box.vncUrl).searchParams.get('path')??''),/token=7$/);
  const assignment=JSON.parse(await node('const fs=require("node:fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log(JSON.stringify({seat:a.assignments[process.argv[2]],owner:a.tokens[process.argv[2]]===process.argv[3]}));',api.LOCAL_ASSIGNMENTS_PATH,agentId,owner));assert.equal(assignment.seat,7);assert.equal(assignment.owner,true);checks.push('restarted actual Host restores the seeded fork 7 and owner token for its synthetic Bot without inference');
  const result=JSON.parse(await command(['exec',container,'/exec-daemon/node','/run/beebot-fixture-probe.cjs']));assert.equal(result.shell,true);assert.equal(result.read,true);checks.push('real generated exec-daemon RPC Shell reports /workspace and Read retrieves the file it wrote');
  const fork=JSON.parse(await command(['exec',container,'/exec-daemon/node','/run/beebot-fixture-probe.cjs','7',owner]));assert.equal(fork.shell,true);assert.equal(fork.read,true);checks.push('restored fork 7 accepts real owner-authenticated RPC Shell and Read');
  const rows=await request('listAgents');assert.equal(rows.length,1);assert.equal(rows[0].id,agentId);report.passed=true;
}catch(error){report.error=error.message;process.exitCode=1;if(container){const log=await client.run(['logs','--tail','100',container]);await writeFile(path.resolve('.build/local-linux-entrypoint-container.log'),log.output)}}
finally{
  let clean=true;
  const target=container??name;
  const identity=await client.run(['inspect','--format','{{index .Config.Labels "beebot.test"}}',target]);
  if(identity.ok&&identity.output===name)clean=(await client.run(['rm','--force',target])).ok;
  else if(identity.ok||container)clean=false;
  for(const volume of volumes){const identity=await client.run(['volume','inspect','--format','{{index .Labels "beebot.test"}}',volume]);if(identity.ok&&identity.output===name){if(!(await client.run(['volume','rm',volume])).ok)clean=false}else if(identity.ok)clean=false}
  await rm(temporary,{recursive:true,force:true});report.cleanedUp=clean;if(!clean){report.passed=false;process.exitCode=1}await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:checks.length,cleanedUp:clean,report:output}));
}
