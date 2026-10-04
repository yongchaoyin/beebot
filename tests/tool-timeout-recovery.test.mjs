import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {getEventListeners} from 'node:events';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import test from 'node:test';
import {build} from 'esbuild';
const directory=await mkdtemp(path.join(os.tmpdir(),'beebot-timeout-recovery-'));
const outfile=path.join(directory,'runtime.mjs');
await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(directory,'node_modules'),'dir');
await build({stdin:{contents:`export {executeWithToolDeadline} from './source/host/runner/tools/tool-timeout-cancellation.ts'; export {withToolTimeout,withLocalToolScope} from './source/host/runner/tools/turn-toolset.ts'; export {sandLocalToolScopeKey,sandTurnDirectionEpochKey} from './source/shared/local-tool-permission-machinery.ts'; export {wrapDynamicInvocationToolWithTimeout,sandToolCallExecutionTimeoutMs} from './source/host/runner/tools/mcp-meta-tools.ts'; export {createContext,createKey} from './source/packages/context/core.ts'; export {SandRunScheduler} from './source/host/extensions/transcript/run-scheduler.ts'; export {buildToolCallExecutionTimedOutMessage} from './source/packages/agent/tools/tool-execution-timeout.ts'; export {InteractionHandler} from './source/packages/agent/interaction-handler.ts'; export {ToolCall} from './source/packages/proto/generated/agent/v1/agent_pb.ts'; export {toolExecutionTimeoutSuspensionKey,withToolExecutionTimeoutSuspended} from './source/packages/agent/tools/tool-timeout-suspension.ts'; export {trackToolExecution} from './source/packages/agent/tools/tool-execution-tracking.ts'; export {LocalShellStreamExecutor} from './source/packages/local-exec/shell-stream.ts'; export {CoreShellFactory,BackgroundShellManager} from './source/packages/local-exec/background-shell.ts'; export {TimeoutBehavior} from './source/packages/proto/generated/agent/v1/shell_exec_pb.ts';`,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'ts'},outfile,bundle:true,packages:'external',platform:'node',format:'esm',target:'node26',logLevel:'silent',banner:{js:'import {createRequire as beebotRecoveryRequire} from "node:module"; const require=beebotRecoveryRequire(import.meta.url);'}});
const runtime=await import(pathToFileURL(outfile).href);test.after(()=>rm(directory,{recursive:true,force:true}));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('actual static tool timeout cancels an OS command and awaits its acknowledged exit',async()=>{
 const context=runtime.createContext(),key=runtime.createKey(Symbol('scope'),'unset');let killed=false,closed=false,called=0;
 const tool=runtime.withToolTimeout({name:'Shell',execute:async child=>{called++;assert.equal(child.get(key),'authorized');return await new Promise((resolve,reject)=>{const process=spawn(globalThis.process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});const abort=()=>{killed=true;process.kill('SIGTERM');};child.signal.addEventListener('abort',abort,{once:true});process.once('error',reject);process.once('close',()=>{closed=true;child.signal.removeEventListener('abort',abort);resolve('closed');});});}},50);
 await assert.rejects(tool.execute(context.with(key,'authorized')),/timed out/);assert.equal(called,1);assert.equal(killed,true);assert.equal(closed,true);assert.equal(context.canceled,false);assert.equal(getEventListeners(context.signal,'abort').length,0);
});
test('a noncooperative operation retains its exclusive Bot lease after the cancellation request',async()=>{
 const gate=Promise.withResolvers(),context=runtime.createContext();let cancelSignal,starts=0,settled=false;
 const firstTool=runtime.withToolTimeout({name:'computer',execute:async child=>{cancelSignal=child.signal;await gate.promise;return 'late result';}},20);
 const scheduler=new runtime.SandRunScheduler({watchdogMs:1000,watchdogGraceMs:1000,interruptWedgedRun:()=>false,telemetry:{onAccepted(){},onDequeued(){},onWatchdog(){}}});
 try{const first=scheduler.enqueue('bot',async()=>{starts++;await firstTool.execute(context);},{lane:'user',source:'turn'});first.catch(()=>{}).finally(()=>{settled=true;});const second=scheduler.enqueue('bot',async()=>{starts++;},{lane:'user',source:'turn'});await delay(60);assert.equal(cancelSignal.aborted,true);assert.equal(starts,1);assert.equal(settled,false);gate.resolve();await assert.rejects(first,/timed out/);await second;assert.equal(starts,2);}finally{gate.resolve();scheduler.dispose();}
});
test('Stop cancellation reaches the child, retains scope, and never starts an already-cancelled tool',async()=>{const base=runtime.createContext(),[parent,cancel]=base.withCancel();let calls=0;const gate=Promise.withResolvers();const tool=runtime.withToolTimeout({name:'Shell',execute:child=>{calls++;child.signal.addEventListener('abort',()=>gate.reject(child.reason),{once:true});return gate.promise;}},1000);const run=tool.execute(parent);cancel(Error('user stop'));await assert.rejects(run,/user stop/);await assert.rejects(tool.execute(parent),/user stop/);assert.equal(calls,1);assert.equal(getEventListeners(parent.signal,'abort').length,0);});
test('successful calls preserve results and remove cancellation listeners across repeated calls',async()=>{const context=runtime.createContext();let lastChild;const tool=runtime.withToolTimeout({name:'Read',execute:async child=>{lastChild=child;return {result:42};}},1000);for(let i=0;i<30;i++)assert.deepEqual(await tool.execute(context),{result:42});assert.equal(getEventListeners(context.signal,'abort').length,0);assert.equal(context.canceled,false);assert.equal(lastChild.canceled,false);});
test('dynamic invocation uses the same cancellable deadline and preserves the argument stream',async t=>{t.mock.timers.enable({apis:['setTimeout']});const context=runtime.createContext(),gate=Promise.withResolvers();let child,seen;const tool=runtime.wrapDynamicInvocationToolWithTimeout({name:'CallMcpTool',execute:async(ctx,_handler,stream)=>{child=ctx;seen='';for await(const chunk of stream)seen+=chunk;return await gate.promise;}},{resolveToolName:()=> 'slack_post_message'},false);const stream=(async function*(){yield '{"text":"approved"}';})();const run=tool.execute(context,{},stream,{});await Promise.resolve();await Promise.resolve();await Promise.resolve();t.mock.timers.tick(runtime.sandToolCallExecutionTimeoutMs('slack_post_message',false)+1);assert.equal(child.canceled,true);gate.resolve('late');await assert.rejects(run,/slack_post_message.*timed out/);assert.equal(seen,'{"text":"approved"}');assert.equal(context.canceled,false);});
test('timeout guidance requests review and never claims termination or recommends automatic replay',()=>{const message=runtime.buildToolCallExecutionTimedOutMessage({toolName:'Shell',executionTimeoutMs:1000});assert.match(message,/Cancellation was requested/);assert.match(message,/Do not repeat/);assert.doesNotMatch(message,/was terminated|re-run with/);});

