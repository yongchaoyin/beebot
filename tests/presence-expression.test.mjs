import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { AVATAR_EXPRESSIONS, expressionPose, expressionFromState, expressionPaths, mixPose, settleProgress, identitySeed, blinkDelay, avatarExpressionFromAgent } from '../frontend/src/presence/avatar-expression.ts';
import { AVATAR_SHAPES, AVATAR_PALETTE, createCharacterSvg, characterLayers } from '../frontend/src/presence/avatar-art.ts';
import { normalizeAvatarState, selectMotionCandidates } from '../frontend/src/presence/avatar-state.ts';
import { registerAvatarMotion, setAvatarMotionPreference } from '../frontend/src/presence/avatar-motion.ts';
import { mountAvatarPicker } from '../frontend/src/presence/avatar-picker.ts';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const activities = {reading:'reading',browsing:'reading',searching:'searching',writing:'writing',coding:'writing','running-commands':'working',sending:'handoff',unknown:'thinking'};
for (const [verb,want] of Object.entries(activities)) test(`real active ${verb} has its own expression, historic activity does not`,()=>{
  assert.equal(avatarExpressionFromAgent({isRunning:true,currentActivity:{verb}}),want);
  assert.equal(avatarExpressionFromAgent({currentActivity:{verb}}),'idle');
  assert.equal(normalizeAvatarState(want),'thinking');
});
test('safety and real delivery facts outrank stale active tool hints',()=>{
  const active={isRunning:true,currentActivity:{verb:'searching'}};
  for (const [facts,want] of [[{isTransportDown:true},'offline'],[{workPhase:'uncertain'},'offline'],[{hasError:true},'error'],[{waiting:{kind:'user'}},'needs_user'],[{workPhase:'review'},'waiting'],[{workPhase:'queued'},'waiting'],[{isPaused:true},'paused'],[{workPhase:'succeeded'},'idle'],[{workPhase:'cancelled'},'idle'],[{isComposingMessage:true},'speaking']]) {
    assert.equal(avatarExpressionFromAgent({...active,...facts}),want);
  }
  assert.equal(expressionFromState('done'),'idle','prose-like success names cannot trigger celebration');
  assert.equal(avatarExpressionFromAgent({...active,currentActivity:'{"emotionId":"done"}'}),'thinking');
});
test('all expression geometry is finite, immutable and fixed-topology across 8 shapes and 11 colors',()=>{
  for(const shape of AVATAR_SHAPES)for(const {id} of AVATAR_PALETTE)for(const exp of AVATAR_EXPRESSIONS){
    const layers=characterLayers(shape,id,exp,28);
    assert.equal(layers.length,5);assert.equal(layers[0].attrs.d,characterLayers(shape,id)[0].attrs.d);
    for (const layer of layers.slice(2)){assert.doesNotMatch(layer.attrs.d,/NaN|Infinity|undefined/);assert.equal((layer.attrs.d.match(/C/g)||[]).length,4);}
    const mutable=expressionPose(exp);mutable.left.height=99;assert.notEqual(expressionPose(exp).left.height,99);
  }
  assert.equal(new Set(AVATAR_EXPRESSIONS.map(e=>JSON.stringify(expressionPaths(expressionPose(e),'blob')))).size,16);
  assert.deepEqual(expressionPose('__proto__'),expressionPose('idle'));assert.equal(expressionFromState('constructor'),'idle');
});
test('pose interpolation is continuous and elapsed-time based, including interrupt origins',()=>{
  const a=expressionPose('idle'),b=expressionPose('happy');
  assert.deepEqual(mixPose(a,b,0),a);assert.deepEqual(mixPose(a,b,1),b);
  let previous=0;for(let t=0;t<=360;t+=3){const p=settleProgress(t);assert.ok(p>=previous && p<=1);previous=p;}
  assert.equal(settleProgress(360),1);assert.equal(settleProgress(10000),1);assert.equal(settleProgress(-1),0);
  const at=(hz)=>mixPose(a,b,settleProgress((hz/4)*(1000/hz)));
  assert.deepEqual(at(60),at(120));assert.deepEqual(at(60),at(240));
  const interrupted=mixPose(a,b,settleProgress(140));assert.deepEqual(mixPose(interrupted,expressionPose('thinking'),0),interrupted);
});
test('identity cadence survives remount/order changes and mirrored coworkers share the animation budget',()=>{
  assert.equal(identitySeed('node-a:bot-a'),identitySeed('node-a:bot-a'));
  assert.notEqual(identitySeed('node-a:bot-a'),identitySeed('node-b:bot-a'));
  assert.notEqual(blinkDelay('bot-a',0),blinkDelay('bot-a',1));
  for(let i=0;i<100;i++)assert.ok(blinkDelay('a',i)>=4800 && blinkDelay('a',i)<9200);
  const c=(id,identity,priority)=>({id,identity,priority,state:'thinking',visible:true,paused:false,size:32});
  assert.deepEqual(selectMotionCandidates([c(1,'a',100),c(2,'a',80),c(3,'b',50)]),[1,3]);
});
function rig(t){
 const win=new Window({url:'https://beebot.test'});t.after(()=>win.happyDOM.close());const doc=win.document;doc.hasFocus=()=>true;
 Object.defineProperty(win.navigator,'hardwareConcurrency',{value:8});let now=10,next=0;
 win.performance.now=()=>now;const timers=new Map(),frames=new Map(),observers=[],animations=[];
 win.setTimeout=fn=>{const id=++next;timers.set(id,fn);return id;};win.clearTimeout=id=>timers.delete(id);
 win.requestAnimationFrame=fn=>{const id=++next;frames.set(id,fn);return id;};win.cancelAnimationFrame=id=>frames.delete(id);
 const media=new win.EventTarget();media.matches=false;win.matchMedia=()=>media;
 win.IntersectionObserver=class{constructor(cb){observers.push(cb);}observe(){}unobserve(){}disconnect(){}};
 win.SVGElement.prototype.animate=function(keys,options){const value={node:this,keys,options,cancelled:false,cancel(){this.cancelled=true;this.oncancel?.();}};animations.push(value);return value;};
 const actors=[];t.after(()=>actors.forEach(a=>a.handle.destroy()));
 const avatar=(opts={})=>{const svg=createCharacterSvg(doc,'blob','blue',36);doc.body.append(svg);const handle=registerAvatarMotion(svg,{state:'thinking',size:36,identity:'node:a',...opts});const a={svg,handle};actors.push(a);observers[0]([{target:svg,isIntersecting:true}]);return a;};
 const frame=(dt=17)=>{now+=dt;const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(now);};
 const settle=()=>{for(let i=0;i<200 && frames.size;i++)frame();assert.equal(frames.size,0,'rAF stops after settling');};
 return {win,doc,media,frames,timers,observers,animations,avatar,frame,settle};
}
test('interrupting an expression morph starts at current geometry; settles without a permanent frame loop',t=>{
 const r=rig(t),a=r.avatar();a.handle.update({state:'reading',identity:'node:a',size:36});r.frame(100);
 const eye=a.svg.querySelector('[data-part=eyes]'),before=eye.getAttribute('d');
 a.handle.update({state:'writing',identity:'node:a',size:36});r.frame(0);
 assert.equal(eye.getAttribute('d'),before);r.settle();assert.equal(a.svg.dataset.expression,'writing');
 assert.equal(eye.getAttribute('d'),expressionPaths(expressionPose('writing'),'blob',36).left);
});
test('pointer movement is smoothed, bounded and returns on leaving without touching focus/draft',t=>{
 const r=rig(t),a=r.avatar({followingPointer:true});
 a.svg.getBoundingClientRect=()=>({left:100,top:100,right:136,bottom:136,width:36,height:36});
 const input=r.doc.createElement('textarea');input.value='保留第三条草稿';r.doc.body.append(input);input.focus();input.setSelectionRange(2,4);
 r.doc.dispatchEvent(new r.win.PointerEvent('pointermove',{clientX:136,clientY:117,pointerType:'mouse'}));assert.equal(r.frames.size,1);
 r.frame();const first=a.svg.querySelector('.bb-character__gaze').getAttribute('transform');r.settle();assert.notEqual(a.svg.querySelector('.bb-character__gaze').getAttribute('transform'),first);
 r.doc.dispatchEvent(new r.win.PointerEvent('pointerout',{relatedTarget:null}));r.settle();
 assert.equal(a.svg.querySelector('.bb-character__gaze').getAttribute('transform'),expressionPaths(expressionPose('thinking'),'blob').gaze);
 assert.equal(r.doc.activeElement,input);assert.equal(input.value,'保留第三条草稿');assert.equal(input.selectionStart,2);
});
test('off, reduced motion, background and offscreen cancel transitions/celebration and retain static state',t=>{
 for (const mode of ['off','reduced','blur','hidden','offscreen']) {
  const r=rig(t),a=r.avatar({state:'idle',priority:100});a.handle.gesture('celebrate');assert.equal(r.frames.size,1);
  if(mode==='off')setAvatarMotionPreference(r.doc,'off');
  if(mode==='reduced'){r.media.matches=true;r.media.dispatchEvent(new r.win.Event('change'));}
  if(mode==='blur')r.win.dispatchEvent(new r.win.Event('blur'));
  if(mode==='hidden'){Object.defineProperty(r.doc,'hidden',{value:true});r.doc.dispatchEvent(new r.win.Event('visibilitychange'));}
  if(mode==='offscreen')r.observers[0]([{target:a.svg,isIntersecting:false}]);
  assert.equal(r.frames.size,0,mode);assert.equal(r.timers.size,0,mode);assert.ok(r.animations.every(x=>x.cancelled));
  a.handle.update({state:'error',identity:'node:a',size:36});assert.equal(a.svg.dataset.expression,'error');assert.equal(a.svg.querySelector('[data-part=mouth]').getAttribute('d'),expressionPaths(expressionPose('error'),'blob',36).mouth);
 }
});
test('terminal errors cancel pending gestures, no idle timeout can turn a working Bot into sleeping',t=>{
 const r=rig(t),a=r.avatar({state:'idle',priority:100});a.handle.gesture('celebrate');r.frame(200);
 a.handle.update({state:'error',identity:'node:a',size:36});r.settle();assert.equal(r.timers.size,0);assert.equal(a.svg.dataset.state,'error');
 a.handle.update({state:'working',identity:'node:a',size:36});r.frame(600000);r.settle();assert.equal(a.svg.dataset.state,'thinking');assert.equal(a.svg.dataset.expression,'working');
});
test('destroy cancels all work and detached handles cannot animate or register new timers',t=>{
 const r=rig(t),a=r.avatar();a.handle.update({state:'reading',identity:'node:a',size:36});assert.ok(r.frames.size);
 a.handle.destroy();const n=r.animations.length;a.handle.update({state:'speaking'});a.handle.gesture('nod');
 assert.equal(r.frames.size,0);assert.equal(r.timers.size,0);assert.equal(r.animations.length,n);
});
test('previewing every expression and gesture never saves shape/color or starts work; pending and disposal safe',t=>{
 const r=rig(t),host=r.doc.createElement('div');r.doc.body.append(host);const changes=[];
 const picker=mountAvatarPicker(host,{shape:'cloud',color:'violet',language:'zh',onChange:v=>changes.push(v)});
 t.after(()=>picker.destroy());const svg=host.querySelector('svg'),select=host.querySelector('select'),body=svg.querySelector('[data-part=body]');const original=body.outerHTML;
 for(const exp of AVATAR_EXPRESSIONS){select.value=exp;select.dispatchEvent(new r.win.Event('change'));assert.equal(svg.dataset.expression,exp);}
 for(const b of host.querySelectorAll('[data-gesture]'))b.click();assert.deepEqual(changes,[]);assert.equal(body.outerHTML,original);
 picker.setLanguage('en');assert.equal(select.getAttribute('aria-label'),'Preview expression only');
 picker.setDisabled(true);assert.ok(select.disabled);assert.ok([...host.querySelectorAll('[data-gesture]')].every(b=>b.disabled));
 picker.destroy();select.value='happy';select.dispatchEvent(new r.win.Event('change'));assert.equal(r.timers.size,0);assert.equal(r.frames.size,0);
});
test('React and DOM adapters use the same static face including gaze and preserve opaque legacy identity',async t=>{
 const {createRequire}=await import('node:module'),{mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const dir=await mkdtemp(path.join(tmpdir(),'bb-face-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const output=path.join(dir,'face.cjs');await build({stdin:{resolveDir:process.cwd(),contents:`import * as React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {createPresenceCharacter} from './frontend/src/presence/character';const C=createPresenceCharacter(React);export const render=(props)=>renderToStaticMarkup(React.createElement(C,props));`},outfile:output,bundle:true,platform:'node',format:'cjs'});
 const {render}=createRequire(import.meta.url)(output);const r=rig(t);
 for(const shape of AVATAR_SHAPES)for(const exp of AVATAR_EXPRESSIONS){
  const host=r.doc.createElement('div');host.innerHTML=render({shape,color:'blue',state:exp,paused:true,sizePx:28});
  const svg=host.querySelector('svg'),paths=expressionPaths(expressionPose(exp),shape,28);
  assert.equal(svg.querySelector('[data-part=eyes]').getAttribute('d'),paths.left);
  assert.equal(svg.querySelector('.bb-character__gaze').getAttribute('transform'),paths.gaze);
 }
});
test('both source and packaged editors consume the shared preview and all motion is owned by Presence',async()=>{
 const patch=await readFile('scripts/lib/presence-renderer-patch.mjs','utf8');
 assert.match(patch,/RPresenceUI\.createPresenceAvatarPreview\(S\)/);assert.match(patch,/p\.jsx\(RPresenceAvatarPreview\(\),\{color:u,shape:m\}\)/);
 assert.match(patch,/RPresenceUI\.avatarExpressionFromAgent\(n\?\?e\?\?\{\}\)/);
 assert.match(await readFile('frontend/src/recovered/features/agent-info/avatar-editor/view.tsx','utf8'),/<PresenceAvatarPreview color=/);
 for(const file of ['avatar-expression.ts','avatar-preview.ts','avatar-motion.ts'])assert.doesNotMatch(await readFile('frontend/src/presence/'+file,'utf8'),/window\.EmotionBall|EMOTION_SEED|EB_RINGS|setInterval\(|fetch\(/);
});

test('reset during celebration restores baseline immediately and cannot replay the pending smile',t=>{
 const r=rig(t),a=r.avatar({state:'idle',priority:100});a.handle.gesture('celebrate');r.frame(200);
 assert.notEqual(a.svg.querySelector('[data-part=mouth]').getAttribute('d'),expressionPaths(expressionPose('idle'),'blob',36).mouth);
 a.handle.reset();r.settle();assert.equal(a.svg.querySelector('[data-part=mouth]').getAttribute('d'),expressionPaths(expressionPose('idle'),'blob',36).mouth);
 r.frame(2000);assert.equal(a.svg.dataset.expression,'idle');assert.equal(r.frames.size,0);assert.ok(r.animations.every(a=>a.cancelled));
});

test('React paused/history transition retains the NEW static face, not the destroyed controller pose',async t=>{
 const {buildAvatarExpressionHarness}=await import('./helpers/avatar-expression-harness.mjs');const code=await buildAvatarExpressionHarness();
 const win=new Window({url:'https://beebot.test',settings:{enableJavaScriptEvaluation:true}});t.after(()=>win.happyDOM.close());win.console.timeStamp=()=>{};
 win.document.body.innerHTML='<main></main>';win.eval(code+';window.AvatarQA=AvatarQA;');
 const host=win.document.querySelector('main'),app=win.AvatarQA.lifecycle(host);t.after(()=>app.unmount());const svg=host.querySelector('svg');
 for(const [state,paused] of [['error',true],['reading',false],['offline',true],['happy',true],['writing',false],['needs_user',true]]){
  app.update({state,paused});assert.equal(host.querySelector('svg'),svg,'no remount');
  assert.equal(svg.querySelector('[data-part=mouth]').getAttribute('d'),expressionPaths(expressionPose(state),'blob',36).mouth,state);
 }
});
