import {build} from 'esbuild';
export async function buildAvatarExpressionHarness(){
 const result=await build({bundle:true,write:false,format:'iife',globalName:'AvatarQA',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import * as React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {createPresenceCharacter} from './frontend/src/presence/character';
import {createPresenceAvatarPreview} from './frontend/src/presence/avatar-preview';
import {CreateBotSheet} from './frontend/src/recovered/features/roster/create-bot-sheet';
import {AVATAR_EXPRESSIONS,EXPRESSION_LABELS,avatarExpressionFromAgent} from './frontend/src/presence/avatar-expression';
import {AVATAR_SHAPES,AVATAR_PALETTE} from './frontend/src/presence/avatar-art';
import {setAvatarMotionPreference} from './frontend/src/presence/avatar-motion';
const C=createPresenceCharacter(React),P=createPresenceAvatarPreview(React);
export {AVATAR_EXPRESSIONS,AVATAR_SHAPES,AVATAR_PALETTE,setAvatarMotionPreference};
export function mount(host){const root=createRoot(host);let selected={shape:'blob',color:'blue',state:'idle'},submissions=[],view='preview';
 const render=()=>flushSync(()=>root.render(view==='creation'?<CreateBotSheet language="zh" vendors={[{id:'test-api',label:'Configured API'}]} onCancel={()=>{}} onCreate={draft=>submissions.push(draft)}/>:<P shape={selected.shape} color={selected.color}/>));render();
 return {update(value){selected={...selected,...value};render()},creation(){view='creation';render()},submissions,unmount(){flushSync(()=>root.unmount())}};
}
export function lifecycle(host){const root=createRoot(host);let props={shape:'blob',color:'blue',state:'thinking',paused:false,sizePx:36,avatarIdentity:'node:bot',motionPriority:100};const render=()=>flushSync(()=>root.render(<C {...props}/>));render();return {update(next){props={...props,...next};render()},unmount(){flushSync(()=>root.unmount())}};}
export function gallery(host,size=36){const root=createRoot(host);flushSync(()=>root.render(<div className="gallery">{AVATAR_SHAPES.map((shape,i)=><div className="gallery-row" key={shape}><b>{shape}</b>{AVATAR_EXPRESSIONS.map(state=><div key={state}><C shape={shape} color={AVATAR_PALETTE[(i+5)%11].id} state={state} paused sizePx={size}/><small>{EXPRESSION_LABELS[state][1]}</small></div>)}</div>)}</div>));return()=>root.unmount();}
export function fleet(host){const root=createRoot(host);let online=true;const render=()=>flushSync(()=>root.render(<div className="fleet">{Array.from({length:40},(_,i)=><C key={i} shape={AVATAR_SHAPES[i%8]} color={AVATAR_PALETTE[i%11].id} state={online?'working':'offline'} sizePx={36} paused={false} avatarIdentity={'node:'+i} motionPriority={i===0?100:50}/>)}</div>));render();return {offline(){online=false;render()},unmount(){root.unmount()}};}
export function activity(host,facts){const root=createRoot(host);const render=f=>flushSync(()=>root.render(<C shape="cloud" color="green" state={avatarExpressionFromAgent(f)} paused={false} sizePx={48} avatarIdentity="node:bot" motionPriority={100}/>));render(facts);return {update:render,unmount(){root.unmount()}};}
`}});return result.outputFiles[0].text;
}
