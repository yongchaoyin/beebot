/** Isolated macOS creation-dialog regression. The exact packaged adapters and
 * shared artwork run in Electron; roster, model and create callbacks are fixtures.
 * This never opens a user profile, talks to a Node, or creates a real Bot/Group. */
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { downloadArtifact } from "@electron/get";
import { build } from "esbuild";
import { applyOriginalRendererRouterPatch } from "./lib/router-renderer-patch.mjs";
import { patchUiLanguageRenderer } from "./lib/ui-language-renderer-patch.mjs";

assert.equal(process.platform, "darwin", "Creation geometry verification requires macOS Electron.");
const root=process.cwd(), output=path.resolve(process.env.BEEBOT_CREATION_REPORT_DIR||".build/creation-verification");
const temp=await mkdtemp(path.join(tmpdir(), "beebot-creation-verification-"));
try {
  await mkdir(output,{recursive:true});await mkdir(path.join(temp,"user-data"));
  await cp(path.join(root,"src/app/dist/renderer"),path.join(temp,"dist/renderer"),{recursive:true});
  await applyOriginalRendererRouterPatch({stageRoot:temp});
  const renderer=path.join(temp,"dist/renderer"),source=await readFile(path.join(renderer,"assets/index-UbX-y3il.js"),"utf8");
  const start=source.indexOf("function RUiCopy(){"),end=source.indexOf("function RSyncVendorChoices(",start);
  assert.ok(start>=0&&end>start,"Exact packaged creation adapter exists");
  const creation=source.slice(start,end);
  assert.ok(creation.includes("RPresenceUI.mountAvatarPicker")&&creation.includes("bb-create-team-preview"),"Actual creation adapters include shared artwork and identity preview");
  const browser=`import * as Shared from ${JSON.stringify(path.join(root,"frontend/src/presence/packaged-ui.ts"))};
const RPresenceUI=Shared,R_PATHS={};
window.__sandUiLanguage="en";window.__sandVendorPaneBound=true;
const roster=[{id:"a",name:"Research",avatarShape:"blob",avatarColor:"green"},{id:"b",name:"设计同事",avatarShape:"hex",avatarColor:"blue"},{id:"c",name:"Writer with a longer colleague name",avatarShape:"cloud",avatarColor:"violet"},{id:"old-group",name:"Existing group",isGroup:true}];
window.__sandRoster={snapshots:{get:()=>({agents:{rows:roster}})}};
window.desktop={agent:{getUiLanguage:async()=>({language:window.__sandUiLanguage}),setUiLanguage:async language=>({language}),getInferenceVendors:async()=>({vendors:[{id:"fixture",label:"Fixture API"}],defaultVendorId:"fixture"})},nodes:{onChanged:()=>()=>{}}};
window.__beebotServerBots={listServers:async()=>[]};
for(const agent of roster){const row=document.createElement("button");row.dataset.agentId=agent.id;const name=document.createElement("span");name.className="sand-agent-item__name";name.textContent=agent.name;row.append(name);document.querySelector("aside").append(row);}
${patchUiLanguageRenderer("",{main:true}).source}
${await readFile(path.join(root,"scripts/lib/beebot-bot-role.snippet.js"),"utf8")}
${creation}
window.__attempts=0;
window.__openFixture=async(kind,language)=>{document.getElementById("sand-create-bot-sheet")?.__sandDismiss();document.getElementById("sand-create-group-sheet")?.__sandDismiss();await window.__beebotUiLanguage.set(language);
 const create=async()=>{window.__attempts++;throw new Error(language==="zh"?"测试创建失败，输入已保留":"Fixture creation failed; input retained");};
 if(kind==="bot")void window.__sandPickCreateBot({name:"产品同事",role:{primaryJob:"负责聊天界面体验",responsibilities:[],outOfScope:[],deliverables:[],workingStyle:""}},{onCreate:create});
 else void window.__sandPickCreateGroup({onCreate:create});};
window.__input=(node,value)=>{node.value=value;node.dispatchEvent(new Event("input",{bubbles:true}));};`;
  const entry=path.join(temp,"fixture.ts");await writeFile(entry,browser);
  await build({entryPoints:[entry],outfile:path.join(renderer,"fixture.js"),bundle:true,platform:"browser",format:"iife",define:{"process.env.NODE_ENV":'"production"'}});
  await writeFile(path.join(renderer,"creation.html"),`<!doctype html><html data-beebot-theme="presence" data-theme="cursor-light"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'none'"><link rel="stylesheet" href="assets/index-lCyB53CO.css"><link rel="stylesheet" href="assets/beebot-presence.css"><style>body{margin:0}aside{width:230px;display:grid;gap:8px;padding:18px}main{position:absolute;left:250px;top:70px}textarea{width:220px;height:80px}</style></head><body><aside class="sand-agents-sidebar"><button class="sand-agents-sidebar__new">+</button></aside><main>Existing conversation<textarea id="draft">keep this draft</textarea></main><script src="fixture.js"></script></body></html>`);
  const metadata=JSON.parse(await readFile(path.join(root,"node_modules/electron/package.json"),"utf8")),checksums=JSON.parse(await readFile(path.join(root,"node_modules/electron/checksums.json"),"utf8"));
  const archive=await downloadArtifact({version:metadata.version,artifactName:"electron",checksums,platform:"darwin",arch:process.arch});
  const runtime=path.join(temp,"electron");execFileSync("/usr/bin/ditto",["-x","-k",archive,runtime],{timeout:60_000});
  assert.equal((await readFile(path.join(runtime,"version"),"utf8")).trim().replace(/^v/,""),metadata.version);
  const main=`const {app,BrowserWindow}=require("electron"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
app.setPath("userData",${JSON.stringify(path.join(temp,"user-data"))});
const report={passed:false,scope:"macOS Electron; exact staged creation adapter and shared artwork; fixture roster/models/create errors; no real Bot/Node operations",checks:[],geometry:[],consoleErrors:[]};let window;
const out=${JSON.stringify(output)};
const check=(label,value)=>{assert.ok(value,label);report.checks.push(label);};
async function evaluate(code){return window.webContents.executeJavaScript(code);}
async function settle(){await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");}
app.whenReady().then(async()=>{try{
 window=new BrowserWindow({width:800,height:850,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 window.webContents.on("console-message",details=>{if(details.level==="error")report.consoleErrors.push(details.message);});
 await window.loadFile(${JSON.stringify(path.join(renderer,"creation.html"))});await settle();
 for(const [width,height] of [[800,850],[390,700]])for(const language of ["en","zh"])for(const theme of ["cursor-light","cursor-dark"])for(const kind of ["bot","group"]){
  window.setContentSize(width,height);await evaluate("document.documentElement.dataset.theme="+JSON.stringify(theme)+";window.__openFixture("+JSON.stringify(kind)+","+JSON.stringify(language)+")");await settle();
  if(kind==="group")await evaluate("window.__input(document.getElementById('bb-group-name'),'产品团队与交付同事');document.querySelector('[data-member-id=a]').click();document.querySelector('[data-member-id=b]').click();document.querySelector('[data-member-id=c]').click()");await settle();
  const label=[kind,width,language,theme].join("-");
  const state=await evaluate("(()=>{const root=document.getElementById('sand-create-"+kind+"-sheet'),r=root.getBoundingClientRect(),submit=root.querySelector('.bb-create-submit').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:root.clientWidth,scrollWidth:root.scrollWidth,height:root.clientHeight,scrollHeight:root.scrollHeight,submitTop:submit.top,submitBottom:submit.bottom,scrollTop:root.scrollTop,draft:document.getElementById('draft').value,modal:root.getAttribute('aria-modal'),background:getComputedStyle(root).backgroundColor}})()");
  report.geometry.push({label,...state});
  check(label+" fits the native content viewport",state.left>=10&&state.right<=width-10&&state.top>=10&&state.bottom<=height-10&&state.scrollWidth<=state.width+1);
  check(label+" preserves the conversation draft",state.draft==="keep this draft"&&state.modal==="true");
  check(label+" keeps create visible",state.submitTop>=state.top&&state.submitBottom<=state.bottom+1);
  await evaluate("document.getElementById('sand-create-"+kind+"-sheet').querySelector('.bb-create-submit').click()");await settle();
  check(label+" creation error retains the form",await evaluate("!!document.getElementById('sand-create-"+kind+"-sheet')&&document.getElementById('sand-create-"+kind+"-sheet').querySelector('[role=status]').textContent.includes("+JSON.stringify(language==="zh"?"输入已保留":"input retained")+")"));
  fs.writeFileSync(path.join(out,label+".png"),(await window.capturePage()).toPNG());
 }
 check("no renderer console errors",report.consoleErrors.length===0);report.passed=true;
 }catch(error){report.error=error.stack;process.exitCode=1;}finally{fs.writeFileSync(path.join(out,"native-creation-report.json"),JSON.stringify(report,null,2));window?.destroy();app.exit(report.passed?0:1);}});`;
  await writeFile(path.join(temp,"native.cjs"),main);
  await new Promise((resolve,reject)=>{const child=spawn(path.join(runtime,"Electron.app/Contents/MacOS/Electron"),[path.join(temp,"native.cjs")],{stdio:"inherit",env:{...process.env}});const timer=setTimeout(()=>{child.kill("SIGTERM");reject(new Error("Native creation verification exceeded 90 seconds"));},90_000);child.once("error",error=>{clearTimeout(timer);reject(error);});child.once("exit",(code,signal)=>{clearTimeout(timer);code===0?resolve():reject(new Error("Native creation verification failed: "+(signal??code)));});});
  console.log(await readFile(path.join(output,"native-creation-report.json"),"utf8"));
} finally {await rm(temp,{recursive:true,force:true});}