function createInteractionHandler() {
 return new runtime.InteractionHandler({sendUpdate:async()=>{}},{recordToolCall(){}},'timeout-test');
}

test('real InteractionHandler UI abort cannot release the Bot lease before its executor settles',async()=>{
 const gate=Promise.withResolvers(),context=runtime.createContext(),interaction=createInteractionHandler();
 let executorSignal,executorSettled=false,starts=0,uiAborted=false;
 const tool=runtime.withToolTimeout({name:'Shell',execute:async child=>{
  try {
   return await interaction.executeToolCall(child,new runtime.ToolCall(),'call',async executionContext=>{
    executorSignal=executionContext.signal;
    await gate.promise;
    executorSettled=true;
    return 'late result';
   },()=>new runtime.ToolCall());
  }catch(error){uiAborted=true;throw error;}
 }},20);
 const scheduler=new runtime.SandRunScheduler({watchdogMs:25,watchdogGraceMs:25,interruptWedgedRun:()=>false,telemetry:{onAccepted(){},onDequeued(){},onWatchdog(){}}});
 try {
  const first=scheduler.enqueue('bot',async()=>{starts++;await tool.execute(context);},{lane:'user',source:'turn'});
  first.catch(()=>{});
  const second=scheduler.enqueue('bot',async()=>{starts++;},{lane:'user',source:'turn'});
  await delay(70);
  assert.equal(executorSignal.aborted,true);
  assert.equal(uiAborted,true);
  assert.equal(executorSettled,false);
  assert.equal(starts,1);
  gate.resolve();
  await assert.rejects(first,/timed out/);
  await second;
  assert.equal(executorSettled,true);
  assert.equal(starts,2);
 }finally{gate.resolve();scheduler.dispose();}
});

