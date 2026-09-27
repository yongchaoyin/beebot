/** Isolated native message geometry. Real pinned row/quote functions and React;
 * controlled roster, leaf text/photo elements, no account/model/user data. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {parse} from 'acorn';
import {downloadArtifact} from '@electron/get';
import {build} from 'esbuild';
import {applyOriginalRendererRouterPatch} from './lib/router-renderer-patch.mjs';
import {patchUiLanguageRenderer} from './lib/ui-language-renderer-patch.mjs';

assert.equal(process.platform,'darwin','This verification requires a real macOS Electron window.');
const root=process.cwd(),output=path.join(root,'.build/avatar-top-verification');
const temp=await mkdtemp(path.join(tmpdir(),'beebot-avatar-top-'));
try {
  await mkdir(output,{recursive:true});
  await cp(path.join(root,'src/app/dist/renderer'),path.join(temp,'dist/renderer'),{recursive:true});
  await applyOriginalRendererRouterPatch({stageRoot:temp});
  const renderer=path.join(temp,'dist/renderer'),source=await readFile(path.join(renderer,'assets/index-UbX-y3il.js'),'utf8');
  const wanted=new Set(['gMn','yMn','kMn','Roe','pCn','Iee']),functions=[];
  let runStart=false;
  for(const node of parse(source,{ecmaVersion:'latest',sourceType:'module'}).body){
    if(node.type==='FunctionDeclaration'&&wanted.has(node.id.name)){functions.push(source.slice(node.start,node.end));wanted.delete(node.id.name);}
    if(node.type==='FunctionDeclaration'&&node.id.name==='oPe')runStart=source.slice(node.start,node.end).includes('showsAuthorAvatar:_.isRunStart');
  }
  assert.equal(wanted.size,0,'all actual message functions must be present');
  assert.ok(runStart,'actual transcript entry places an avatar at the author-run start');
  const language=patchUiLanguageRenderer('',{main:true}).source;
  const browser=`import React from ${JSON.stringify(path.join(root,'node_modules/react/index.js'))};
import {createRoot} from ${JSON.stringify(path.join(root,'node_modules/react-dom/client.js'))};
import {flushSync} from ${JSON.stringify(path.join(root,'node_modules/react-dom/index.js'))};
import * as p from ${JSON.stringify(path.join(root,'node_modules/react/jsx-runtime.js'))};
import * as he from ${JSON.stringify(path.join(root,'node_modules/react/compiler-runtime.js'))};
import * as Shared from ${JSON.stringify(path.join(root,'frontend/src/presence/packaged-ui.ts'))};
import * as RQuotedReplyUI from ${JSON.stringify(path.join(root,'frontend/src/recovered/features/conversation/workspace/quoted-reply-ui.ts'))};
const S=React;window.desktop={agent:{getUiLanguage:async()=>({language:'en'}),setUiLanguage:async language=>({language})}};
${language}
const re=(...values)=>values.filter(Boolean).join(' '),Character=Shared.createPresenceCharacter(React),Quote=RQuotedReplyUI.createQuotedReplyUI(React);
const JGe='sm',Jj={xs:16,sm:22,md:28,lg:36,xl:72};
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
let actor={id:'fixture-bot',name:'小微 · Fixture colleague',avatarShape:'cloud',avatarColor:'green'};
const context={agentId:'fixture-room',isReadOnly:false,threadRootId:null,getThreadSummary:()=>null,selectAgent:id=>window.__selected.push(id),openThread:()=>{},resolveEntry:id=>({id,kind:'message',role:'user',content:'请检查输入框的焦点顺序，保留当前引用关系。 This is controlled fixture text.'}),revealQuotedEntry:id=>{window.__quotes.push(id);return true;}};
const r1=()=>context,Ra=()=>[actor],aln=()=>null,kAe=()=>null,RQuoteComponents=()=>Quote;
const mCn=({children})=>children,FEn=()=>null,UEn=()=>null,JEn=()=>null,pGe=()=>'assistant',$ht=()=>false;
const vt=({as='span',children,className})=>React.createElement(as,{className},children);
const au=({sizePx,src,style,...rest})=>p.jsx('img',{...rest,src,alt:'',style:{...style,width:sizePx,height:sizePx,objectFit:'cover',borderRadius:'50%',display:'block'}});
const sle=()=> 'green',u4e=()=> 'cloud',kct=id=>id;
const sd=({className,sizePx,color,shape,state,paused})=>p.jsx('span',{className,style:{display:'inline-flex',width:sizePx,height:sizePx},children:p.jsx(Character,{sizePx,color,shape,state,paused})});
const ml=({agent,size,isStatic})=>p.jsx(Iee,{avatarKey:agent.id,dataUrl:agent.avatarDataUrl,color:agent.avatarColor,shape:agent.avatarShape,size,isStatic});
const hme=({id,size,isStatic,avatarUrl})=>p.jsx(Iee,{avatarKey:id,dataUrl:avatarUrl,color:actor.avatarColor,shape:actor.avatarShape,size,isStatic});
${functions.join('\n')}
window.__selected=[];window.__quotes=[];
const app=createRoot(document.getElementById('root'));
window.__renderMessage=next=>{
  document.documentElement.dataset.theme='cursor-'+next.theme;
  actor={...actor,avatarDataUrl:next.photo?photo:null};
  const entry={id:'fixture-answer',kind:'send-message',author:{id:actor.id,name:actor.name},message:{type:'text',content:'fixture'},...(next.long?{replyTo:'fixture-user-question'}:{})};
  const text=next.long?'这是一个较长的回复，用来检查头像是否始终对齐消息开头。 The avatar should stay at the beginning of this answer, including its author name. '.repeat(6):'简短回复。 Short answer.';
  flushSync(()=>app.render(p.jsxs(React.Fragment,{children:[p.jsx('h1',{children:(next.group?'Group':'Single Bot')+' · '+(next.photo?'photo':'character')+' · '+next.theme}),p.jsx('section',{id:'case',className:'sand-transcript-row','data-role':'assistant',children:p.jsx(gMn,{author:entry.author,agent:actor,showsAuthorName:next.group,showsAuthorAvatar:true,children:p.jsx(Roe,{entry,children:p.jsx('div',{className:'sand-message','data-role':'assistant',children:p.jsx('div',{className:'sand-message-content',children:text})})})})}),p.jsx('textarea',{id:'draft','aria-label':'Fixture draft',defaultValue:'keep this draft'})]})));
};
window.__measureMessage=()=>{
 const run=document.querySelector('.sand-author-run'),gutter=run.querySelector('.sand-author-run__gutter'),column=run.querySelector('.sand-author-run__column'),avatar=gutter.querySelector('img,svg'),bubble=run.querySelector('.sand-message'),quote=run.querySelector('.bb-quoted-reply');
 const rect=e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};
 return{gutter:rect(gutter),column:rect(column),avatar:rect(avatar),bubble:rect(bubble),quote:quote?rect(quote):null,name:!!run.querySelector('.sand-group-author'),photo:avatar.tagName==='IMG',scrollWidth:document.documentElement.scrollWidth,width:innerWidth,viewportHeight:innerHeight,draft:document.getElementById('draft').value};
};
window.__renderMessage({theme:'light',group:true,photo:false,long:true});`;
  await writeFile(path.join(temp,'fixture.ts'),browser);
  await build({entryPoints:[path.join(temp,'fixture.ts')],outfile:path.join(renderer,'fixture.js'),bundle:true,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  await writeFile(path.join(renderer,'avatar.html'),`<!doctype html><html data-beebot-theme="presence" data-theme="cursor-light"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'none'"><link rel="stylesheet" href="assets/index-lCyB53CO.css"><link rel="stylesheet" href="assets/beebot-presence.css"><style>html,body{margin:0;height:auto;overflow:auto}#root{padding:20px;box-sizing:border-box;min-width:0}h1{font:14px/22px system-ui;margin:0 0 20px}.sand-message{background:var(--bb-surface)}#draft{box-sizing:border-box;margin-top:20px;width:100%;height:48px;font:14px system-ui;background:var(--bb-surface);color:var(--bb-text);border:1px solid var(--bb-border);border-radius:8px}</style><title>Isolated avatar alignment verification</title></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
  const metadata=JSON.parse(await readFile(path.join(root,'node_modules/electron/package.json'),'utf8'));
  const checksums=JSON.parse(await readFile(path.join(root,'node_modules/electron/checksums.json'),'utf8'));
  const archive=await downloadArtifact({version:metadata.version,artifactName:'electron',checksums,platform:'darwin',arch:process.arch});
  const expected=checksums['electron-v'+metadata.version+'-darwin-'+process.arch+'.zip'];
  assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'),expected,'cached archive must match pinned Electron checksums');
  const runtime=path.join(temp,'electron');execFileSync('/usr/bin/ditto',['-x','-k',archive,runtime],{timeout:60_000});
  assert.equal((await readFile(path.join(runtime,'version'),'utf8')).trim().replace(/^v/,''),metadata.version);
  const main=`const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
app.setPath('userData',${JSON.stringify(path.join(temp,'user-data'))});
const out=${JSON.stringify(output)},report={passed:false,scope:'real macOS Electron geometry; actual staged gMn/yMn/kMn/Roe/pCn/Iee with real React/compiler/quote/character modules and original+built CSS; controlled roster and text/photo leafs, not installed app or model execution',checks:[],cases:[],consoleErrors:[]};let win;
const record=(name,value)=>{assert.ok(value,name);report.checks.push(name)};
const evaluate=code=>win.webContents.executeJavaScript(code),settle=()=>evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const click=async selector=>{const point=await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()');win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});await settle()};
app.whenReady().then(async()=>{try{
 win=new BrowserWindow({width:900,height:780,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 win.webContents.on('console-message',details=>{if(details.level==='error')report.consoleErrors.push(details.message)});
 await win.loadFile(${JSON.stringify(path.join(renderer,'avatar.html'))});win.focus();await settle();
 await evaluate('window.__draftNode=document.getElementById("draft");window.__draftNode.focus()');
 win.webContents.sendInputEvent({type:'char',keyCode:'!'});await settle();
 const draft=await evaluate('document.getElementById("draft").value');record('native keyboard reaches the draft',draft.includes('!'));
 for(const width of [900,390])for(const theme of ['light','dark'])for(const group of [true,false])for(const photo of [false,true])for(const long of [false,true]){
  win.setContentSize(width,780);await evaluate('window.scrollTo(0,0);window.__renderMessage('+JSON.stringify({theme,group,photo,long})+')');await settle();
  const m=await evaluate('window.__measureMessage()'),label=[width,theme,group?'group':'single',photo?'photo':'character',long?'long-quoted':'short'].join('-');report.cases.push({label,...m});
  record(label+' avatar top aligns with author/message column',Math.abs(m.avatar.top-m.column.top)<=1&&Math.abs(m.gutter.top-m.column.top)<=1);
  record(label+' original avatar/name branch is present',m.avatar.width>0&&m.avatar.height>0&&m.photo===photo&&m.name===group);
  record(label+' no horizontal overflow',m.scrollWidth<=m.width+1&&m.column.right<=m.width+1&&m.bubble.right<=m.width+1);
  record(label+' quote remains below bubble',long?m.quote!==null&&m.quote.top>=m.bubble.bottom-1:m.quote===null);
  record(label+' draft identity and content survive render/resize/theme',m.draft===draft&&await evaluate('window.__draftNode===document.getElementById("draft")'));
  if(long&&photo===!group)fs.writeFileSync(path.join(out,label+'.png'),(await win.capturePage()).toPNG());
 }
 await evaluate('window.__renderMessage({theme:"light",group:true,photo:false,long:true})');await settle();
 const before=(await evaluate('window.__measureMessage()')).avatar.top;
 await evaluate('document.querySelector(".sand-author-run__gutter").style.setProperty("align-self","flex-end","important")');await settle();
 const broken=await evaluate('window.__measureMessage()');record('negative control detects the former bottom alignment',Math.abs(broken.avatar.top-broken.column.top)>20&&broken.avatar.top>before);
 await evaluate('document.querySelector(".sand-author-run__gutter").style.removeProperty("align-self")');await settle();
 await click('.sand-group-author');record('native author click keeps its original callback',(await evaluate('window.__selected.join(",")'))==='fixture-bot');
 await click('.bb-quoted-reply');record('native quote click retains quote navigation',(await evaluate('window.__quotes.join(",")'))==='fixture-user-question');
 await evaluate('document.getElementById("draft").focus()');await settle();record('draft focus and content survive actions',await evaluate('document.activeElement===window.__draftNode&&window.__draftNode.value==='+JSON.stringify(draft)));
 record('no renderer errors',report.consoleErrors.length===0);report.passed=true;
 }catch(error){report.error=error.stack;}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));win?.destroy();app.exit(report.passed?0:1)}});`;
  await writeFile(path.join(temp,'native.cjs'),main);
  await new Promise((resolve,reject)=>{
    const child=spawn(path.join(runtime,'Electron.app/Contents/MacOS/Electron'),[path.join(temp,'native.cjs')],{stdio:'inherit',env:{...process.env}});
    const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Native avatar geometry exceeded 90 seconds'));},90_000);
    child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('exit',(code,signal)=>{clearTimeout(timer);code===0?resolve():reject(new Error('Native avatar geometry failed: '+(signal??code)))});
  });
  const report=JSON.parse(await readFile(path.join(output,'report.json'),'utf8'));
  console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,checks:report.checks.length,consoleErrors:report.consoleErrors,output},null,2));
} finally {await rm(temp,{recursive:true,force:true})}
