// UI copy only. No DOM text rewriting, remounts, model calls or permission changes.
(function(){
  if(window.__beebotUiLanguage)return;
  const listeners=new Set();
  let language=window.__sandUiLanguage==="zh"?"zh":"en",generation=0;
  const publish=next=>{
    next=next==="zh"?"zh":"en";
    const changed=next!==language;language=next;window.__sandUiLanguage=next;
    document.documentElement.lang=next==="zh"?"zh-CN":"en";
    if(changed)for(const listener of [...listeners])listener();
  };
  const announce=next=>{publish(next);window.dispatchEvent(new Event("sand-ui-language-changed"));};
  const api={
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)},
    snapshot(){return language},
    text(english){return language==="zh"?(BB_UI_ZH[english]??english):english},
    format(english,values){return api.text(english).replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)]))},
    computed(value,patterns){
      if(language!=="zh"||typeof value!=="string")return value;
      for(const pattern of patterns){
        if(value===pattern)return api.text(pattern);
        if(!/\{\d+\}/.test(pattern))continue;
        const slots=[],parts=pattern.split(/(\{\d+\})/g);
        const regex=parts.map(part=>{if(/^\{\d+\}$/.test(part)){slots.push(Number(part.slice(1,-1)));return "([\\s\\S]*?)"}return part.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}).join("");
        const match=new RegExp("^"+regex+"$").exec(value);
        if(match){const values=[];slots.forEach((slot,i)=>{values[slot]=match[i+1]});return api.format(pattern,values)}
      }
      return value;
    },
    memo(cache,React){
      React.useSyncExternalStore(api.subscribe,api.snapshot,api.snapshot);
      const languageSlot=cache.length-1;
      if(cache[languageSlot]!==language){cache.fill(Symbol.for("react.memo_cache_sentinel"));cache[languageSlot]=language}
      return cache;
    },
    async set(next){
      const serial=++generation;
      const result=await window.desktop.agent.setUiLanguage(next);
      if(serial===generation)announce(result?.language===undefined?next:result.language);
      return language;
    },
    async initialize(){
      const serial=generation;
      try{const result=await window.desktop.agent.getUiLanguage();if(serial===generation)announce(result?.language)}catch{/* Keep the last known UI language; never claim it was saved. */}
    }
  };
  window.__beebotUiLanguage=api;
  window.addEventListener("sand-ui-language-changed",()=>{generation++;publish(window.__sandUiLanguage)});
  publish(language);void api.initialize();
})();