test('Stop remains the first cancellation reason after a late noncooperative settlement',async()=>{
 const [context,cancel]=runtime.createContext().withCancel(),gate=Promise.withResolvers(),stop=Error('user stop first');
 let child;
 const tool=runtime.withToolTimeout({name:'Shell',execute:async ctx=>{child=ctx;return await gate.promise;}},20);
 const run=tool.execute(context);
 run.catch(()=>{});
 cancel(stop);
 await delay(60);
 assert.equal(child.reason,stop);
 gate.resolve('late');
 await assert.rejects(run,error=>error===stop);
 assert.equal(getEventListeners(context.signal,'abort').length,0);
});

test('nested approval suspension pauses every deadline and resumes only after the last wait',async()=>{
 const context=runtime.createContext(),key=runtime.createKey(Symbol('permission-scope'),'missing');
 let outerChild,innerChild;
 const run=runtime.executeWithToolDeadline(context.with(key,'original'),35,async outer=>{
  outerChild=outer;
  return await runtime.executeWithToolDeadline(outer,35,async inner=>{
   innerChild=inner;
   assert.equal(inner.get(key),'original');
   const resume=inner.get(runtime.toolExecutionTimeoutSuspensionKey).suspend();
   await runtime.withToolExecutionTimeoutSuspended(inner,async()=>{
    await delay(50);
    assert.equal(outer.canceled,false);
    assert.equal(inner.canceled,false);
   });
   await delay(40);
   assert.equal(outer.canceled,false);
   assert.equal(inner.canceled,false);
   resume();resume();
   return 'approved result';
  },()=>Error('inner deadline'));
 },()=>Error('outer deadline'));
 assert.equal(await run,'approved result');
 assert.equal(outerChild.canceled,false);
 assert.equal(innerChild.canceled,false);
});

test('a resumed approval deadline still cancels, while Stop also cancels a suspended approval',async()=>{
 const context=runtime.createContext();
 await assert.rejects(runtime.executeWithToolDeadline(context,20,async child=>{
  await runtime.withToolExecutionTimeoutSuspended(child,()=>delay(50));
  await delay(40);
 },()=>Error('resumed deadline')),/resumed deadline/);
 const [parent,cancel]=runtime.createContext().withCancel(),stop=Error('stop approval'),started=Promise.withResolvers();
 const run=runtime.executeWithToolDeadline(parent,20,child=>runtime.withToolExecutionTimeoutSuspended(child,()=>{
  started.resolve();
  return new Promise((resolve,reject)=>child.signal.addEventListener('abort',()=>reject(child.reason),{once:true}));
 }),()=>Error('approval deadline'));
 run.catch(()=>{});
 await started.promise;
 cancel(stop);
 await assert.rejects(run,error=>error===stop);
});

test('nested execution tracking retains the outer owner after an inner UI abort',async()=>{
 const context=runtime.createContext(),gate=Promise.withResolvers();let settled=false,actualSignal;
 const run=runtime.executeWithToolDeadline(context,20,async outer=>{
  try {
   await runtime.executeWithToolDeadline(outer,1000,async inner=>{
    actualSignal=inner.signal;
    runtime.trackToolExecution(inner,gate.promise);
    await new Promise((resolve,reject)=>inner.signal.addEventListener('abort',()=>reject(inner.reason),{once:true}));
   },()=>Error('inner deadline'));
  }catch{}
 },()=>Error('outer deadline'));
 run.catch(()=>{}).finally(()=>{settled=true;});
 await delay(60);
 assert.equal(actualSignal.aborted,true);
 assert.equal(settled,false);
 gate.resolve();
 await assert.rejects(run,/outer deadline/);
});

test('existing Shell background handoff transfers execution before releasing the deadline owner',async()=>{
 const gate=Promise.withResolvers(),context=runtime.createContext(),interaction=createInteractionHandler();
 const background=new runtime.BackgroundShellManager(new runtime.CoreShellFactory());
 const completedScopes=[];
 let coreSignal,completed=false,backgrounded;
 const core={getCwd:async()=>os.tmpdir(),async *execute(_context,args){
  coreSignal=args.signal;
  yield {type:'stdin_ready',pid:1234,stdin:{write(){}}};
  await gate.promise;
  completed=true;
  yield {type:'exit',code:0,aborted:false,localExecutionTimeMs:1};
 }};
 const permissions={shouldEnforceShellInvariantBlocks:async()=>({kind:'allow'}),shouldBlockShellCommand:async()=>({kind:'allow'})};
 const stream=new runtime.LocalShellStreamExecutor(permissions,core,{getCursorIgnoreMapping:async()=>({})},background);
 const tool=runtime.withToolTimeout(runtime.withLocalToolScope({name:'Shell',execute:child=>interaction.executeToolCall(child,new runtime.ToolCall(),'background-call',async executionContext=>{
  for await(const event of stream.execute(executionContext,{command:'sleep 10',workingDirectory:os.tmpdir(),toolCallId:'background-call',timeout:10,timeoutBehavior:runtime.TimeoutBehavior.BACKGROUND})){
   if(event.event.case==='backgrounded')backgrounded=event.event.value;
  }
  return 'handed off';
 },()=>new runtime.ToolCall())},'background-bot',{completeScope:scope=>completedScopes.push(scope)},'run-command'),1000);
 try {
  assert.equal(await tool.execute(context,interaction,(async function*(){yield '{}';})(),{toolCallId:'background-call'}),'handed off');
  assert.equal(typeof backgrounded.shellId,'number');
  assert.deepEqual(completedScopes,[{agentId:'background-bot',toolCallId:'background-call',action:'run-command'}]);
  assert.equal(completed,false);
  assert.equal(coreSignal.aborted,false);
  gate.resolve();
  await delay(10);
  assert.equal(completed,true);
  assert.equal(coreSignal.aborted,false);
 }finally{gate.resolve();background.dispose();}
});

