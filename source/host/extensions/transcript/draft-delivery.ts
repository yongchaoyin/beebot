import { createHash } from "node:crypto";
import { draftActionSchema, draftMessageSchema, draftQuerySchema, type DraftAction, type DraftDeliveryView, type DraftMessage } from "../../../shared/draft-delivery.js";
import { assertValidSandAgentId } from "../../storage/agent-paths.js";
import { updateEntry } from "./transcript-store.js";
import type { TranscriptEntry, TranscriptManagerLike } from "./transcript-hub.js";

interface RoutedTool {name:string;toolName:string;providerIdentifier:string;inputSchema?:any;senderLabel?:string;senderIdentity?:unknown}
interface DraftPorts {listTools():Promise<RoutedTool[]>;executeTool(args:unknown):Promise<unknown>}
interface Delivery {version:number;state:DraftDeliveryView["state"];requestId?:string;signature?:string;receipt?:{messageId:string};error?:string}
const record=(v:unknown):v is Record<string,any>=>typeof v==="object"&&v!==null&&!Array.isArray(v);
const fingerprint=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)??"undefined").digest("hex");
const parseCurrent=(entry:TranscriptEntry)=>draftMessageSchema.parse({type:(entry.message as any)?.type,draft:(entry.message as any)?.draft});
const reviewError="Delivery is unconfirmed. Check the destination before doing anything else. This draft will not be sent again automatically.";

interface DraftBinding {tool:RoutedTool;args:Record<string,unknown>;kind:"declared"|"slack";destination?:string;text?:string}
function exactStringSchema(schema:any,fields:string[]):boolean {
  return schema?.type==="object"&&record(schema.properties)&&Array.isArray(schema.required)
    &&schema.required.length===fields.length&&fields.every(key=>schema.required.includes(key)&&schema.properties[key]?.type==="string")
    &&Object.keys(schema.properties).every(key=>fields.includes(key));
}
/** Only a verified provider adapter or a declared v1 contract may be called.
 * Roles, tool descriptions and MCP transport success never prove delivery. */
export function draftToolBindings(tools:readonly RoutedTool[],message:DraftMessage):DraftBinding[] {
  const kind=message.type==="email-draft"?"email":"slack";
  const allowed=kind==="email"?{from:"string",to:"array",cc:"array",subject:"string",body:"string"}:{workspace:"string",target:"string",thread:"string",body:"string"};
  const required=kind==="email"?["to","subject","body"]:["target","body"];
  const bindings:DraftBinding[]=[];
  for(const tool of tools){
    if(!tool.name||!tool.toolName||!tool.providerIdentifier)continue;
    const schema=tool.inputSchema,tag=schema?.["x-beebot-draft-delivery"];
    if(tag?.version===1&&tag.kind===kind&&schema?.type==="object"&&record(schema.properties)&&Array.isArray(schema.required)
      &&!schema.required.some((key:unknown)=>typeof key!=="string"||!Object.hasOwn(allowed,key))&&required.every(key=>schema.required.includes(key))
      &&Object.keys(schema.properties).every(key=>Object.hasOwn(allowed,key))
      &&Object.entries(allowed).every(([key,type])=>{const property=schema.properties[key];return property===undefined?!required.includes(key):property.type===type&&(type!=="array"||property.items?.type==="string");})
      &&schema.required.every((key:string)=>Object.hasOwn(message.draft,key))
      &&Object.keys(message.draft).every(key=>schema.properties[key]!==undefined)){
      bindings.push({tool,args:message.draft,kind:"declared"});continue;
    }
    // Reference MCP Slack server, exact published schema. Never resolve #names.
    if(message.type!=="slack-draft"||!/^([CGD])[A-Z0-9]{8,}$/.test(message.draft.target))continue;
    const {target,thread,body}=message.draft;
    if(thread!==undefined&&!/^\d+\.\d+$/.test(thread))continue;
    const fields=thread?["channel_id","thread_ts","text"]:["channel_id","text"];
    if(tool.toolName!==(thread?"slack_reply_to_thread":"slack_post_message")||!exactStringSchema(schema,fields))continue;
    bindings.push({tool,args:{channel_id:target,text:body,...(thread?{thread_ts:thread}:{})},kind:"slack",destination:target,text:body});
  }
  return bindings;
}
export function draftToolBinding(tools:readonly RoutedTool[],message:DraftMessage,senderId?:string,expectedSenderHash?:string):DraftBinding {
  const candidates=draftToolBindings(tools,message).filter(binding=>senderId===undefined||binding.tool.providerIdentifier===senderId);
  if(candidates.length!==1)throw new Error(candidates.length?"Choose a single configured sender for this draft. No message was sent.":"No connected sender supports this draft. Your draft is preserved; no message was sent.");
  const candidate=candidates[0]!;if(expectedSenderHash!==fingerprint(candidate.tool))throw new Error("The connected sender changed since this draft was loaded. Reopen the draft; no message was sent.");
  return candidate;
}
export function confirmedDraftReceipt(result:unknown,binding?:DraftBinding):{messageId:string}|null {
  if(!record(result)||result.result?.case!=="success"||result.result.value?.isError===true)return null;
  if(binding?.kind==="slack"){
    const content=result.result.value?.content;
    if(!Array.isArray(content))return null;
    for(const item of content){
      const text=item?.content?.case==="text"?item.content.value?.text:item?.type==="text"?item.text:undefined;
      if(typeof text!=="string")continue;
      try{const value=JSON.parse(text);if(value?.ok===true&&value.channel===binding.destination&&typeof value.ts==="string"&&/^\d+\.\d+$/.test(value.ts)&&(!record(value.message)||value.message.text===binding.text))return {messageId:value.ts};}catch{}
    }
    return null;
  }
  let payload=result.result.value?.structuredContent;
  if(typeof payload?.toJson==="function")payload=payload.toJson();
  if(!record(payload)||payload.sent!==true||typeof payload.messageId!=="string"||!payload.messageId.trim()||payload.messageId.length>512)return null;
  return {messageId:payload.messageId};
}

