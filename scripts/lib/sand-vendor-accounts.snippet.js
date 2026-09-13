function RVendorCopy(){
  return (window.__sandUiLanguage||"en")==="zh"?{
    title:"模型 API",
    add:"添加模型",
    save:"保存",
    cancel:"取消",
    remove:"删除",
    edit:"编辑",
    def:"默认",
    setDef:"设为默认",
    name:"名称",
    namePh:"例如 DeepSeek 主力",
    vendor:"厂商",
    key:"API key",
    keyPh:"粘贴 API key",
    keyReplace:"已保存 — 粘贴即可更换",
    base:"Base URL",
    model:"模型 ID",
    empty:"还没有保存的模型。添加后，新建 Bot 时可以为每个 Bot 选择不同的 API。",
    adding:"添加模型",
    editing:"编辑模型",
    customNeed:"自定义厂商需要 Base URL 和模型 ID。",
    keyNeed:"请粘贴 API key。",
    saved:"密钥已保存在这台 Mac 上，只用于这个模型。"
  }:{
    title:"Model APIs",
    add:"Add model",
    save:"Save",
    cancel:"Cancel",
    remove:"Remove",
    edit:"Edit",
    def:"Default",
    setDef:"Set default",
    name:"Name",
    namePh:"e.g. DeepSeek main",
    vendor:"Vendor",
    key:"API key",
    keyPh:"Paste API key",
    keyReplace:"Saved — paste to replace",
    base:"Base URL",
    model:"Model ID",
    empty:"No saved models yet. Add one, then pick it when you create a bot.",
    adding:"Add model",
    editing:"Edit model",
    customNeed:"Custom vendors need a Base URL and model ID.",
    keyNeed:"Paste an API key.",
    saved:"The key stays on this Mac and is used only for this model."
  };
}
function RVendorInput(n){
  return a.jsx("input",{
    "aria-label":n.label,
    className:RRouterInputClass,
    disabled:n.disabled===!0,
    onChange:n.onChange,
    placeholder:n.placeholder,
    spellCheck:!1,
    style:{fontSize:13,height:34,minWidth:160,padding:"0 10px",width:220},
    type:n.type||"text",
    value:n.value
  });
}
function RVendorAccounts(){
  const copy=RVendorCopy();
  const http=RRouterProviders.filter(n=>n.kind==="http");
  const first=http[0];
  const[s,e]=de.useState({vendors:[],defaultVendorId:null,error:null,busy:!1,adding:!1,editingId:null,label:"",provider:first.value,apiKey:"",baseUrl:first.base,modelId:first.model,hasKey:!1});
  de.useEffect(()=>{
    let t=!0;
    const load=()=>{window.desktop.agent.getInferenceVendors().then(n=>{t&&e(r=>({...r,vendors:Array.isArray(n?.vendors)?n.vendors:[],defaultVendorId:n?.defaultVendorId||null,error:null}))}).catch(n=>{t&&e(r=>({...r,error:String(n?.message??n)}))})};
    load();
    const onLang=()=>e(r=>({...r}));
    window.addEventListener("sand-inference-vendors-changed",load);
    window.addEventListener("sand-ui-language-changed",onLang);
    return()=>{t=!1;window.removeEventListener("sand-inference-vendors-changed",load);window.removeEventListener("sand-ui-language-changed",onLang)};
  },[]);
  const pick=n=>{const p=http.find(i=>i.value===n)??first;e(r=>({...r,provider:p.value,baseUrl:p.base,modelId:p.model}))};
  const apply=n=>e(r=>({...r,vendors:Array.isArray(n?.vendors)?n.vendors:r.vendors,defaultVendorId:n?.defaultVendorId||null,busy:!1,error:null}));
  const resetForm=()=>e(r=>({...r,adding:!1,editingId:null,label:"",provider:first.value,apiKey:"",baseUrl:first.base,modelId:first.model,hasKey:!1,error:null}));
  const beginAdd=()=>e(r=>({...r,adding:!0,editingId:null,label:"",provider:first.value,apiKey:"",baseUrl:first.base,modelId:first.model,hasKey:!1,error:null}));
  const beginEdit=n=>e(r=>({...r,adding:!0,editingId:n.id,label:n.label||"",provider:n.provider,apiKey:"",baseUrl:n.baseUrl||"",modelId:n.modelId||"",hasKey:!0,error:null}));
  const save=async()=>{
    if(s.provider==="custom"&&(s.baseUrl.trim().length===0||s.modelId.trim().length===0)){e(r=>({...r,error:copy.customNeed}));return}
    if(s.apiKey.trim().length===0&&!s.hasKey){e(r=>({...r,error:copy.keyNeed}));return}
    e(r=>({...r,busy:!0,error:null}));
    try{
      const n=await window.desktop.agent.upsertInferenceVendor({...(s.editingId?{id:s.editingId}:{}),label:s.label.trim(),provider:s.provider,apiKey:s.apiKey.trim(),baseUrl:s.baseUrl.trim(),modelId:s.modelId.trim()});
      apply(n);
      e(r=>({...r,adding:!1,editingId:null,label:"",apiKey:"",hasKey:!1}));
      window.dispatchEvent(new Event("sand-inference-vendors-changed"));
    }catch(n){e(r=>({...r,busy:!1,error:String(n?.message??n)}))}
  };
  const remove=async id=>{e(r=>({...r,busy:!0,error:null}));try{apply(await window.desktop.agent.deleteInferenceVendor(id));if(s.editingId===id)resetForm();window.dispatchEvent(new Event("sand-inference-vendors-changed"))}catch(n){e(r=>({...r,busy:!1,error:String(n?.message??n)}))}};
  const makeDefault=async n=>{e(r=>({...r,busy:!0,error:null}));try{apply(await window.desktop.agent.upsertInferenceVendor({id:n.id,label:n.label,provider:n.provider,baseUrl:n.baseUrl,modelId:n.modelId,makeDefault:!0}));window.dispatchEvent(new Event("sand-inference-vendors-changed"))}catch(t){e(r=>({...r,busy:!1,error:String(t?.message??t)}))}};
  const list=s.vendors.length===0
    ? a.jsx(ie,{description:copy.empty,label:copy.title,variant:"card",children:a.jsx(oe,{disabled:s.busy,onClick:beginAdd,shape:"rectangular",size:"sm",children:copy.add})})
    : a.jsxs("div",{children:[s.vendors.map((n,i)=>a.jsx(ie,{description:n.provider+" · "+n.modelId,divided:i>0,label:n.label,variant:"card",children:a.jsxs("div",{style:{display:"flex",alignItems:"center",gap:8},children:[n.id===s.defaultVendorId?a.jsx(se,{as:"span",color:"primary",size:"sm",children:copy.def}):a.jsx(oe,{disabled:s.busy,onClick:()=>void makeDefault(n),shape:"rectangular",size:"sm",variant:"secondary",children:copy.setDef}),a.jsx(oe,{disabled:s.busy,onClick:()=>beginEdit(n),shape:"rectangular",size:"sm",variant:"secondary",children:copy.edit}),a.jsx(oe,{disabled:s.busy,onClick:()=>void remove(n.id),shape:"rectangular",size:"sm",variant:"secondary",children:copy.remove})]})},n.id)),a.jsx("div",{style:{marginTop:12},children:a.jsx(oe,{disabled:s.busy||s.adding,onClick:beginAdd,shape:"rectangular",size:"sm",children:copy.add})})]});
  const form=s.adding?a.jsxs("div",{children:[
    a.jsx(ie,{description:copy.saved,label:copy.name,variant:"card",children:RVendorInput({label:copy.name,onChange:n=>e(r=>({...r,label:n.currentTarget.value})),placeholder:copy.namePh,value:s.label})}),
    a.jsx(ie,{divided:!0,label:copy.vendor,variant:"card",children:a.jsx(ye,{"aria-label":copy.vendor,onValueChange:n=>{if(n!==null)pick(n)},options:http.map(n=>({value:n.value,label:n.label})),placement:"bottom-end",size:"lg",value:s.provider,variant:"filled"})}),
    a.jsx(ie,{divided:!0,label:copy.key,variant:"card",children:RVendorInput({label:copy.key,onChange:n=>e(r=>({...r,apiKey:n.currentTarget.value})),placeholder:s.hasKey?copy.keyReplace:copy.keyPh,type:"password",value:s.apiKey})}),
    a.jsx(ie,{divided:!0,label:copy.base,variant:"card",children:RVendorInput({label:copy.base,onChange:n=>e(r=>({...r,baseUrl:n.currentTarget.value})),placeholder:copy.base,value:s.baseUrl})}),
    a.jsx(ie,{divided:!0,label:copy.model,variant:"card",children:RVendorInput({label:copy.model,onChange:n=>e(r=>({...r,modelId:n.currentTarget.value})),placeholder:copy.model,value:s.modelId})}),
    a.jsx("div",{style:{display:"flex",gap:8,justifyContent:"flex-end",marginTop:12},children:a.jsxs("div",{style:{display:"flex",gap:8},children:[a.jsx(oe,{disabled:s.busy,onClick:resetForm,shape:"rectangular",size:"sm",variant:"secondary",children:copy.cancel}),a.jsx(oe,{disabled:s.busy||s.apiKey.trim().length===0&&!s.hasKey,onClick:()=>void save(),shape:"rectangular",size:"sm",children:s.busy?"Saving…":copy.save})]})})
  ]}):null;
  return a.jsxs("div",{children:[list,s.adding?a.jsx("div",{style:{marginTop:20},children:a.jsx(re,{title:s.editingId?copy.editing:copy.adding,children:form})}):null,s.error?a.jsx(se,{as:"p",color:"red",size:"sm",children:s.error}):null]});
}
