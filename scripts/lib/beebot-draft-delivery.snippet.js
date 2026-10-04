/* Selection changes invalidate only the draft view; they never cancel delivery. */
function RBindDraftDelivery(runtime){
  if(window.__beebotDraftDeliveryRuntime?.runtime===runtime)return;
  window.__beebotDraftDeliveryRuntime?.dispose();
  let generation=0,disposed=false,last="",listeners=new Set();
  const offs=[];
  const signature=()=>JSON.stringify({selection:runtime.selection?.snapshots?.get?.()?.currentAgentId||null,connection:runtime.connection?.snapshots?.get?.()||null,remote:document.body?.dataset.beebotRemoteActive==="true"});
  const notify=()=>{if(disposed)return;const next=signature();if(next!==last){last=next;generation++;}for(const listener of listeners)listener();};
  last=signature();
  for(const store of [runtime.selection?.snapshots,runtime.connection?.snapshots])if(store?.subscribe)offs.push(store.subscribe(notify));
  window.addEventListener("sand-ui-language-changed",notify);
  const observer=new MutationObserver(notify);if(document.body)observer.observe(document.body,{attributes:true,attributeFilter:["data-beebot-remote-active"]});
  const adapter={
    getScope(){return {agentId:runtime.selection?.snapshots?.get?.()?.currentAgentId||null,generation,available:!disposed&&document.body?.dataset.beebotRemoteActive!=="true"&&runtime.connection?.snapshots?.get?.()?.transport!=="down"&&typeof runtime.roster?.getDraftDelivery==="function"&&typeof runtime.roster?.resolveDraftDelivery==="function",language:window.__sandUiLanguage};},
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    getSnapshot(args){return runtime.roster.getDraftDelivery(args);},
    resolve(args){return runtime.roster.resolveDraftDelivery(args);}
  };
  window.__beebotDraftDeliveryRuntime={runtime,adapter,dispose(){disposed=true;generation++;for(const off of offs)off?.();observer.disconnect();window.removeEventListener("sand-ui-language-changed",notify);for(const listener of listeners)listener();listeners.clear();}};
}
window.__beebotDraftCardFactories=new WeakMap();
window.__beebotDraftCard=function({React,entry}){
  let Card=window.__beebotDraftCardFactories.get(React);
  if(!Card){Card=BB_DraftDelivery.createDraftDeliveryCard(React);window.__beebotDraftCardFactories.set(React,Card);}
  const adapter=window.__beebotDraftDeliveryRuntime?.adapter||null;
  return React.createElement(Card,{entry,adapter});
};