export class DraftDelivery {
  private ports:DraftPorts|null=null;
  private readonly inFlight=new Map<string,{signature:string,promise:Promise<DraftDeliveryView>}>();
  constructor(readonly tm:TranscriptManagerLike){}
  configure(ports:DraftPorts){this.ports=ports;}
  private async target(agentId:string,entryId:string){
    assertValidSandAgentId(agentId);
    if(this.tm.sessions.isAgentGone(agentId)||!this.tm.sessionStore.agentExists(agentId)||this.tm.groupChat.isRemoteRoomAgentId(agentId))throw new Error("Draft conversation is unavailable.");
    const session=await this.tm.sessions.resolveBackgroundSession(agentId);
    const entry=typeof session.db.getEntryById==="function"?session.db.getEntryById(entryId):session.db.getTranscriptEntries().find((e:TranscriptEntry)=>e.id===entryId);
    if(entry?.kind!=="send-message")throw new Error("Draft entry is unavailable.");
    const message=parseCurrent(entry);
    const author=record(entry.author)&&typeof entry.author.id==="string"?entry.author.id:agentId;
    if(this.tm.groupChat.isGroupAgentId(agentId)){
      const group=(await this.tm.sessionStore.listAgents()).find((a:any)=>a.id===agentId);
      if(author===agentId||!group?.memberIds?.includes(author))throw new Error("The draft author is no longer a member of this Group.");
    }else if(author!==agentId)throw new Error("Draft ownership could not be verified.");
    assertValidSandAgentId(author);
    if(!this.tm.sessionStore.agentExists(author)||this.tm.sessions.isAgentGone(author))throw new Error("Draft author is unavailable.");
    return {session,entry,message,author};
  }
  private view(agentId:string,entry:TranscriptEntry):DraftDeliveryView {
    const message=parseCurrent(entry),d=entry.draftDelivery as Delivery|undefined;
    return {agentId,entryId:entry.id,version:d?.version??0,hash:fingerprint(message),state:d?.state??(entry.draftSendState==="sending"?"needs-review":entry.draftSendState==="sent"?"needs-review":"editable"),message,...(d?.receipt?{receipt:d.receipt}:{}),...(d?.error?{error:d.error}:{})};
  }
  private persist(session:any,entry:TranscriptEntry,message:DraftMessage,delivery:Delivery):TranscriptEntry {
    const apply=(current:TranscriptEntry)=>{
      if(fingerprint(parseCurrent(current))!==fingerprint(parseCurrent(entry))||fingerprint(current.draftDelivery)!==fingerprint(entry.draftDelivery))throw new Error("Draft state changed during delivery. Check the destination before confirming anything else.");
      return {...current,message:{...(current.message as any),...message},draftSendState:delivery.state,draftDelivery:delivery};
    };
    const persisted=session.db.updateTranscriptEntry(entry.id,apply);
    if(!persisted)throw new Error("Draft state could not be saved. Do not retry an uncertain delivery.");
    if(this.tm.sessions.inMemoryTranscriptAgentId===session.id)updateEntry(entry.id,current=>({...current,message:{...(current.message as any),...message},draftSendState:delivery.state,draftDelivery:delivery}));
    try{this.tm.roster.emit({type:"updated",entry:persisted},session.id);}catch{}
    return persisted;
  }
  private async senders(message:DraftMessage){
    if(!this.ports)return [];
    const bindings=draftToolBindings(await this.ports.listTools(),message);
    return [...new Map(bindings.map(({tool})=>[tool.providerIdentifier,{id:tool.providerIdentifier,label:tool.senderLabel||tool.providerIdentifier,bindingHash:fingerprint(tool)}])).values()];
  }
  async snapshot(raw:unknown):Promise<DraftDeliveryView>{
    const {agentId,entryId}=draftQuerySchema.parse(raw),target=await this.target(agentId,entryId);
    const d=target.entry.draftDelivery as Delivery|undefined;
    if(d?.state==="sending"&&!this.inFlight.has(`${agentId}\0${entryId}`)){
      const entry=this.persist(target.session,target.entry,target.message,{...d,version:d.version+1,state:"needs-review",error:reviewError});return this.view(agentId,entry);
    }
    return {...this.view(agentId,target.entry),senders:await this.senders(target.message)};
  }
  action(raw:unknown):Promise<DraftDeliveryView>{
    let args:DraftAction;try{args=draftActionSchema.parse(raw);}catch(error){return Promise.reject(error);}
    const key=`${args.agentId}\0${args.entryId}`,signature=fingerprint(args),pending=this.inFlight.get(key);
    if(pending)return pending.signature===signature?pending.promise:Promise.reject(new Error("A draft action is already running. Wait for its result."));
    const promise=this.perform(args,signature);this.inFlight.set(key,{signature,promise});void promise.finally(()=>{if(this.inFlight.get(key)?.promise===promise)this.inFlight.delete(key);}).catch(()=>{});return promise;
  }
  private async perform(args:DraftAction,signature:string):Promise<DraftDeliveryView>{
    const target=await this.target(args.agentId,args.entryId),previous=target.entry.draftDelivery as Delivery|undefined;
    if(previous?.requestId===args.requestId){if(previous.signature!==signature)throw new Error("This request ID was already used for different draft contents.");return this.view(args.agentId,target.entry);}
    const view=this.view(args.agentId,target.entry);
    if(view.version!==args.expectedVersion||view.hash!==args.expectedHash)throw new Error("This draft has changed. Reload its current state before confirming again.");
    if(view.state!=="editable")throw new Error(view.state==="needs-review"||view.state==="sending"?reviewError:"This draft has already been resolved.");
    const message=args.action==="send"?draftMessageSchema.parse(args.message):target.message;
    if(message.type!==target.message.type)throw new Error("Draft type cannot change.");
    // Account/workspace and Slack destination are established by the Bot draft.
    // Cards edit email recipients/subject/body or Slack body, never hidden routing.
    if(message.type==="email-draft"&&target.message.type==="email-draft"&&message.draft.from!==target.message.draft.from)throw new Error("The sender account cannot change in this card.");
    if(message.type==="slack-draft"&&target.message.type==="slack-draft"&&["workspace","target","thread"].some(key=>(message.draft as any)[key]!== (target.message.draft as any)[key]))throw new Error("The Slack destination cannot change in this card.");
    const next={version:view.version+1,requestId:args.requestId,signature};
    if(args.action==="discard")return this.view(args.agentId,this.persist(target.session,target.entry,message,{...next,state:"discarded"}));
    if(!this.ports)throw new Error("Draft sender is unavailable. Your draft is preserved; no message was sent.");
    const ports=this.ports,binding=draftToolBinding(await ports.listTools(),message,args.senderId,args.expectedSenderHash),tool=binding.tool,toolFingerprint=fingerprint(tool);
    const tools=await ports.listTools();if(!tools.some(candidate=>fingerprint(candidate)===toolFingerprint))throw new Error("The connected sender changed. Reopen this draft; no message was sent.");
    const fresh=await this.target(args.agentId,args.entryId);if(this.view(args.agentId,fresh.entry).hash!==view.hash||this.view(args.agentId,fresh.entry).version!==view.version)throw new Error("This draft changed before sending. Confirm its current contents again.");
    const sending=this.persist(fresh.session,fresh.entry,message,{...next,state:"sending"});
    let receipt:{messageId:string}|null=null;
    try{receipt=confirmedDraftReceipt(await ports.executeTool({agentId:fresh.author,name:tool.name,toolName:tool.toolName,providerIdentifier:tool.providerIdentifier,args:binding.args,toolCallId:args.requestId}),binding);}catch{}
    const result=this.persist(fresh.session,sending,message,receipt?{...next,version:next.version+1,state:"sent",receipt}:{...next,version:next.version+1,state:"needs-review",error:reviewError});
    return this.view(args.agentId,result);
  }
}
