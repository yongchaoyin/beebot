import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { readFile } from "node:fs/promises";
import { avatarStateFromAgent, normalizeAvatarState, selectMotionCandidates } from "../frontend/src/presence/avatar-state.ts";
import { characterLayers, createCharacterSvg, AVATAR_SHAPES, COLORS } from "../frontend/src/presence/avatar-art.ts";
import { registerAvatarMotion, getAvatarMotionPreference, setAvatarMotionPreference, gestureAvatarIdentity } from "../frontend/src/presence/avatar-motion.ts";

const cases = [
  [{},"idle"], [{awaitingUserResponse:false},"idle"], [{currentActivity:{verb:"reading"}},"idle"],
  [{isRunning:true},"thinking"], [{isComposingMessage:true,currentActivity:{verb:"reading"}},"speaking"],
  [{isRunning:true,waitingReason:"Agent B"},"waiting"], [{awaitingUserResponse:{id:"approve"}},"needs_user"],
  [{isRunning:true,awaitingUserResponse:true},"needs_user"], [{isPaused:true,isRunning:true},"paused"],
  [{hasError:true,isRunning:true},"error"], [{isTransportDown:true,hasError:true},"offline"],
  [{awaitingUserResponse:[],isRunning:true},"thinking"], [{awaitingUserResponse:"false"},"idle"],
];
for (const [input, expected] of cases) test(`avatar truth ${JSON.stringify(input)} -> ${expected}`,()=>assert.equal(avatarStateFromAgent(input),expected));
for (const [input, expected] of [["working","thinking"],["searching","thinking"],["sending","thinking"],["dictating","speaking"],["notifying","needs_user"],["sleeping","paused"],["orbit","waiting"],["made-up","idle"]]) {
  test(`legacy presentation ${input} maps without inventing progress`,()=>assert.equal(normalizeAvatarState(input),expected));
}
const candidate = (id, changes={})=>({id,state:"thinking",priority:50,visible:true,paused:false,size:32,...changes});
test("group animation budget chooses active speaker, never all participants",()=>{
  const roster=Array.from({length:50},(_,i)=>candidate(i)); roster[42].state="speaking";roster[42].priority=90;
  assert.deepEqual(selectMotionCandidates(roster),[42,0]);assert.deepEqual(selectMotionCandidates(roster,true),[42]);
  assert.deepEqual(selectMotionCandidates([candidate(1,{state:"idle",priority:100}),candidate(2,{state:"idle",priority:100})]),[1]);
  assert.deepEqual(selectMotionCandidates([candidate(1,{state:"idle",priority:100})],true),[]);
});
test("tiny, historical, hidden and waiting avatars cannot occupy activity slots",()=>{
  assert.deepEqual(selectMotionCandidates([candidate(1,{size:22}),candidate(2,{paused:true}),candidate(3,{visible:false}),...['paused','offline','error','waiting','needs_user'].map((state,i)=>candidate(i+4,{state}))]),[]);
});
test("six original silhouettes and neutral legacy colors are stable",()=>{
  assert.equal(AVATAR_SHAPES.length,6);assert.equal(new Set(AVATAR_SHAPES.map(shape=>characterLayers(shape)[0].attrs.d)).size,6);
  for(const color of Object.keys(COLORS))assert.doesNotMatch(COLORS[color],/#E6B84A|#FF9800|#FFAF38/i);
  for(const shape of AVATAR_SHAPES){const parts=characterLayers(shape).map(l=>l.part);assert.equal(parts.filter(p=>p==='eyes').length,2);assert.ok(parts.includes('mouth'));}
});

function rig(t){
  const window=new Window({url:"https://beebot.test"});t.after(()=>window.happyDOM.close());
  const {document}=window;document.hasFocus=()=>true;
  Object.defineProperty(window.navigator,'hardwareConcurrency',{value:8,configurable:true});
  const media=new window.EventTarget();media.matches=false;
  window.matchMedia=()=>media;
  const timers=new Map();let timerId=0;let now=1;window.performance.now=()=>now;
  window.setTimeout=fn=>{const id=++timerId;timers.set(id,fn);return id};window.clearTimeout=id=>timers.delete(id);
  const observers=[];
  window.IntersectionObserver=class {constructor(callback){this.callback=callback;this.targets=new Set;observers.push(this)}observe(node){this.targets.add(node)}unobserve(node){this.targets.delete(node)}disconnect(){this.disconnected=true;this.targets.clear()}};
  const calls=[];window.SVGElement.prototype.animate=function(frames,options){const call={node:this,frames,options,cancelled:false,cancel(){this.cancelled=true;this.oncancel?.()}};calls.push(call);return call};
  const handles=[];t.after(()=>handles.forEach(h=>h.destroy()));
  const avatar=(options={})=>{const svg=createCharacterSvg(document,"blob","blue",32);document.body.append(svg);const handle=registerAvatarMotion(svg,{size:32,...options});handles.push(handle);return{svg,handle}};
  const visible=(svg,value=true)=>observers[0].callback([{target:svg,isIntersecting:value}]);
  const tick=()=>{now+=10000;const fn=timers.values().next().value;assert.ok(fn,"clock scheduled");timers.delete(timers.keys().next().value);fn()};
  return {window,document,media,timers,observers,calls,avatar,visible,tick};
}
test("one observer and sparse clock serve a group; only visible workers animate",t=>{
  const r=rig(t);const actors=Array.from({length:20},()=>r.avatar({state:"thinking"}));
  assert.equal(r.observers.length,1);assert.equal(r.timers.size,0);
  actors.forEach(a=>r.visible(a.svg));assert.equal(r.timers.size,1);r.tick();
  assert.equal(new Set(r.calls.map(c=>c.node.closest('svg'))).size,2);
  actors.forEach(a=>r.visible(a.svg,false));assert.equal(r.timers.size,0);assert.ok(r.calls.every(c=>c.cancelled));
});
test("reduced motion, off, focus loss and visibility stop all active gestures",t=>{
  const r=rig(t);const a=r.avatar({state:"speaking"});r.visible(a.svg);r.tick();assert.ok(r.calls.length>0);
  r.media.matches=true;r.media.dispatchEvent(new r.window.Event('change'));assert.equal(r.timers.size,0);assert.ok(r.calls.every(c=>c.cancelled));
  r.media.matches=false;r.media.dispatchEvent(new r.window.Event('change'));assert.equal(r.timers.size,1);
  setAvatarMotionPreference(r.document,'off');assert.equal(r.timers.size,0);assert.equal(a.svg.dataset.state,'speaking');
  setAvatarMotionPreference(r.document,'auto');r.window.dispatchEvent(new r.window.Event('blur'));assert.equal(r.timers.size,0);
  r.window.dispatchEvent(new r.window.Event('focus'));assert.equal(r.timers.size,1);
  Object.defineProperty(r.document,'hidden',{value:true,configurable:true});r.document.dispatchEvent(new r.window.Event('visibilitychange'));assert.equal(r.timers.size,0);
});
test("motion setting persists and never rewrites task state; subtle disables idle",t=>{
  const r=rig(t);const a=r.avatar({state:"idle",priority:100});r.visible(a.svg);assert.equal(r.timers.size,1);
  setAvatarMotionPreference(r.document,'subtle');assert.equal(getAvatarMotionPreference(r.document),'subtle');assert.equal(r.window.localStorage.getItem('beebot.avatar-motion.v1'),'subtle');assert.equal(r.timers.size,0);
  a.handle.update({state:'needs_user',size:32});assert.equal(a.svg.dataset.state,'needs_user');assert.equal(r.timers.size,0);
});
test("low-power mode limits to one worker without suppressing state labels",t=>{
  const r=rig(t);Object.defineProperty(r.window.navigator,'hardwareConcurrency',{value:2});
  const a=r.avatar({state:'thinking'}),b=r.avatar({state:'speaking'});r.visible(a.svg);r.visible(b.svg);r.tick();
  assert.equal(new Set(r.calls.map(c=>c.node.closest('svg'))).size,1);assert.equal(a.svg.dataset.state,'thinking');assert.equal(b.svg.dataset.state,'speaking');
});
test("unmount cancels animations, clock and observer; mounting again starts clean",t=>{
  const r=rig(t);const a=r.avatar({state:'thinking'});r.visible(a.svg);r.tick();a.handle.destroy();
  assert.equal(r.timers.size,0);assert.ok(r.observers[0].disconnected);assert.ok(r.calls.every(c=>c.cancelled));
  const b=r.avatar({state:'thinking'});assert.equal(r.observers.length,2);r.observers[1].callback([{target:b.svg,isIntersecting:true}]);assert.equal(r.timers.size,1);
});
test("legacy stage gestures target a visible instance, not an offscreen SVG",t=>{
  const r=rig(t);const a=r.avatar({state:'thinking',identity:'bot-a'});r.visible(a.svg);
  gestureAvatarIdentity(r.document,'bot-a','greet');assert.equal(r.calls.length,1);assert.equal(r.calls[0].node.closest('svg'),a.svg);
  r.visible(a.svg,false);gestureAvatarIdentity(r.document,'bot-a','greet');assert.equal(r.calls.length,1);
});
test("presentation assets contain no retired branding and no uncontrolled animation loop",async()=>{
  const paths=['frontend/src/presence/presence.css','frontend/src/presence/tokens.css','frontend/src/presence/avatar-motion.css','branding/beebot-app-icon.svg'];
  const source=(await Promise.all(paths.map(p=>readFile(p,'utf8')))).join('\n');
  assert.doesNotMatch(source,/Honeyline|蜂蜜|蜜白|蜂巢|#E6B84A|#F4E7BA|animation:[^;]*infinite/i);
});
