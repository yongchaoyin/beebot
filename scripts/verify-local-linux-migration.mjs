// Opt-in real Docker lifecycle verification. No production container, account,
// mounts, ports or model endpoints are used. Uses only the already cached image.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';

if(process.env.BEEBOT_DOCKER_MIGRATION_TEST!=='1')throw Error('Run explicitly with BEEBOT_DOCKER_MIGRATION_TEST=1 against your local Docker engine.');
const compiled=await build({stdin:{contents:'export * from "./source/electron-main/box/local-docker-command.ts"; export * from "./source/electron-main/box/local-docker-lifecycle.ts";',resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const api=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const client=await api.createLocalDockerClient(),id=randomUUID(),name=`beebot-migration-${id}`,image='public.ecr.aws/k0i0n2g5/cursorenvironments/universal:sand-box-latest';
const temporary=await mkdtemp(path.join(tmpdir(),'beebot-migration-')),settingsPath=path.join(temporary,'settings.json'),created=new Set(),volumes=new Set(),checks=[];
const output=path.resolve('.build/local-linux-migration-report.json');await mkdir(path.dirname(output),{recursive:true});
const report={passed:false,checks,scope:'Real local Docker with existing public image; synthetic private files only. No Host/model process, production mounts, account credentials, network or published ports. Actual migration, verification and bootstrap code; controlled final idle process.'};
const command=async args=>{const result=await client.run(args);if(!result.ok)throw Error(`Fixture Docker ${args[0]} failed: ${result.output}`);return result.output};
const cleanup=async()=>{for(const container of created){await client.run(['rm','--force',container])}for(const volume of volumes){await client.run(['volume','rm',volume])}await rm(temporary,{recursive:true,force:true})};
const wait=()=>new Promise(resolve=>setTimeout(resolve,100));
const waitReady=async container=>{for(let i=0;i<100;i++){if((await client.run(['exec',container.id,'bash','-c','test "$(cat /var/lib/beebot-home/.fixture-ready 2>/dev/null)" = "$(cat /etc/hostname)"'])).ok)return;await wait()}throw Error('Fixture bootstrap did not finish')};
try{
  await command(['image','inspect','--format','{{json .Id}}',image]);
  await writeFile(settingsPath,'{}',{mode:0o600});
  const bootstrap=await api.stageLocalBootstrap(settingsPath),idle=path.join(temporary,'idle.sh');
  await writeFile(idle,'#!/bin/bash\nset -eu\ncat /etc/hostname > /var/lib/beebot-home/.fixture-ready\ntrap "exit 0" TERM\nwhile :; do sleep 1 & wait $!; done\n',{mode:0o700});
  const oldId=await command(['create','--platform','linux/amd64','--name',name,'--label','com.grok-bot.local-vm=1','--label','com.grok-bot.local-vm.schema-version=8','--network','none','--entrypoint','/bin/bash',image,'-c','trap "exit 0" TERM; while :; do sleep 1 & wait $!; done']);created.add(oldId);
  await command(['start',oldId]);
  // Only this new fixture is modified. All bytes are synthetic sentinels.
  await command(['exec',oldId,'bash','-c','rm -rf /home/box/chrome-profile /home/box/cli-config /home/box/.config; mkdir -p /home/box/chrome-profile/Default /home/box/chrome-profile/Fork-2/Default /home/box/cli-config /home/box/.config; printf "synthetic-cookies" > /home/box/chrome-profile/Default/Cookies; printf "synthetic-wal" > /home/box/chrome-profile/Default/Cookies-wal; printf "synthetic-login-db" > "/home/box/chrome-profile/Default/Login Data"; ln -s /home/box/chrome-profile/Default/Cookies /home/box/chrome-profile/Fork-2/Default/Cookies; ln -s fixture-old-host-123 /home/box/chrome-profile/SingletonLock; ln -s /tmp/fixture-old-socket /home/box/chrome-profile/Fork-2/SingletonSocket; ln -s fixture-cookie /home/box/chrome-profile/Fork-2/SingletonCookie; printf "synthetic-cli" > /home/box/cli-config/fixture; printf "synthetic-config" > /home/box/.config/fixture; printf \'{"assignments":{"synthetic-bot":2},"tokens":{"synthetic-bot":"synthetic-owner"}}\' > /home/box/.sand-window-assignments.json; chmod 600 /home/box/.sand-window-assignments.json']);
  const execute=async({failReady=false}={})=>{
    const old=await api.inspectLocalContainer(client.run,name);
    await api.replaceLocalDockerContainer({run:client.run,settingsPath,image,name,old,createArgs:async(snapshot,transaction)=>{
      volumes.add(snapshot.volume);
      // Data volume is fixture-only; the production workspace/data volumes are
      // never referenced. Reuse the fixture data volume across replacements.
      const data=`${name}-data`;volumes.add(data);
      return ['create','--platform','linux/amd64','--name',name,'--label','com.grok-bot.local-vm=1','--label','com.grok-bot.local-vm.schema-version=9','--label','com.beebot.local-vm.home-persistence=1','--label',`com.beebot.local-vm.transaction=${transaction}`,'--network','none','--volume',`${snapshot.volume}:${api.LOCAL_HOME_MOUNT}`,'--volume',`${data}:/home/box/sand-data`,'--mount',`type=bind,src=${bootstrap},dst=/run/beebot-bootstrap.sh,readonly`,'--mount',`type=bind,src=${idle},dst=/usr/local/bin/start-sand-box,readonly`,'--entrypoint','/bin/bash',image,'/run/beebot-bootstrap.sh'];
    },waitReady:async container=>{created.add(container.id);await waitReady(container);if(failReady)throw Error('deliberate fixture readiness rejection')}});
    const current=await api.inspectLocalContainer(client.run,name);created.add(current.id);return current;
  };
  const first=await execute();
  assert.notEqual(first.id,oldId);assert.equal((await api.inspectLocalContainer(client.run,oldId)).running,false);checks.push('legacy stopped container retained and replacement running');
  const verify=async (container,expectedSeat=2)=>{
    await command(['exec',container.id,'bash','-c','test -L /home/box/chrome-profile; test -L /home/box/cli-config; test -L /home/box/.config; test ! -L /home/box/chrome-profile/SingletonLock; test ! -L /home/box/chrome-profile/Fork-2/SingletonSocket; test ! -L /home/box/chrome-profile/Fork-2/SingletonCookie; test "$(cat /home/box/chrome-profile/Default/Cookies)" = synthetic-cookies; test "$(cat /home/box/chrome-profile/Default/Cookies-wal)" = synthetic-wal; test "$(cat "/home/box/chrome-profile/Default/Login Data")" = synthetic-login-db; test "$(cat /home/box/chrome-profile/Fork-2/Default/Cookies)" = synthetic-cookies; test "$(cat /home/box/cli-config/fixture)" = synthetic-cli; test "$(cat /home/box/.config/fixture)" = synthetic-config; test "$(stat -c %U /var/lib/beebot-home/chrome-profile/Default/Cookies)" = box; test -f /home/box/sand-data/local-linux-state/window-assignments.json; test "$(stat -c %U:%G:%a /home/box/sand-data/local-linux-state)" = box:box:700; test "$(stat -c %U:%G:%a /home/box/sand-data/local-linux-state/window-assignments.json)" = box:box:600; test ! -e /var/lib/beebot-home/window-assignments.json']);
    await command(['exec','--user','box',container.id,'bash','-c','test -r /home/box/sand-data/local-linux-state/window-assignments.json; test -w /home/box/sand-data/local-linux-state/window-assignments.json; test -x /home/box/sand-data/local-linux-state; test -w /home/box/sand-data/local-linux-state']);
    const target=path.join(temporary,`mapping-${container.id}.json`);await command(['cp',`${container.id}:${api.LOCAL_ASSIGNMENTS_PATH}`,target]);assert.deepEqual(JSON.parse(await readFile(target,'utf8')).assignments,{'synthetic-bot':expectedSeat});
  };
  await verify(first);checks.push('real stopped-volume copy/readback and bootstrap preserve cookies/WAL/login symlink/config/assignment with box ownership; stale Chromium singleton links cleared');
  await command(['exec','--user','box',first.id,'bash','-c','umask 077; printf \'{"assignments":{"synthetic-bot":3},"tokens":{"synthetic-bot":"synthetic-updated-owner"}}\' > /home/box/sand-data/local-linux-state/updated; mv /home/box/sand-data/local-linux-state/updated /home/box/sand-data/local-linux-state/window-assignments.json']);
  await command(['exec',first.id,'rm','/var/lib/beebot-home/.fixture-ready']);
  await command(['restart',first.id]);await waitReady(first);await verify(first,3);checks.push('box can read/write the private 0600 assignment in its 0700 parent; restart preserves the newer assignment and never replays the imported file');
  const second=await execute();await verify(second,3);checks.push('second replacement reads persistent profile source and preserves existing login linkage');
  await assert.rejects(execute({failReady:true}),/deliberate fixture/);const restored=await api.inspectLocalContainer(client.run,name);assert.equal(restored.id,second.id);assert.equal(restored.running,true);await verify(restored,3);checks.push('post-bootstrap readiness rejection restores prior container name/running state and data');
  report.passed=true;
}catch(error){report.error=error.message;process.exitCode=1}
finally{
  // Discover only containers with this random fixture prefix, including any
  // create that failed before waitReady could record its immutable ID.
  const owned=await client.run(['ps','-a','--filter',`name=${name}`,'--format','{{.ID}} {{.Names}}']);
  if(owned.ok)for(const line of owned.output.split('\n')){const [container,containerName]=line.trim().split(/\s+/);if(containerName===name||containerName?.startsWith(`${name}-`))created.add(container)}
  await cleanup();report.cleanedUp=true;await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:checks.length,cleanedUp:report.cleanedUp,report:output}));
}
