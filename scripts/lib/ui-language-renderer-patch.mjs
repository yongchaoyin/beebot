import { patchUiLanguageFormatters } from "./ui-language-formatters.mjs";
import { parse } from "acorn";
import { ancestor } from "acorn-walk";
import { readFileSync } from "node:fs";
import { UI_ZH_TRANSLATIONS } from "./ui-language-catalog.mjs";

const runtime=readFileSync(new URL("./ui-language-runtime.snippet.js",import.meta.url),"utf8");
const displayKeys=new Set(["children","label","title","description","placeholder","aria-label","ariaLabel","alt","tooltip","emptyMessage","heading","tagline","confirmLabel","cancelLabel","behaviorAriaLabel","draftAriaLabel","submitAriaLabel","submitLabel","preview"]);
const rawFunctions=new Set(["RRouterPanel","RRouterUsage","RRouterUsageSummary","RRouterUsageRows","RRouterCredential","RBoxRuntime","RVendorSetup"]);
const keyOf=node=>node.computed?null:node.key.name??node.key.value;

/** Only code-owned display expressions are translated. User data, selector keys,
 * input values, transport payloads and operation IDs are never rewritten. */
export function patchUiLanguageRenderer(source,{main=false,cacheBinding,reactBinding,name}={}){
  if(name)source=patchUiLanguageFormatters(source,name);
  if(source.includes("function BB_uiMemo("))throw new Error("UI language adapter is already installed");
  const ast=parse(source,{ecmaVersion:"latest",sourceType:"module"});
  const edits=[],translated=new Set();
  const scopes=new Map();
  const isFunction=n=>/Function/.test(n.type);
  const isScope=n=>["Program","BlockStatement","CatchClause","ForStatement","ForInStatement","ForOfStatement","SwitchStatement"].includes(n.type)||isFunction(n);
  function ensureScope(scope,ancestors){
    if(!scopes.has(scope))scopes.set(scope,{declarations:new Map(),assignments:new Map(),parent:ancestors.slice(0,ancestors.indexOf(scope)).reverse().find(isScope)});
    return scopes.get(scope);
  }
  function bindPattern(pattern,info){
    if(!pattern)return;
    if(pattern.type==="Identifier")info.declarations.set(pattern.name,{init:null});
    else if(pattern.type==="AssignmentPattern")bindPattern(pattern.left,info);
    else if(pattern.type==="RestElement")bindPattern(pattern.argument,info);
    else if(pattern.type==="ObjectPattern")for(const p of pattern.properties)bindPattern(p.type==="RestElement"?p.argument:p.value,info);
    else if(pattern.type==="ArrayPattern")for(const item of pattern.elements)bindPattern(item,info);
  }
  const recordScope=(node,_state,ancestors)=>{const info=ensureScope(node,ancestors);if(isFunction(node))for(const p of node.params)bindPattern(p,info);if(node.type==="CatchClause")bindPattern(node.param,info)};
  ancestor(ast,{
    Program:recordScope,BlockStatement:recordScope,CatchClause:recordScope,ForStatement:recordScope,ForInStatement:recordScope,ForOfStatement:recordScope,SwitchStatement:recordScope,FunctionDeclaration:recordScope,FunctionExpression:recordScope,ArrowFunctionExpression:recordScope,
    VariableDeclarator(node,_state,ancestors){
      const declaration=ancestors.at(-2),scope=[...ancestors].reverse().find(n=>declaration.kind==="var"?n.type==="Program"||isFunction(n):isScope(n));
      const info=ensureScope(scope,ancestors);
      if(node.id.type==="Identifier")info.declarations.set(node.id.name,node);else bindPattern(node.id,info);
    }
  });
  function ownerOf(name,scope){let owner=scope;while(owner&&!scopes.get(owner)?.declarations.has(name))owner=scopes.get(owner)?.parent;return owner}
  ancestor(ast,{AssignmentExpression(node,_state,ancestors){
    if(node.left.type!=="Identifier"||node.operator!=="=")return;
    const owner=ownerOf(node.left.name,[...ancestors].reverse().find(isScope));if(!owner)return;
    const info=scopes.get(owner),list=info.assignments.get(node.left.name)??[];list.push(node.right);info.assignments.set(node.left.name,list);
  }});
  const queued=new Set();
  function cacheRead(node,scope){
    if(node.type!=="MemberExpression"||node.object.type!=="Identifier")return false;
    const owner=ownerOf(node.object.name,scope),init=scopes.get(owner)?.declarations.get(node.object.name)?.init;
    return init?.type==="CallExpression"&&init.callee.type==="MemberExpression"&&init.callee.object.name===cacheBinding&&init.callee.property.name==="c";
  }
  // Trace only code-owned display values, then translate at the display read.
  // Never rewrite a shared local: it might also be an input/operation value.
  function displayPatterns(node,scope,seen=new Set()){
    if(!node)return null;
    if(node.type==="Literal"&&typeof node.value==="string")return new Set([node.value]);
    if(node.type==="TemplateLiteral")return new Set([node.quasis.map((q,i)=>q.value.cooked+(i<node.expressions.length?`{${i}}`:"")).join("")]);
    if(cacheRead(node,scope))return new Set();
    if(node.type==="ConditionalExpression"){
      const left=displayPatterns(node.consequent,scope,new Set(seen)),right=displayPatterns(node.alternate,scope,new Set(seen));
      return left&&right?new Set([...left,...right]):null;
    }
    if(node.type!=="Identifier")return null;
    const owner=ownerOf(node.name,scope),info=scopes.get(owner),declaration=info?.declarations.get(node.name);
    if(!declaration||seen.has(declaration))return null;seen.add(declaration);
    const values=[declaration.init,...(info.assignments.get(node.name)??[])].filter(Boolean);
    if(!values.length)return null;
    const patterns=new Set();
    for(const value of values){const found=displayPatterns(value,owner,new Set(seen));if(!found)return null;for(const pattern of found)patterns.add(pattern)}
    return patterns;
  }
  const textCall=value=>{translated.add(value);return `BB_uiText(${JSON.stringify(value)})`};
  function translateExpression(node){
    if(queued.has(node))return true;
    let text;
    if(node.type==="Literal"&&typeof node.value==="string"&&Object.hasOwn(UI_ZH_TRANSLATIONS,node.value))text=textCall(node.value);
    if(node.type==="TemplateLiteral"){
      const key=node.quasis.map((q,i)=>q.value.cooked+(i<node.expressions.length?`{${i}}`:"")).join("");
      if(Object.hasOwn(UI_ZH_TRANSLATIONS,key)){translated.add(key);text=`BB_uiFormat(${JSON.stringify(key)},[${node.expressions.map(x=>source.slice(x.start,x.end)).join(",")}])`;}
    }
    if(text!==undefined){queued.add(node);edits.push({start:node.start,end:node.end,text});return true}
    if(["ConditionalExpression","LogicalExpression","ArrayExpression"].includes(node.type)||(node.type==="BinaryExpression"&&node.operator==="+")){
      const nodes=node.type==="ConditionalExpression"?[node.consequent,node.alternate]:node.type==="ArrayExpression"?node.elements:[node.left,node.right];
      let changed=false;for(const child of nodes.filter(Boolean))if(translateExpression(child))changed=true;return changed;
    }
    return false;
  }
  ancestor(ast,{
    Property(node,_state,ancestors){
      if(node.kind!=="init"||!displayKeys.has(keyOf(node)))return;
      const scope=[...ancestors].reverse().find(isScope);
      let changed=translateExpression(node.value);
      if(!changed&&node.value.type==="Identifier"){
        const patterns=displayPatterns(node.value,scope);
        const known=patterns?[...patterns].filter(value=>Object.hasOwn(UI_ZH_TRANSLATIONS,value)):[];
        if(known.length){known.forEach(value=>translated.add(value));edits.push({start:node.value.start,end:node.value.end,text:`BB_uiComputed(${source.slice(node.value.start,node.value.end)},${JSON.stringify(known)})`});changed=true}
      }
      if(!changed)return;
      // Only immutable module-level menus need live getters. React render props
      // must stay value snapshots: a getter in the previous props would change
      // alongside the next props, hiding the update from React's DOM diff.
      if(!ancestors.some(isFunction)){
        edits.push({start:node.start,end:node.value.start,text:`get ${source.slice(node.key.start,node.key.end)}(){return `});
        edits.push({start:node.value.end,end:node.value.end,text:"}"});
      }else if(node.shorthand){
        edits.push({start:node.start,end:node.start,text:`${source.slice(node.key.start,node.key.end)}:`});
      }
    },
    CallExpression(node){
      if(["BB_uiText","BB_uiFormat"].includes(node.callee.name)&&typeof node.arguments[0]?.value==="string")translated.add(node.arguments[0].value);
      if(cacheBinding&&node.callee.type==="MemberExpression"&&node.callee.object.name===cacheBinding&&node.callee.property.name==="c")
        {
        if(node.arguments.length!==1||!Number.isInteger(node.arguments[0].value))throw new Error("UI language compiler cache size must be pinned");
        edits.push({start:node.start,end:node.end,text:`BB_uiMemo(${cacheBinding}.c(${node.arguments[0].value+1}))`});
      }
    },
    FunctionDeclaration(node){
      if(rawFunctions.has(node.id?.name))edits.push({start:node.body.start+1,end:node.body.start+1,text:`BB_uiReact().useSyncExternalStore(window.__beebotUiLanguage.subscribe,window.__beebotUiLanguage.snapshot,window.__beebotUiLanguage.snapshot);`});
    }
  });
  // Nested JSX values are visited separately, so overlapping display expressions
  // are a build error rather than silently dropping a transform.
  edits.sort((a,b)=>b.start-a.start);
  for(let i=1;i<edits.length;i++)if(edits[i].end>edits[i-1].start)throw new Error(`Overlapping UI language adapter anchors: ${source.slice(edits[i].start,edits[i].end).slice(0,160)} / ${source.slice(edits[i-1].start,edits[i-1].end).slice(0,160)}`);
  let result=source;for(const e of edits)result=result.slice(0,e.start)+e.text+result.slice(e.end);
  if(!edits.length&&!main)return {source,translated:[]};
  const helpers=`\nfunction BB_uiReact(){return ${main?"window.__beebotUiReact=S":reactBinding??"window.__beebotUiReact"}}\nfunction BB_uiMemo(cache){return window.__beebotUiLanguage.memo(cache,BB_uiReact())}\nfunction BB_uiText(value){return window.__beebotUiLanguage.text(value)}\nfunction BB_uiFormat(value,args){return window.__beebotUiLanguage.format(value,args)}\nfunction BB_uiComputed(value,patterns){return window.__beebotUiLanguage.computed(value,patterns)}\n`;
  const prefix=main?`const BB_UI_ZH=${JSON.stringify(UI_ZH_TRANSLATIONS)};\n${runtime}\n`:"";
  return {source:prefix+helpers+result,translated:[...translated].sort()};
}

export function uiLanguageBindings(source,name){
  if(name==="index-UbX-y3il.js")return {main:true,cacheBinding:"he",reactBinding:"S",name};
  const ast=parse(source,{ecmaVersion:"latest",sourceType:"module"});
  const imports=ast.body.filter(n=>n.type==="ImportDeclaration"&&n.source.value==="./index-UbX-y3il.js").flatMap(n=>n.specifiers);
  const binding=key=>imports.find(n=>n.imported?.name===key)?.local.name;
  return {cacheBinding:binding("c"),reactBinding:binding("w"),name};
}
