/** macOS-only, isolated Electron window geometry regression.
 * Uses the exact staged native header/chrome functions, not drawn traffic lights.
 * No user's profile, model, server or credentials are accessed. */
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { downloadArtifact } from '@electron/get';
import { build } from 'esbuild';
import { applyOriginalRendererRouterPatch } from './lib/router-renderer-patch.mjs';

assert.equal(process.platform, 'darwin', 'Native window verification requires macOS; browser emulation is not native evidence.');
const root = process.cwd(), output = path.resolve(process.env.BEEBOT_WINDOW_REPORT_DIR || '.build/window-verification');
const temp = await mkdtemp(path.join(tmpdir(), 'beebot-window-verification-'));
try {
  await mkdir(output, { recursive: true });
  await mkdir(path.join(temp, 'user-data'));
  await cp(path.join(root, 'src/app/dist/renderer'), path.join(temp, 'dist/renderer'), { recursive: true });
  await applyOriginalRendererRouterPatch({ stageRoot: temp });
  const renderer = path.join(temp, 'dist/renderer');
  const source = await readFile(path.join(renderer, 'assets/index-UbX-y3il.js'), 'utf8');
  const start = source.indexOf('const Ete='), end = source.indexOf('function', source.indexOf('return y}', start) + 9);
  const chromeStart = source.indexOf('function xPe('), chromeEnd = source.indexOf('function Ipe(', chromeStart);
  assert.ok(start >= 0 && end > start && chromeStart >= 0 && chromeEnd > chromeStart);
  const header = source.slice(start, end), chrome = source.slice(chromeStart, chromeEnd);
  assert.ok(header.includes('bb-wordmark') && chrome.includes('installNativeWindowLayout'));
  const browser = `import React from ${JSON.stringify(path.join(root,'node_modules/react/index.js'))};
import {createRoot} from ${JSON.stringify(path.join(root,'node_modules/react-dom/client.js'))};
import * as jsx from ${JSON.stringify(path.join(root,'node_modules/react/jsx-runtime.js'))};
import * as Shared from ${JSON.stringify(path.join(root,'frontend/src/presence/packaged-ui.ts'))};
const mem={c:n=>Array(n).fill(Symbol.for('react.memo_cache_sentinel'))};
const classes=(...a)=>a.filter(Boolean).join(' '), pass=({children})=>children;
const leaf=({icon,children,focusAppearance,label,size,...props})=>jsx.jsx('button',{...props,style:{width:28,height:28,flexShrink:0},children:children||'+'});
const Header=((p,he,re,fr,yo,hcn)=>{${header};return pcn;})(jsx,mem,classes,leaf,pass,pass);
window.__layout={zoom:1,fullscreen:false};window.__newClicks=0;
const Controls=((S,t4e,Hse,bNe,RPresenceUI,p)=>{${chrome};return xPe;})(React,()=>({isFullscreen:window.__layout.fullscreen,isMaximized:false}),()=>({platform:'darwin'}),()=>({}),Shared,jsx);
const app=createRoot(document.getElementById('root'));
window.__renderLayout=(next)=>{Object.assign(window.__layout,next);document.documentElement.style.setProperty('--sand-zoom-factor',String(window.__layout.zoom));app.render(jsx.jsxs(React.Fragment,{children:[jsx.jsx(Controls,{}),jsx.jsxs('div',{className:'sand-shell',style:{height:'100%',display:'flex'},children:[jsx.jsx('aside',{className:'sand-agents-sidebar',style:{width:280,flexShrink:0},children:jsx.jsx(Header,{onNewChat:()=>window.__newClicks++})}),jsx.jsx('main',{style:{flex:1,minWidth:0},children:jsx.jsx('textarea',{id:'draft',defaultValue:'keep this draft',style:{marginTop:64,width:'90%'}})})]})]}));};window.__renderLayout({});`;
  const entry = path.join(temp, 'fixture.ts'); await writeFile(entry, browser);
  await build({ entryPoints: [entry], outfile: path.join(renderer, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
  await writeFile(path.join(renderer, 'window.html'), `<!doctype html><html data-beebot-theme="presence" data-theme="cursor-light"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'none'"><title>BeeBot caption verification</title><link rel="stylesheet" href="assets/index-lCyB53CO.css"><link rel="stylesheet" href="assets/beebot-presence.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
  await build({ entryPoints: [path.join(root, 'source/electron-main/window-chrome.ts')], outfile: path.join(temp, 'chrome.cjs'), bundle: true, platform: 'node', format: 'cjs' });
  // The stock installer uses extract-zip, whose promise exits unsettled on this
  // locked Node 26 toolchain. Keep Electron's checksum verification, then use the
  // platform ZIP utility for the verified artifact, isolated from node_modules.
  const metadata = JSON.parse(await readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8'));
  const checksums = JSON.parse(await readFile(path.join(root, 'node_modules/electron/checksums.json'), 'utf8'));
  const archive = await downloadArtifact({ version: metadata.version, artifactName: 'electron', checksums, platform: 'darwin', arch: process.arch });
  const runtime = path.join(temp, 'electron');
  execFileSync('/usr/bin/ditto', ['-x', '-k', archive, runtime], { timeout: 60_000 });
  assert.equal((await readFile(path.join(runtime, 'version'), 'utf8')).trim().replace(/^v/, ''), metadata.version);
  const electron = path.join(runtime, 'Electron.app/Contents/MacOS/Electron');
  const main = `const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {windowChromeOptions,MAC_TRAFFIC_LIGHT_POSITION,attachWindowStateBroadcast}=require('./chrome.cjs');
app.setPath('userData',${JSON.stringify(path.join(temp,'user-data'))});
const report={passed:false,scope:'real macOS BrowserWindow and native buttons; staged pcn/xPe, test leaf callbacks; not the installed complete application',checks:[],consoleErrors:[]};
const out=${JSON.stringify(output)};let window;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function record(name,value){assert.ok(value,name);report.checks.push(name);}
async function settle(){await window.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');}
async function fullscreen(value){const event=value?'enter-full-screen':'leave-full-screen';const transition=new Promise((resolve,reject)=>{let timer=setTimeout(()=>reject(new Error('native '+event+' timeout')),15000);window.once(event,()=>{clearTimeout(timer);resolve();});});window.setFullScreen(value);await transition;await settle();}
app.whenReady().then(async()=>{try{
 window=new BrowserWindow({width:850,height:650,show:true,...windowChromeOptions({isMac:true,isWindows:false,backgroundColor:'#eff1f4'}),webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 window.webContents.on('console-message',details=>{if(details.level==='error')report.consoleErrors.push(details.message);});
 await window.loadFile(${JSON.stringify(path.join(renderer,'window.html'))});window.focus();await settle();
 assert.deepEqual(window.getWindowButtonPosition(),MAC_TRAFFIC_LIGHT_POSITION);record('actual native button position matches shared metrics',true);
 attachWindowStateBroadcast(window,state=>{void window.webContents.executeJavaScript('window.__renderLayout('+JSON.stringify({fullscreen:state.isFullscreen})+')');});
 for(const zoom of [.75,1,1.25,1.5,2]){
  window.setContentSize(Math.round(850*zoom),Math.round(650*zoom));window.webContents.setZoomFactor(zoom);await window.webContents.executeJavaScript('window.__renderLayout({zoom:'+zoom+'})');await settle();
  const metrics=await window.webContents.executeJavaScript('(()=>{const r=document.querySelector(".bb-wordmark").getBoundingClientRect(),c=document.getElementById("beebot-window-caption").getBoundingClientRect(),b=document.querySelector(".sand-agents-sidebar__new").getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width,caption:c.height,newX:b.x+b.width/2,newY:b.y+b.height/2}})()');
  record('caption preserves 44 DIP at zoom '+zoom,Math.abs(metrics.caption*zoom-44)<1);
  record('wordmark below real native button area at zoom '+zoom,metrics.top*zoom>=44-.5&&metrics.width>20);
  const old=await window.webContents.executeJavaScript('window.__newClicks');
  window.webContents.sendInputEvent({type:'mouseDown',x:Math.round(metrics.newX*zoom),y:Math.round(metrics.newY*zoom),button:'left',clickCount:1});
  window.webContents.sendInputEvent({type:'mouseUp',x:Math.round(metrics.newX*zoom),y:Math.round(metrics.newY*zoom),button:'left',clickCount:1});await wait(50);
  record('New action receives input outside drag strip at zoom '+zoom,(await window.webContents.executeJavaScript('window.__newClicks'))===old+1);
 }
 window.webContents.setZoomFactor(1);window.setContentSize(512,520);await window.webContents.executeJavaScript('window.__renderLayout({zoom:1});document.querySelector("#draft").focus();document.querySelector("#draft").value="draft survives fullscreen"');await settle();
 record('minimum desktop window keeps header below native caption',(await window.webContents.executeJavaScript('document.querySelector(".bb-wordmark").getBoundingClientRect().top'))>=44);
 fs.writeFileSync(path.join(out,'native-content-windowed.png'),(await window.capturePage()).toPNG());
 await fullscreen(true);record('real enter-full-screen removes caption inset',(await window.webContents.executeJavaScript('parseFloat(getComputedStyle(document.body).paddingTop)'))===0);
 await fullscreen(false);record('real leave-full-screen restores caption inset',(await window.webContents.executeJavaScript('parseFloat(getComputedStyle(document.body).paddingTop)'))===44);
 record('fullscreen transitions preserve the composer value',(await window.webContents.executeJavaScript('document.querySelector("#draft").value'))==='draft survives fullscreen');
 record('no renderer console errors',report.consoleErrors.length===0);report.passed=true;
 }catch(error){report.error=error.stack;process.exitCode=1;}finally{fs.writeFileSync(path.join(out,'native-window-report.json'),JSON.stringify(report,null,2));window?.destroy();app.exit(report.passed?0:1);}});`;
  await writeFile(path.join(temp, 'native.cjs'), main);
  await new Promise((resolve,reject)=>{
    const child=spawn(electron,[path.join(temp,'native.cjs')],{stdio:'inherit',env:{...process.env}});
    const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Native layout verification exceeded 90 seconds'));},90_000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',(code,signal)=>{clearTimeout(timer);code===0?resolve():reject(new Error('Native layout verification failed: '+(signal??code)));});
  });
  console.log(await readFile(path.join(output,'native-window-report.json'),'utf8'));
} finally { await rm(temp,{recursive:true,force:true}); }
