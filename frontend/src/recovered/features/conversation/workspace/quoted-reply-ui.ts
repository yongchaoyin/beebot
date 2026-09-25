import type * as ReactAPI from "react";
import type { TranscriptReplyPreview } from "./model";

export type QuotePreview = TranscriptReplyPreview & { author?: string; targetId?: string; isUser?: boolean };
export type QuoteNavigation = (targetId: string) => void | boolean | Promise<void | boolean>;

const compact = (value: string, limit: number) => {
  const text = value.replace(/\s+/gu, " ").trim();
  const characters = Array.from(text);
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("").trimEnd()}…` : text;
};
export const quoteLanguage = () => typeof window !== "undefined" &&
  (window as Window & { __sandUiLanguage?: string }).__sandUiLanguage === "zh" ? "zh" : "en";
const copy = (zh: string, en: string, lang: string) => lang === "zh" ? zh : en;

export function quotedMessageLabel(preview: QuotePreview, lang = quoteLanguage()): string {
  switch (preview.kind) {
    case "user-text": case "assistant-text": return compact(preview.text, 140) || copy("空消息", "Empty message", lang);
    case "image": return copy("[图片]", "[Image]", lang);
    case "file": {
      let name = preview.name;
      if (!name) { try { name = decodeURIComponent(new URL(preview.url).pathname).split("/").pop(); } catch { name = preview.url.split(/[\\/]/u).pop(); } }
      return compact(`${copy("[文件]", "[File]", lang)} ${name || copy("附件", "Attachment", lang)}`, 140);
    }
    case "link": return compact(`${copy("[链接]", "[Link]", lang)} ${preview.url}`, 140);
    case "missing": return copy("原消息暂不可用", "Original message unavailable", lang);
  }
}
export function quotedAuthor(preview: QuotePreview, lang = quoteLanguage()): string {
  if (preview.isUser) return copy("你", "You", lang);
  return preview.author?.trim() || copy("原消息", "Original message", lang);
}

/** Only the current authorized transcript is passed here; this never fetches a
 * path/URL, resolves another conversation, or displays private/credential cards. */
export function previewFromTranscript(entry: any, fallbackName?: string): QuotePreview {
  if (!entry || entry.channel != null || entry.streaming === true) return { kind: "missing" };
  const isUser = entry.kind === "user-attachment" || (entry.kind === "message" && entry.role === "user" && entry.fromAgent == null);
  const rawAuthor = entry.fromAgent?.name || (typeof entry.author === "string" ? entry.author : entry.author?.name) || (isUser ? undefined : fallbackName);
  const author = typeof rawAuthor === "string" ? rawAuthor : undefined;
  const meta = { author, isUser, targetId: entry.id };
  const attachment = (url: string, name?: string): QuotePreview => typeof url !== "string" || (name != null && typeof name !== "string") ? { kind: "missing" } : /\.(?:png|jpe?g|gif|webp|avif)(?:[?#]|$)/iu.test(name || url)
    ? { ...meta, kind: "image", url } : { ...meta, kind: "file", url, name };
  if (entry.kind === "message") {
    const text = entry.content ?? entry.text ?? "";
    return typeof text === "string" ? { ...meta, kind: isUser ? "user-text" : "assistant-text", text } : { kind: "missing" };
  }
  if (entry.kind === "user-attachment") return attachment(entry.file_path, entry.file_name);
  if (entry.kind === "send-message") {
    const message = entry.message;
    if (message?.channel != null) return { kind: "missing" };
    if (message?.type === "text" && typeof message.content === "string") return { ...meta, kind: "assistant-text", text: message.content };
    if (message?.type === "attachment") return attachment(message.url, message.file_name);
    if (message?.type === "widget" && typeof message.widget?.prompt === "string") return { ...meta, kind: "assistant-text", text: message.widget.prompt };
  }
  return { kind: "missing" };
}

/** Only display an already-resolved raster from the authorized attachment cache.
 * Never fetch the original attachment URL or render an SVG/HTML data resource. */
export function quoteThumbnailSource(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 8 * 1024 * 1024 &&
    /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/u.test(value) ? value : undefined;
}

const CSS = `
.bb-quote-wrap{display:block;width:fit-content;max-width:100%;min-width:0;margin:4px 0 0;-webkit-app-region:no-drag}
.sand-reply-quote.bb-quoted-reply{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:fit-content;max-width:min(100%,460px);min-width:0;min-height:28px;margin:0;padding:5px 8px;text-align:start;border:0;border-radius:4px;background:var(--bb-quote-bg,var(--cursor-bg-tertiary,#ECEEF1));color:var(--bb-quote-text,var(--cursor-text-secondary,#596270));font:12px/18px var(--bb-font,system-ui);cursor:pointer;white-space:normal;overflow:hidden}
.bb-quoted-reply:hover{background:var(--bb-quote-hover,var(--cursor-bg-hover,#E1E4E9))}
.bb-quote-text{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;min-width:0;overflow:hidden;overflow-wrap:anywhere;text-overflow:ellipsis;white-space:normal}
.bb-quoted-reply .bb-quote-author,.bb-composer-quote .bb-quote-author{display:inline;font:inherit;color:inherit;unicode-bidi:isolate}
.bb-quoted-reply .sand-reply-quote__label,.bb-composer-quote .sand-reply-quote__label{display:inline;font:inherit;color:inherit;white-space:normal}
.bb-quote-thumb{display:block;flex:none;width:32px;height:32px;border-radius:3px;object-fit:cover}
.bb-quote-feedback{display:block;max-width:440px;font:11px/1.45 system-ui;color:var(--bb-quote-text,var(--cursor-text-secondary,#596270));margin-top:3px;overflow-wrap:anywhere}
.bb-quote-feedback:empty{display:none}.bb-quoted-reply:focus-visible,.bb-composer-quote button:focus-visible{outline:2px solid var(--bb-focus,Highlight);outline-offset:2px}
.sand-prompt-reply-pill.bb-composer-quote{display:flex;align-items:center;gap:8px;box-sizing:border-box;padding:2px 6px 2px 8px;margin:6px 0 0;min-height:30px;min-width:0;max-width:100%;border:0;border-radius:4px;background:var(--bb-quote-bg,var(--cursor-bg-tertiary,#ECEEF1));color:var(--bb-quote-text,var(--cursor-text-secondary,#596270));font:12px/18px var(--bb-font,system-ui)}
.bb-composer-quote .sand-prompt-reply-pill__body{display:block;flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.bb-composer-quote .sand-reply-quote__label{white-space:nowrap}
.bb-composer-quote .bb-quote-thumb{width:24px;height:24px}
.bb-composer-quote button{display:grid;place-items:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer;font:18px/1 system-ui}
.bb-composer-quote button:hover{background:var(--bb-quote-hover,var(--cursor-bg-hover,#E1E4E9))}
/* Match the reply's side, not the author of the original message. Keep the
   quote outside the bubble and inside the existing measured virtual row. */
.sand-message-block[data-quote-owner-role="user"]>.bb-quote-wrap,
.sand-transcript-row[data-role="user"]>.bb-quote-wrap{align-self:flex-end;margin-inline-start:auto}
.sand-message-block[data-quote-owner-role="assistant"]>.bb-quote-wrap,
.sand-transcript-row[data-role="assistant"]>.bb-quote-wrap{align-self:flex-start;margin-inline-end:auto}
.bb-quote-wrap[data-quote-variant="reference"]{display:inline-block;vertical-align:middle;margin:0 2px;max-width:100%}
.bb-quote-wrap[data-quote-variant="reference"] .bb-quoted-reply{padding:2px 6px;min-height:24px}
@media(forced-colors:active){.bb-quoted-reply,.bb-composer-quote{border:1px solid CanvasText!important;color:CanvasText!important;background:Canvas!important}}
`;

/** Inject the existing React runtime, not another bundled copy. Both the readable
 * frontend and checksum-pinned production renderer use these exact components. */
export function createQuotedReplyUI(React: typeof ReactAPI) {
  const h = React.createElement;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  const subscribe = (listener: () => void) => {
    if (!listeners.size && typeof window !== "undefined") window.addEventListener("sand-ui-language-changed", emit);
    listeners.add(listener);
    return () => { listeners.delete(listener); if (!listeners.size && typeof window !== "undefined") window.removeEventListener("sand-ui-language-changed", emit); };
  };
  function usePresentation() {
    const lang = React.useSyncExternalStore(subscribe, quoteLanguage, () => "en");
    React.useEffect(() => {
      if (document.getElementById("beebot-quoted-replies-style")) return;
      const style = document.createElement("style");style.id = "beebot-quoted-replies-style";style.textContent = CSS;document.head.append(style);
    }, []);
    return lang;
  }
  function QuotedReply({ targetId, preview, scopeId, onNavigate, ariaDescribedBy, thumbnailSrc, variant = "reply" }: { targetId: string; preview: QuotePreview; scopeId?: string; onNavigate: QuoteNavigation; ariaDescribedBy?: string; thumbnailSrc?: string; variant?: "reply" | "reference" }) {
    const lang = usePresentation();
    const [state, setState] = React.useState<"idle" | "locating" | "unavailable">("idle");
    const generation = React.useRef(0), timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const available = preview.kind !== "missing";
    const thumbnail = preview.kind === "image" ? quoteThumbnailSource(thumbnailSrc) : undefined;
    React.useEffect(() => {
      generation.current++;clearTimeout(timer.current);setState("idle");
      return () => { generation.current++;clearTimeout(timer.current); };
    }, [targetId, scopeId, available]);
    const navigate = async () => {
      if (state === "locating") return;
      const token = ++generation.current;clearTimeout(timer.current);setState("locating");
      try {
        const result = await onNavigate(targetId);
        if (token !== generation.current) return;
        if (result === false) setState("unavailable");
        else if (result === true || available) setState("idle");
        else timer.current = setTimeout(() => { if (token === generation.current) setState("unavailable"); }, 6000);
      } catch { if (token === generation.current) setState("unavailable"); }
    };
    const author = quotedAuthor(preview, lang), label = quotedMessageLabel(preview, lang);
    return h("span", { className: "bb-quote-wrap", "data-quote-variant": variant },
      h("button", { type: "button", className: "sand-reply-quote bb-quoted-reply", "data-variant": "quote", "data-reply-target-id": targetId,
        "aria-label": `${copy("引用", "Quote", lang)} ${author}: ${label}. ${copy("定位原消息", "Locate original message", lang)}`,
        "aria-busy": state === "locating", "aria-describedby": ariaDescribedBy, onClick: () => { void navigate(); } },
        h("span", { className: "bb-quote-text" },h("bdi", { className: "bb-quote-author" }, author), copy("：", ": ", lang),h("span", { className: "sand-reply-quote__label" }, label)),
        thumbnail ? h("img", { className: "bb-quote-thumb", src: thumbnail, alt: "", "aria-hidden": true, draggable: false }) : null),
      h("span", { role: "status", className: "bb-quote-feedback" }, state === "locating" ? copy("正在当前会话查找原消息…", "Locating in this conversation…", lang) : state === "unavailable" ? copy("暂未找到原消息，请加载历史后重试。引用关系仍保留。", "Original not located. Load history and retry; the reference is retained.", lang) : ""));
  }
  function ComposerQuote({ preview, onClear, thumbnailSrc }: { preview: QuotePreview; onClear(): void; thumbnailSrc?: string }) {
    const lang = usePresentation();const id = React.useId();
    const author = quotedAuthor(preview, lang);
    const thumbnail = preview.kind === "image" ? quoteThumbnailSource(thumbnailSrc) : undefined;
    return h("div", { className: "sand-prompt-reply-pill bb-composer-quote", role: "region", "aria-label": `${copy("回复", "Reply to", lang)} ${author}`, "data-quoted-message-id": preview.targetId },
      h("span", { className: "sand-prompt-reply-pill__body", id },h("bdi", { className: "bb-quote-author" }, author), copy("：", ": ", lang),h("span", { className: "sand-reply-quote__label" }, quotedMessageLabel(preview, lang))),
      thumbnail ? h("img", { className: "bb-quote-thumb", src: thumbnail, alt: "", "aria-hidden": true, draggable: false }) : null,
      h("button", { type: "button", className: "sand-prompt-reply-pill__clear", "aria-label": copy("取消引用", "Cancel reply", lang), onMouseDown: (event: ReactAPI.MouseEvent) => event.preventDefault(), onClick: onClear }, "×"));
  }
  return { QuotedReply, ComposerQuote };
}
