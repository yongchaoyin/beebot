import assert from "node:assert/strict";
import test,{after} from "node:test";
import { mkdtempSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const directory=mkdtempSync(path.join(tmpdir(),"bb-draft-delivery-")),root=path.resolve(import.meta.dirname,"..");
after(()=>rmSync(directory,{recursive:true,force:true}));
const entry=path.join(directory,"entry.ts"),outfile=path.join(directory,"host.cjs");
writeFileSync(entry,["host/extensions/transcript/draft-delivery","host/extensions/session/agent-session","host/extensions/transcript/group-chat-glue","host/groups/group-store","host/host-gateway-api","host/runner/tools/send-message-tool","host/runner/tools/send-message-schema","host/extensions/transcript/group-publications","host/extensions/transcript/transcript-store"].map(p=>`export * from ${JSON.stringify(path.join(root,"source",p+".ts"))};`).join("\n"));
await build({entryPoints:[entry],bundle:true,platform:"node",format:"cjs",target:"node26",outfile,logLevel:"silent",external:["tree-sitter","tree-sitter-bash"]});
const host=createRequire(import.meta.url)(outfile);
const slackTool=(id="slack",thread=false)=>({name:`${id}:send`,toolName:thread?"slack_reply_to_thread":"slack_post_message",providerIdentifier:id,senderLabel:`Workspace ${id}`,inputSchema:{type:"object",properties:{channel_id:{type:"string"},text:{type:"string"},...(thread?{thread_ts:{type:"string"}}:{})},required:thread?["channel_id","thread_ts","text"]:["channel_id","text"]}});
const emailTool={name:"email:send",toolName:"email-send-v1",providerIdentifier:"email",inputSchema:{type:"object","x-beebot-draft-delivery":{version:1,kind:"email"},properties:{from:{type:"string"},to:{type:"array",items:{type:"string"}},cc:{type:"array",items:{type:"string"}},subject:{type:"string"},body:{type:"string"}},required:["to","subject","body"]}};
const slack={type:"slack-draft",draft:{workspace:"Fixture",target:"C123456789",body:"Original"}};
const email={type:"email-draft",draft:{from:"bot@example.test",to:["a@example.test"],subject:"Original subject",body:"Original"}};
const success=(args)=>({result:{case:"success",value:{content:[{content:{case:"text",value:{text:JSON.stringify({ok:true,channel:args.channel_id,ts:"123.456",message:{text:args.text}})}}}]}}});
const declaredSuccess={result:{case:"success",value:{structuredContent:{sent:true,messageId:"fixture-message"}}}};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise};};
async function setup(t,{group=false,tools=[slackTool(),emailTool],executor}={}){
 const dir=mkdtempSync(path.join(directory,"case-")),store=new host.SandAgentSessionStore(path.join(dir,"agents")),a=await store.createSession({name:"A"}),b=await store.createSession({name:"B"}),room=group?await store.createSession({name:"Group"}):a;
 if(group)host.writeSandGroupConfig(path.dirname(room.dbPath),{version:1,memberIds:[a.id,b.id]});
 const sessions=new Map([a,b,room].map(s=>[s.id,s])),events=[],calls=[];
 t.after(()=>{for(const session of sessions.values())session.db.close();});
 const tm={sessionStore:store,sessions:{isAgentGone:()=>false,resolveBackgroundSession:async id=>{if(!sessions.has(id))throw new Error("gone");return sessions.get(id);},inMemoryTranscriptAgentId:b.id},roster:{emit:(event,id)=>events.push({event,id})}};
 tm.groupChat=new host.GroupChatGlue(tm);const service=new host.DraftDelivery(tm);tm.draftDelivery=service;
 const ports={listTools:async()=>tools,executeTool:async request=>{calls.push(request);return executor?executor(request):request.providerIdentifier==="email"?declaredSuccess:success(request.args);}};
 service.configure(ports);
 const add=(id,message=slack,extra={})=>room.db.appendTranscriptEntry({id,kind:"send-message",timestampMs:1,message,...(group?{author:{id:a.id,name:"A"}}:{}),...extra});
 const query=id=>({agentId:room.id,entryId:id});
 const action=async(id,message=slack,extra={})=>{const view=await service.snapshot(query(id));return {agentId:room.id,entryId:id,requestId:`request-${id}`,expectedVersion:view.version,expectedHash:view.hash,action:"send",message,expectedSenderHash:view.senders?.[0]?.bindingHash||"0".repeat(64),...extra};};
 return{dir,store,tm,a,b,room,sessions,service,ports,calls,events,tools,add,query,action};
}
for(const group of [false,true]){
 test(`${group?"Group":"single Bot"}: editable Slack payload, second/third cards, exact adapter and durable receipts`,async t=>{
  const h=await setup(t,{group});for(const id of ["first","second","third"])h.add(id);
  for(const [index,id] of ["first","second","third"].entries()){
   const message={...slack,draft:{...slack.draft,body:`Edited ${index}`}},args=await h.action(id,message),result=await h.service.action(args);
   assert.equal(result.state,"sent");assert.equal(result.receipt.messageId,"123.456");assert.equal(result.message.draft.body,`Edited ${index}`);
   const saved=h.room.db.getEntryById(id);assert.equal(saved.draftDelivery.state,"sent");assert.equal(h.calls[index].agentId,h.a.id);assert.deepEqual(h.calls[index].args,{channel_id:"C123456789",text:`Edited ${index}`});
  }
  const reopened=await h.store.openSession(h.room.id);try{assert.ok(reopened.db.getTranscriptEntries().every(e=>e.draftDelivery.state==="sent"));}finally{reopened.db.close();}
  assert.ok(h.events.every(e=>e.id===h.room.id));assert.equal(h.tm.sessions.inMemoryTranscriptAgentId,h.b.id,"sending does not switch conversation");
 });
 test(`${group?"Group":"single Bot"}: Email edits and real discard persist without invented delivery`,async t=>{
  const h=await setup(t,{group});h.add("email",email);h.add("discard",email);
  const edited={type:"email-draft",draft:{...email.draft,to:["new@example.test"],cc:["cc@example.test"],subject:"Edited",body:"Edited body"}};
  const result=await h.service.action(await h.action("email",edited));assert.equal(result.state,"sent");assert.deepEqual(h.calls[0].args,edited.draft);
  const args=await h.action("discard",email,{action:"discard",message:undefined}),discarded=await h.service.action(args);
  assert.equal(discarded.state,"discarded");assert.equal(h.room.db.getEntryById("discard").draftDelivery.state,"discarded");assert.equal(h.calls.length,1);
  assert.deepEqual(await h.service.action(args),discarded);assert.equal(h.calls.length,1);
 });
 test(`${group?"Group":"single Bot"}: concurrent duplicate clicks share one durable attempt; changed nonce contents fail`,async t=>{
  const waiting=deferred(),h=await setup(t,{group,executor:()=>waiting.promise});h.add("first");h.add("second");h.add("third");
  const args=await h.action("first"),one=h.service.action(args),same=h.service.action(args);
  assert.equal(one,same);await assert.rejects(h.service.action({...args,requestId:"other"}),/already running/);
  while(!h.calls.length)await new Promise(r=>setImmediate(r));assert.equal(h.room.db.getEntryById("first").draftDelivery.state,"sending");
  await assert.rejects(h.service.action({...args,message:{...slack,draft:{...slack.draft,body:"changed"}}}),/already running/);
  for(const id of ["second","third"]){const send=h.service.action(await h.action(id));while(h.calls.length<(id==="second"?2:3))await new Promise(r=>setImmediate(r));waiting.resolve(success({channel_id:slack.draft.target,text:slack.draft.body}));assert.equal((await send).state,"sent");}
  assert.equal((await one).state,"sent");assert.equal(h.calls.length,3);assert.equal((await h.service.action(args)).state,"sent");assert.equal(h.calls.length,3);
  await assert.rejects(h.service.action({...args,message:{...slack,draft:{...slack.draft,body:"changed"}}}),/different draft/);
 });
}
test("unknown, error, thrown, wrong destination and wrong edited text never become sent or replay",async t=>{
 for(const value of [{result:{case:"success",value:{}}},{result:{case:"success",value:{isError:true,structuredContent:{sent:true,messageId:"bad"}}}},{result:{case:"error",value:{}}},success({channel_id:"C999999999",text:"Original"}),success({channel_id:slack.draft.target,text:"wrong text"}),"throw"]){
  const h=await setup(t,{executor:()=>{if(value==="throw")throw new Error("uncertain network");return value;}});h.add("draft");const args=await h.action("draft"),result=await h.service.action(args);assert.equal(result.state,"needs-review");assert.equal(result.receipt,undefined);
  assert.equal((await h.service.action(args)).state,"needs-review");await assert.rejects(h.service.action({...args,requestId:"retry",expectedVersion:result.version,expectedHash:result.hash}),/unconfirmed/);assert.equal(h.calls.length,1);
 }
});
test("unsupported schemas, guessed channel names, empty bodies and destination edits fail before executor",async t=>{
 for(const tool of [{...slackTool(),toolName:"send_message"},{...slackTool(),inputSchema:{...slackTool().inputSchema,required:["channel_id","text","hidden"]}},{...slackTool(),inputSchema:{...slackTool().inputSchema,properties:{...slackTool().inputSchema.properties,hidden:{type:"string"}}}}]){
  const h=await setup(t,{tools:[tool]});h.add("d");assert.equal((await h.service.snapshot(h.query("d"))).senders.length,0);await assert.rejects(h.service.action(await h.action("d")),/No connected sender/);assert.equal(h.calls.length,0);assert.equal(h.room.db.getEntryById("d").draftDelivery,undefined);
 }
 const h=await setup(t);h.add("d");const args=await h.action("d");for(const draft of [{...slack.draft,target:"#general"},{...slack.draft,workspace:"other"},{...slack.draft,thread:"1.2"},{...slack.draft,body:" "}])await assert.rejects(h.service.action({...args,message:{type:slack.type,draft}}));assert.equal(h.calls.length,0);
});
test("multiple senders require an explicit live connection selection and schema/account changes fail closed",async t=>{
 const tools=[slackTool("a"),slackTool("b")],h=await setup(t,{tools});h.add("d");const snapshot=await h.service.snapshot(h.query("d"));assert.deepEqual(snapshot.senders.map(({id,label})=>({id,label})),[{id:"a",label:"Workspace a"},{id:"b",label:"Workspace b"}]);assert.ok(snapshot.senders.every(s=>/^[a-f0-9]{64}$/.test(s.bindingHash)));
 const args=await h.action("d");await assert.rejects(h.service.action(args),/Choose a single/);assert.equal(h.calls.length,0);
 assert.equal((await h.service.action({...args,senderId:"b",expectedSenderHash:snapshot.senders[1].bindingHash})).state,"sent");assert.equal(h.calls[0].providerIdentifier,"b");
 const stale=await setup(t);stale.add("d");let count=0;stale.ports.listTools=async()=>[{...slackTool(),senderIdentity:{accountKey:++count===1?"old":"new"}}];const staleArgs=await stale.action("d");count=0;await assert.rejects(stale.service.action(staleArgs),/connected sender changed/);assert.equal(stale.calls.length,0);
});
test("stale entry/version, missing author, foreign ownership and removed Group author do not execute",async t=>{
 const h=await setup(t);h.add("d");const args=await h.action("d");h.room.db.updateTranscriptEntry("d",e=>({...e,message:{...slack,draft:{...slack.draft,body:"Changed"}}}));await assert.rejects(h.service.action(args),/draft has changed/);
 h.add("foreign",slack,{author:{id:h.b.id}});await assert.rejects(h.service.snapshot(h.query("foreign")),/ownership/);assert.equal(h.calls.length,0);
 const g=await setup(t,{group:true});g.add("d");const ga=await g.action("d");host.writeSandGroupConfig(path.dirname(g.room.dbPath),{version:1,memberIds:[g.b.id]});await assert.rejects(g.service.action(ga),/no longer a member/);g.add("anonymous",slack,{author:undefined});await assert.rejects(g.service.snapshot(g.query("anonymous")),/no longer a member/);assert.equal(g.calls.length,0);
});
test("durable sending and legacy sent recover to needs-review with no external replay",async t=>{
 const h=await setup(t);h.add("legacy",slack,{draftSendState:"sent"});h.add("crash",slack,{draftDelivery:{version:1,state:"sending",requestId:"already-attempted",signature:"recorded"}});
 assert.equal((await h.service.snapshot(h.query("legacy"))).state,"needs-review");assert.equal((await h.service.snapshot(h.query("crash"))).state,"needs-review");assert.equal(h.room.db.getEntryById("crash").draftDelivery.version,2);assert.equal(h.calls.length,0);
});
test("Slack thread adapter validates exact published schema and extracts only verified timestamps",async t=>{
 const h=await setup(t,{tools:[slackTool("slack",true)]}),message={...slack,draft:{...slack.draft,thread:"122.333"}};h.add("d",message);assert.equal((await h.service.action(await h.action("d",message))).state,"sent");assert.deepEqual(h.calls[0].args,{channel_id:slack.draft.target,thread_ts:"122.333",text:"Original"});
});
test("Host RPC configures the actual routed executor with the draft Bot owner and rejects hidden tool routing",async t=>{
 const h=await setup(t,{group:true});h.add("d");let execution;
 const mcp={mcp:{listTools:async()=>[slackTool()],createExecutor:(_a,_b,owner)=>({execute:async(_context,args)=>{execution={owner,args};return success(args.args);}})},management:{listInstalled:async()=>[{serverIdentifier:"slack",name:"Verified workspace",accountKey:"opaque-test-account",status:"connected"}]}};
 const api=host.createHostGatewayApi({extensions:{api:id=>id==="transcript"?h.tm:id==="mcp"?mcp:id==="telemetry"?{analytics:{markActive(){}}}:{}},hostEvents:{emit(){}},decorateForeverBoxStatus:v=>v,getHealth:()=>({isBusy:false}),kickstartIfPending:async()=>false,requestDiskSaverAudit:async()=>false,releaseAgentBox:async()=>{},handleDesktopMcpAuthCompletion:async()=>{},forgetLocalToolPermission(){}});
 const snapshot=await api.getDraftDelivery(h.query("d"));assert.equal(snapshot.senders[0].label,"Verified workspace · opaque-test-account");const result=await api.resolveDraftDelivery({...await h.action("d"),senderId:"slack"});assert.equal(result.state,"sent");assert.equal(execution.owner.agentId,h.a.id);assert.equal(execution.args.name,"slack_post_message");assert.equal(execution.args.toolName,"slack:send");
 await assert.rejects(api.resolveDraftDelivery({...await h.action("d"),toolName:"hidden-tool"}));
});
test("real SendMessage produces draft cards and Group publication retains the shape without sending externally",async()=>{
 for(const message of [email,slack]){
  const built=await host.buildSandSendMessage({}, {...message,reply_to:"goal",purpose:"update"},{});assert.deepEqual(built,{...message,reply_to:"goal",purpose:"update"});
  const publication=host.prepareGroupPublication(path.join(directory,"group.db"),built,false);assert.deepEqual(publication.message,built);assert.throws(()=>host.prepareGroupPublication(path.join(directory,"group.db"),message,true),/plain text only/);
  assert.equal(host.sendMessageParameters.safeParse({...message,draft:{...message.draft,sent:true}}).success,false);assert.equal(host.sendMessageParameters.safeParse({...message,channel:"slack:C123456789"}).success,false);
 }
});

