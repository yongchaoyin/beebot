import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
const root=path.resolve(import.meta.dirname,'../..');
export async function buildConversationUiFixture(directory){
  await mkdir(directory,{recursive:true});
  const activity=await readFile(path.join(root,'scripts/lib/beebot-conversation-ui.snippet.js'),'utf8');
  const creation=(await readFile(path.join(root,'scripts/lib/sand-create-overlay.snippet.js'),'utf8')).split('function MOn(')[0];
  const personas=await readFile(path.join(root,'scripts/lib/persona-shape-paths.json'),'utf8');
  const group=await readFile(path.join(root,'scripts/lib/sand-group-ui.snippet.js'),'utf8');
  const result=await build({absWorkingDir:root,bundle:true,write:false,format:'iife',platform:'browser',target:'chrome136',define:{'process.env.NODE_ENV':'"production"'},stdin:{contents:`import * as S from 'react'; import {createRoot} from 'react-dom/client';
${activity}
window.__fixtureMountActivity=(props)=>{window.__fixtureActivityRoot?.unmount();const root=createRoot(document.querySelector('#activity'));window.__fixtureActivityRoot=root;root.render(S.createElement(RConversationActivity,props));};
`,resolveDir:root,loader:'js'}});
  await writeFile(path.join(directory,'activity.js'),result.outputFiles[0].text);
  await writeFile(path.join(directory,'creation.js'),`const R_PATHS=${personas};\n${creation}\n${group}`);
  await writeFile(path.join(directory,'index.html'),`<!DOCTYPE html><html lang="zh"><meta charset="utf-8"><title>BeeBot actual component verification</title><style>
:root{color-scheme:light;--cursor-bg-primary:#fff;--cursor-bg-secondary:#f4f4f4;--cursor-bg-input:#fff;--cursor-text-primary:#202124;--cursor-text-secondary:#666;--cursor-stroke-secondary:#ddd;--cursor-accent:#366dcb}html[data-dark]{color-scheme:dark;--cursor-bg-primary:#212121;--cursor-bg-secondary:#292929;--cursor-bg-input:#303030;--cursor-text-primary:#eee;--cursor-text-secondary:#bbb;--cursor-stroke-secondary:#494949}*{box-sizing:border-box}body{margin:0;background:var(--cursor-bg-primary);color:var(--cursor-text-primary);font:14px/1.6 system-ui}aside{width:240px;background:var(--cursor-bg-secondary);height:100vh;padding:22px;position:absolute;inset:0 auto 0 0}aside button{display:block;width:100%;border:0;border-radius:8px;padding:12px;text-align:left;color:inherit;background:transparent;font:inherit}main{margin-left:240px;height:100vh;display:flex;flex-direction:column}header{padding:20px 28px;border-bottom:1px solid var(--cursor-stroke-secondary)}header h1{margin:0;font-size:18px}article{padding:30px;flex:1;overflow:auto}.message{margin:16px 0;max-width:610px}.bubble{padding:12px 16px;border-radius:9px;background:var(--cursor-bg-secondary);margin-top:6px}.composer{margin:0 28px 24px;border:1px solid var(--cursor-stroke-secondary);border-radius:12px;padding:16px}textarea{width:100%;min-height:65px;background:transparent;border:0;resize:none;color:inherit;font:inherit;outline:none}#activity{margin:0 28px}.fixture-note{font-size:11px;color:var(--cursor-text-secondary);margin:8px 28px}#fixture-open{border:1px solid var(--cursor-stroke-secondary);background:transparent;color:inherit;border-radius:8px;padding:8px 12px;font:inherit}@media(max-width:700px){aside{width:150px;padding:12px}main{margin-left:150px}.composer{margin:0 12px 12px}article{padding:15px}#activity{margin:0 12px}header{padding:15px}}</style>
<body><aside class="sand-agents-sidebar"><button class="sand-agents-sidebar__new">＋</button><div class="sand-agents-list"></div></aside><main class="sand-chat-screen"><header class="sand-toolbar"><h1>产品协作群</h1><div class="sand-toolbar__title"></div></header><article><div class="message"><strong>你</strong><div class="bubble">先把群聊与单 Bot 的交流做顺畅，保持现有风格。</div></div><div class="message"><strong>小林</strong><div class="bubble">我来整理会话交互。阿澈负责消息连续性，我们在群里交接。</div></div><div class="message"><strong>阿澈</strong><div class="bubble">连续提问的处理已完成，正在验证恢复路径。可以继续补充要求。</div></div></article><div id="activity"></div><div class="sand-chat-input-dock composer"><textarea aria-label="聊天输入" placeholder="发消息，输入 @ 提到同事"></textarea><button id="fixture-open">新建群聊</button></div><p class="fixture-note">实际修改组件 · 外层会话与连接数据为测试夹具</p></main>
<script>
window.__sandUiLanguage='zh';window.__fixtureCalls=[];
window.__fixtureBots=[{id:'a',name:'小林',description:'产品与交互',avatarShape:'blob',avatarColor:'orange'},{id:'b',name:'阿澈',description:'工程实现',avatarShape:'hex',avatarColor:'blue'},{id:'c',name:'小禾',description:'检查与验证',avatarShape:'flower',avatarColor:'green'},{id:'d',name:'知白',description:'文档与交付',avatarShape:'cloud',avatarColor:'purple'}];
window.__fixtureSnapshot={conversationId:'room',readOnly:false,counts:{processing:1,queued:1,attention:1},items:[{messageId:'q2',revision:3,preview:'补充：单 Bot 和群聊同等重要。',recipients:[{botId:'b',name:'阿澈',phase:'queued',updatedAt:1,replyIds:[]}]},{messageId:'q3',revision:4,preview:'请核查输入法回归结果。',recipients:[{botId:'c',name:'小禾',phase:'failed',updatedAt:2,replyIds:[]}]}]};
window.desktop={agent:{getUiLanguage:async()=>({language:window.__sandUiLanguage}),getInferenceVendors:async()=>({vendors:[{id:'v',label:'Configured model'}],defaultVendorId:'v'}),getConversationActivity:async({agentId})=>window.__fixtureSnapshot,stopConversation:async args=>{window.__fixtureCalls.push(['stop',args]);},cancelQueuedConversationMessage:async args=>{window.__fixtureCalls.push(['cancel',args]);}},nodes:{onChanged:()=>()=>{}}};
window.__beebotServerBots={listServers:async()=>[]};window.__sandRoster={snapshots:{get:()=>({agents:{rows:[...window.__fixtureBots,{id:'room',name:'产品协作群',isGroup:true,memberIds:['a','b','c']}]}})}};
for(const bot of window.__fixtureBots){const item=document.createElement('button');item.dataset.agentId=bot.id;item.innerHTML='<span class="sand-agent-item__name"></span>';item.firstElementChild.textContent=bot.name;document.querySelector('.sand-agents-list').append(item);}
</script><script src="activity.js"></script><script src="creation.js"></script><script>
window.__fixtureOpenGroup=()=>window.__sandPickCreateGroup({onCreate:async draft=>{window.__fixtureCalls.push(['createGroup',draft]);if(window.__fixtureFail)throw new Error('创建暂未确认，输入已保留');return{id:'new-group'};}});
window.__fixtureOpenBot=()=>window.__sandPickCreateBot(undefined,{onCreate:async draft=>{window.__fixtureCalls.push(['createBot',draft]);if(window.__fixtureFail)throw new Error('Create failed');return{agent:{id:'new-bot'}};}});
document.querySelector('#fixture-open').onclick=window.__fixtureOpenGroup;
window.__fixtureMountActivity({conversationId:'room',entries:[],interactions:{onReply:id=>{window.__fixtureCalls.push(['reply',id]);document.querySelector('textarea').focus();}}});
</script></body></html>`);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await buildConversationUiFixture(process.argv[2]);
