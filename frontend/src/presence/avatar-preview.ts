import type * as ReactAPI from "react";
import { AVATAR_EXPRESSIONS, EXPRESSION_LABELS, expressionFromState, type AvatarExpression } from "./avatar-expression.ts";
import { createPresenceCharacter, type PresenceCharacterHandle } from "./character.ts";
import type { AvatarGesture } from "./avatar-motion.ts";

/** Preview only. Never writes a Bot profile, activity, receipt or preference. */
export function mountAvatarExpressionControls(host: HTMLElement, callbacks: { expression(value: AvatarExpression): void; gesture(kind: AvatarGesture): void; reset?(): void }, language: "en" | "zh", disabled = false) {
  const doc=host.ownerDocument, details=doc.createElement("details"), summary=doc.createElement("summary"), content=doc.createElement("div");
  details.className="bb-expression-controls";
  const label=doc.createElement("label"), select=doc.createElement("select"), hint=doc.createElement("small");
  label.append(select); content.append(label);
  for (const key of AVATAR_EXPRESSIONS) { const option=doc.createElement("option");option.value=key;select.append(option); }
  const actions=doc.createElement("div");actions.className="bb-expression-controls__actions";
  const kinds=["greet","nod","celebrate"] as const;
  const buttons=kinds.map(kind=>{const button=doc.createElement("button");button.type="button";button.dataset.gesture=kind;actions.append(button);return button;});
  const reset=doc.createElement("button");reset.type="button";reset.dataset.gesture="reset";actions.append(reset);
  content.append(actions,hint);details.append(summary,content);host.append(details);
  let disposed=false;
  select.onchange=()=>{if(!disposed && !disabled) callbacks.expression(expressionFromState(select.value));};
  buttons.forEach((button,i)=>{button.onclick=()=>{if(!disposed && !disabled) callbacks.gesture(kinds[i]);};});
  reset.onclick=()=>{if(disposed || disabled)return;select.value="idle";callbacks.expression("idle");callbacks.reset?.();};
  const onToggle=()=>{if(!details.open && !disposed){select.value="idle";callbacks.expression("idle");callbacks.reset?.();}};
  details.addEventListener("toggle",onToggle);
  function paint() {
    const zh=language==="zh";
    summary.textContent=zh?"试试表情和动作":"Try expressions and gestures";
    select.setAttribute("aria-label",zh?"仅预览表情":"Preview expression only");select.disabled=disabled;
    [...select.options].forEach(option=>{option.textContent=EXPRESSION_LABELS[option.value as AvatarExpression][zh?1:0];});
    buttons.forEach((button,i)=>{button.textContent=(zh?["打招呼","点头","轻庆祝"]:["Greet","Nod","Celebrate"])[i];button.disabled=disabled;});
    reset.textContent=zh?"还原":"Reset";reset.disabled=disabled;
    hint.textContent=zh?"仅预览，不改变 Bot 的工作状态；动态遵循系统与应用设置。":"Preview only; does not change Bot activity. Respects system and app motion settings.";
  }
  paint();
  return {
    setLanguage(next: "en" | "zh") {if(disposed)return;language=next;paint();},
    setDisabled(next: boolean) {if(disposed)return;disabled=next;paint();},
    destroy() {if(disposed)return;disposed=true;details.removeEventListener("toggle",onToggle);select.onchange=null;buttons.forEach(b=>b.onclick=null);reset.onclick=null;details.remove();},
  };
}

/** Reuses the caller's React singleton in the editable and packaged editors. */
export function createPresenceAvatarPreview(React: typeof ReactAPI) {
  const Character=createPresenceCharacter(React);
  const subscribe=(listener:()=>void)=>{window.addEventListener("sand-ui-language-changed",listener);return()=>window.removeEventListener("sand-ui-language-changed",listener);};
  const language=(): "en" | "zh" =>((window as Window & {__sandUiLanguage?:string}).__sandUiLanguage??document.documentElement.lang).startsWith("zh")?"zh":"en";
  return function AvatarPreview({shape,color}:{shape:string;color:string}) {
    const [expression,setExpression]=React.useState<AvatarExpression>("idle");
    const host=React.useRef<HTMLDivElement>(null), character=React.useRef<PresenceCharacterHandle>(null);
    const controls=React.useRef<ReturnType<typeof mountAvatarExpressionControls>|null>(null);
    const lang=React.useSyncExternalStore(subscribe,language,()=>"en" as const);
    React.useEffect(()=>{
      if (!host.current) return;
      controls.current=mountAvatarExpressionControls(host.current,{expression:value=>{character.current?.reset?.();setExpression(value);},reset:()=>character.current?.reset?.(),gesture:kind=>{
        if(kind==="greet") character.current?.spin();
        else if(kind==="celebrate") character.current?.celebrate?.();
        else character.current?.bounce();
      }},lang);
      return()=>{controls.current?.destroy();controls.current=null;};
    },[]);
    React.useEffect(()=>controls.current?.setLanguage(lang),[lang]);
    return React.createElement("section",{className:"bb-avatar-expression-preview"},
      React.createElement(Character,{ref:character,className:"bb-avatar-preview",shape,color,state:expression,sizePx:76,paused:false,isFollowingPointer:true,motionPriority:120}),
      React.createElement("div",{ref:host}));
  };
}