test('actual local permission scope is retained until acknowledgement without widening identity or action',async()=>{
 const context=runtime.createContext().with(runtime.sandTurnDirectionEpochKey,17),gate=Promise.withResolvers(),interaction=createInteractionHandler();
 const completed=[];let seenScope,executorContext;
 const scoped=runtime.withLocalToolScope({name:'ExternalShell',execute:(child,_handler,_stream,meta)=>interaction.executeToolCall(child,new runtime.ToolCall(),meta.toolCallId,async ctx=>{
  executorContext=ctx;
  seenScope=ctx.get(runtime.sandLocalToolScopeKey);
  await gate.promise;
  return 'late';
 },()=>new runtime.ToolCall())},'bot-a',{completeScope:scope=>completed.push(scope)},'run-command');
 const tool=runtime.withToolTimeout(scoped,20);
 const run=tool.execute(context,interaction,(async function*(){yield '{}';})(),{toolCallId:'scope-call'});
 run.catch(()=>{});
 await delay(60);
 assert.equal(executorContext.canceled,true);
 assert.deepEqual(seenScope,{agentId:'bot-a',toolCallId:'scope-call',directionEpoch:17,action:'run-command'});
 assert.deepEqual(completed,[]);
 gate.resolve();
 await assert.rejects(run,/timed out/);
 assert.deepEqual(completed,[seenScope]);
 assert.equal(context.get(runtime.sandLocalToolScopeKey),undefined);
});

test('nondeadline InteractionHandler abort remains responsive while normal calls remove listeners',async()=>{
 const [context,cancel]=runtime.createContext().withCancel(),gate=Promise.withResolvers(),interaction=createInteractionHandler();
 const run=interaction.executeToolCall(context,new runtime.ToolCall(),'unscoped',()=>gate.promise,()=>new runtime.ToolCall());
 run.catch(()=>{});
 await Promise.resolve();await Promise.resolve();
 cancel(Error('stop unscoped'));
 await assert.rejects(run,/aborted/i);
 gate.resolve('late');
 assert.equal(getEventListeners(context.signal,'abort').length,0);
 const healthy=runtime.createContext();
 for(let i=0;i<15;i++)assert.equal(await interaction.executeToolCall(healthy,new runtime.ToolCall(),`healthy-${i}`,async()=>42,()=>new runtime.ToolCall()),42);
 assert.equal(getEventListeners(healthy.signal,'abort').length,0);
});

test('a nested local scope waits for its own executor without waiting on its caller',async()=>{
 const context=runtime.createContext(),interaction=createInteractionHandler(),completed=[];
 const scoped=runtime.withLocalToolScope({name:'ExternalShell',execute:(child,_handler,_stream,meta)=>interaction.executeToolCall(child,new runtime.ToolCall(),meta.toolCallId,async()=>42,()=>new runtime.ToolCall())},'nested-bot',{completeScope:scope=>completed.push(scope)},'run-command');
 const tool=runtime.withToolTimeout({name:'CallMcpTool',execute:child=>interaction.executeToolCall(child,new runtime.ToolCall(),'outer-scope',async ctx=>await scoped.execute(ctx,interaction,(async function*(){yield '{}';})(),{toolCallId:'inner-scope'}),()=>new runtime.ToolCall())},1000);
 assert.equal(await tool.execute(context),42);
 assert.deepEqual(completed,[{agentId:'nested-bot',toolCallId:'inner-scope',action:'run-command'}]);
});
