import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Window } from "happy-dom";

const snippet=await readFile(new URL("../scripts/lib/beebot-node-workbench.snippet.js",import.meta.url),"utf8");
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));

test("Settings Servers manages connections in its panel and preserves the active chat until a Bot is opened",async()=>{
  const window=new Window({url:"https://beebot.local"});
  let profiles=[],closedChats=0,closedSettings=0;const calls=[],opened=[];
  window.__sandUiLanguage="zh";
  window.__beebotNodeChat={close(){closedChats++;},open(...args){opened.push(args);}};
  window.desktop={nodes:{onChanged(){return()=>{};},async request(input){
    calls.push(structuredClone(input));
    if(input.action==="list")return structuredClone(profiles);
    if(input.action==="add"){profiles=[{id:"a",name:"Server A",baseUrl:input.address,status:"signed-out"}];return profiles[0];}
    if(input.action==="login"){profiles[0].status="online";return;}
    if(input.action==="snapshot")return{node:{id:"node-a"},bots:[{id:"bot",name:"助手"}],goals:[]};
    throw new Error(input.action);
  }}};
  const click=async label=>{const found=[...window.document.querySelectorAll("button")].find(b=>b.textContent===label);assert.ok(found,label);found.click();await tick();};
  try{
    const sidebar=window.document.createElement("aside");sidebar.className="sand-agents-sidebar";
    const panel=window.document.createElement("section");panel.id="sand-settings-panel-servers";
    window.document.body.append(sidebar,panel);
    window.eval(snippet);
    assert.equal(sidebar.children.length,0,"no standalone Servers launcher in the main sidebar");
    assert.equal(window.document.getElementById("beebot-node-workbench"),null,"nothing mounts outside Settings");
    window.__beebotMountServersSettings(panel,{onOpenBot(){closedSettings++;}});await tick();
    assert.equal(closedChats,0,"opening settings preserves the current conversation");
    assert.equal(panel.querySelector("#beebot-node-workbench")?.parentElement,panel);
    assert.equal([...panel.querySelectorAll("button")].some(b=>b.textContent==="返回"),false);
    window.document.querySelector('[aria-label="服务器地址"]').value="https://a.example";
    await click("添加服务器");assert.equal(calls.filter(c=>c.action==="snapshot").length,0);
    await click("登录");
    const root=window.document.getElementById("beebot-node-workbench");
    assert.match(root.textContent,/此服务器上的 Bot/);
    assert.equal(root.querySelector("textarea"),null,"management must not contain an alternate chat or create form");
    assert.equal(root.querySelector('[aria-label="部署服务器"]'),null);
    await click("助手");assert.deepEqual(opened,[["a",{id:"bot",name:"助手"}]]);
    assert.equal(closedSettings,1,"opening a Bot dismisses the owning Settings dialog");
    assert.equal(window.document.getElementById("beebot-node-workbench"),null);
    assert.equal(calls.filter(c=>["createBot","submitGoal"].includes(c.action)).length,0);
  }finally{await window.happyDOM.close();}
});

test("browser authorization does not fetch protected snapshots until sign-in completes",async()=>{
  const window=new Window({url:"https://beebot.local"});
  let status="signed-out",changed,finishLogin,snapshots=0;
  window.desktop={nodes:{onChanged(fn){changed=fn;return()=>{};},async request(input){
    if(input.action==="list")return[{id:"a",name:"Node",baseUrl:"https://a.example",status}];
    if(input.action==="login"){status="connecting";changed();await new Promise(resolve=>{finishLogin=resolve;});status="online";return;}
    if(input.action==="snapshot"){snapshots++;assert.equal(status,"online");return{node:{id:"a"},bots:[],goals:[]};}
    throw new Error(input.action);
  }}};
  try{
    const panel=window.document.createElement("section");window.document.body.append(panel);
    window.eval(snippet);window.__beebotMountServersSettings(panel);await tick();
    [...window.document.querySelectorAll("button")].find(b=>b.textContent==="Sign in").click();
    await new Promise(resolve=>setTimeout(resolve,300));assert.equal(snapshots,0);
    finishLogin();await tick();assert.ok(snapshots>0);window.__beebotCloseNodeWorkbench();
  }finally{await window.happyDOM.close();}
});

test("leaving Servers releases subscriptions and ignores an in-flight response without moving focus",async()=>{
  const window=new Window({url:"https://beebot.local"});
  let resolveList,unsubscribed=0;
  const previous=window.document.createElement("button"),panel=window.document.createElement("section");
  window.document.body.append(previous,panel);previous.focus();
  window.desktop={nodes:{onChanged(){return()=>{unsubscribed++;};},request(){return new Promise(resolve=>{resolveList=resolve;});}}};
  try{
    window.eval(snippet);const cleanup=window.__beebotMountServersSettings(panel);
    cleanup();cleanup();resolveList([]);await tick();
    assert.equal(unsubscribed,1);assert.equal(panel.children.length,0);
    assert.equal(window.document.activeElement,previous);
    assert.equal(window.__beebotCloseNodeWorkbench,undefined);
  }finally{await window.happyDOM.close();}
});