test("reviewed account A cannot become account B between snapshot and send even when both live lookups agree on B",async t=>{
 const h=await setup(t);h.add("draft");let account="A",lookups=0;h.ports.listTools=async()=>{lookups++;return[{...slackTool(),senderIdentity:{accountKey:account}}];};const args=await h.action("draft");account="B";await assert.rejects(h.service.action(args),/changed since this draft was loaded/);assert.equal(lookups,2,"stale reviewed binding is rejected at the first live lookup");assert.equal(h.calls.length,0);assert.equal(h.room.db.getEntryById("draft").draftDelivery,undefined);
});
test("HostGateway carries installed-account identity into the sender fingerprint before any routed execution",async t=>{
 const h=await setup(t);h.add("d");let account="A",attempts=0;const mcp={mcp:{listTools:async()=>[slackTool()],createExecutor:()=>({execute:async()=>{attempts++;return {};}})},management:{listInstalled:async()=>[{serverIdentifier:"slack",name:"Connected workspace",accountKey:account,status:"connected"}]}};const api=host.createHostGatewayApi({extensions:{api:id=>id==="transcript"?h.tm:id==="mcp"?mcp:id==="telemetry"?{analytics:{markActive(){}}}:{}},hostEvents:{emit(){}},decorateForeverBoxStatus:v=>v,getHealth:()=>({isBusy:false}),kickstartIfPending:async()=>false,requestDiskSaverAudit:async()=>false,releaseAgentBox:async()=>{},handleDesktopMcpAuthCompletion:async()=>{},forgetLocalToolPermission(){}});const snapshot=await api.getDraftDelivery(h.query("d"));account="B";await assert.rejects(api.resolveDraftDelivery({agentId:h.room.id,entryId:"d",requestId:"account-change",expectedVersion:snapshot.version,expectedHash:snapshot.hash,expectedSenderHash:snapshot.senders[0].bindingHash,senderId:"slack",action:"send",message:slack}),/changed since/);assert.equal(attempts,0);assert.equal(h.room.db.getEntryById("d").draftDelivery,undefined);
});
test("a failed durable write prevents external execution and a failed receipt write remains recoverable without replay",async t=>{
 const h=await setup(t);h.add("preflight");const args=await h.action("preflight"),update=h.room.db.updateTranscriptEntry.bind(h.room.db);h.room.db.updateTranscriptEntry=()=>null;await assert.rejects(h.service.action(args),/could not be saved/);assert.equal(h.calls.length,0);h.room.db.updateTranscriptEntry=update;
 h.add("receipt");let count=0;h.room.db.updateTranscriptEntry=(...a)=>++count===2?null:update(...a);const second=await h.action("receipt");await assert.rejects(h.service.action(second),/could not be saved/);assert.equal(h.calls.length,1);assert.equal(h.room.db.getEntryById("receipt").draftDelivery.state,"sending");h.room.db.updateTranscriptEntry=update;const reopened=new host.DraftDelivery(h.tm);reopened.configure(h.ports);assert.equal((await reopened.snapshot(h.query("receipt"))).state,"needs-review");assert.equal(h.calls.length,1);
});

test("sending in the selected Bot updates the real in-memory transcript after durable persistence",async t=>{
 const h=await setup(t);h.add("selected");h.tm.sessions.inMemoryTranscriptAgentId=h.room.id;host.setTranscript(h.room.db.getTranscriptEntries());const result=await h.service.action(await h.action("selected"));assert.equal(result.state,"sent");assert.equal(host.getTranscript().find(e=>e.id==="selected").draftDelivery.state,"sent");assert.equal(h.calls.length,1);host.setTranscript([]);
});
