/** Restrict changes to the existing New Bot dialog. The local/remote create
 * callbacks, request keys, errors and Group flow remain byte-for-byte intact. */
export function patchPresenceCreatePicker(source) {
  const startMarker = "window.__sandPickCreateBot=async function(preset,{onCreate}={}){";
  const endMarker = "window.__sandPickCreateGroup=async function({onCreate}={}){";
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0 || source.indexOf(startMarker, start + 1) >= 0 || source.indexOf(endMarker, end + 1) >= 0) throw new Error("Presence New Bot boundary mismatch");
  let dialog = source.slice(start, end);
  const once = (before, after, label) => {
    const offset = dialog.indexOf(before);
    if (offset < 0 || dialog.indexOf(before, offset + before.length) >= 0) throw new Error(`Presence New Bot anchor mismatch: ${label}`);
    dialog = dialog.slice(0, offset) + after + dialog.slice(offset + before.length);
  };
  once("  let appearanceOpen=false,roleDetailsOpen", "  let roleDetailsOpen", "appearance is visible on creation");
  once('    appearanceOpen=root.querySelector(".bb-create-appearance")?.open??appearanceOpen;\n', "", "remove collapsed-state read");
  once("alive=false;roleForm?.dispose();refreshSerial++;unsubscribe?.();", "alive=false;roleForm?.dispose();refreshSerial++;root.__bbAvatarPicker?.destroy();root.__bbAvatarPicker=null;unsubscribe?.();", "dispose preview on close");
  once('    root.innerHTML="";', '    root.__bbAvatarPicker?.destroy();root.__bbAvatarPicker=null;\n    root.innerHTML="";', "dispose before dialog repaint");
  once('    for(const field of root.querySelectorAll("input,textarea,select,button"))field.disabled=busy;', '    root.__bbAvatarPicker?.setDisabled(busy);\n    for(const field of root.querySelectorAll("input,textarea,select,button"))field.disabled=busy;', "pending appearance lock");
  // Exact readable-source anchors fail closed rather than changing unknown code.
  once(`    const preview=document.createElement("div"); preview.style.cssText="width:32px;height:32px;margin:0"; preview.append(RBotSvg(shape,color,32));
    const colors=document.createElement("div"); colors.style.cssText="width:min(420px,100%);display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-bottom:12px";
    for(const item of R_COLORS){const b=document.createElement("button"); b.type="button";b.setAttribute("aria-label",item.id); b.style.cssText="width:26px;height:26px;border-radius:13px;border:"+(item.id===color?"2px solid var(--cursor-text-primary,CanvasText)":"2px solid transparent")+";background:"+item.hex+";cursor:pointer"; b.onclick=()=>{if(!busy){color=item.id;paint()}}; colors.append(b)}
    const shapes=document.createElement("div"); shapes.style.cssText="width:min(420px,100%);display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-bottom:20px";
    for(const item of R_SHAPES){const b=document.createElement("button"); b.type="button"; b.title=item; b.style.cssText="width:36px;height:36px;border:0;padding:0;background:transparent;cursor:pointer;border-radius:8px;outline:"+(item===shape?"2px solid var(--cursor-text-primary,CanvasText)":"none")+";outline-offset:2px"; b.append(RBotSvg(item,item===shape?color:"gray",32)); b.onclick=()=>{if(!busy){shape=item;paint()}}; shapes.append(b)}
`, "", "replace old static swatches");
  once(`    const appearance=document.createElement("details");appearance.className="bb-create-appearance";appearance.open=appearanceOpen;
    const summary=document.createElement("summary");summary.dataset.createField="appearance";summary.append(preview,document.createTextNode(RCreateText("头像与颜色","Appearance")));
    appearance.append(summary,colors,shapes);`, `    const appearance=document.createElement("div");
    root.__bbAvatarPicker=RPresenceUI.mountAvatarPicker(appearance,{shape,color,language:window.__sandUiLanguage==="zh"?"zh":"en",disabled:busy,onChange:value=>{if(!busy){shape=value.shape;color=value.color}}});`, "visible shared picker");
  return source.slice(0, start) + dialog + source.slice(end);
}
