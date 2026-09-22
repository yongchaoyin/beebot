import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Window } from "happy-dom";
const result = await build({bundle:true,write:false,format:"iife",globalName:"HeaderRig",platform:"browser",jsx:"automatic",loader:{".css":"empty"},logOverride:{"empty-import-meta":"silent"},define:{"process.env.NODE_ENV":'"development"'},stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
import * as React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {ConversationAgentHeader} from './frontend/src/recovered/features/conversation/workspace/chat-header';
import {PresenceMotionSetting} from './frontend/src/presence/components';
export function mount(host){const root=createRoot(host);let flags={};const render=()=>flushSync(()=>root.render(<><ConversationAgentHeader agent={{id:'research',name:'Research',avatarColor:'blue',avatarShape:'blob',...flags}} isTransportDown={flags.isTransportDown} isComputerActive={false} isInfoOpen={false} showComputerControl={false} onToggleInfo={()=>{}}/><input aria-label="Draft" defaultValue="keep this draft"/><PresenceMotionSetting/></>));render();return{update:next=>{flags=next;render()},unmount:()=>flushSync(()=>root.unmount())}}
`}});
function rig(t){
 const window=new Window({url:'https://beebot.test',settings:{enableJavaScriptEvaluation:true}});window.console.timeStamp=()=>{};
 const errors=[];window.addEventListener('error',event=>errors.push(event.message));window.document.body.innerHTML='<main></main>';
 window.eval(result.outputFiles[0].text+';window.HeaderRig=HeaderRig');const host=window.document.querySelector('main'),app=window.HeaderRig.mount(host);
 t.after(async()=>{app.unmount();await window.happyDOM.close()});return{window,host,app,errors};
}
test('actual header shares all eight avatar/text states without remounting the draft or avatar',t=>{
 const {window,host,app,errors}=rig(t),svg=host.querySelector('.bb-character'),input=host.querySelector('input');input.focus();
 const cases=[[{},'idle',null],[{isRunning:true},'thinking','Working'],[{isComposingMessage:true},'speaking','Writing a reply'],[{awaitingUserResponse:{id:'approval'}},'needs_user','Needs your input'],[{waitingReason:'another agent'},'waiting','Waiting'],[{isPaused:true},'paused','Paused'],[{hasError:true},'error','Action failed'],[{isTransportDown:true,isRunning:true},'offline','Disconnected']];
 for(const [flags,state,label] of cases){app.update(flags);assert.equal(host.querySelector('.bb-character'),svg);assert.equal(svg.dataset.state,state);assert.equal(host.querySelector('.bb-status')?.textContent??null,label);assert.equal(host.querySelector('input'),input);assert.equal(window.document.activeElement,input);assert.equal(input.value,'keep this draft')}
 assert.deepEqual(errors,[]);
});
test('motion preference has a concise accessible name with separate system-setting description',t=>{
 const {host}=rig(t),select=host.querySelector('select'),label=host.querySelector('label[for]');
 assert.equal(label.htmlFor,select.id);assert.equal(label.textContent,'Avatar motion');
 assert.equal(host.ownerDocument.getElementById(select.getAttribute('aria-describedby')).textContent,'Always respects Reduce Motion');
 assert.deepEqual([...select.options].map(option=>option.value),['auto','subtle','off']);
});
