import type * as ReactAPI from "react";

type Notice = { kind: "notice"; id: string; text: string; code?: string; replyTo?: string };

/** Presentation only: retained transcript text/IDs are never edited or discarded. */
export function conversationNoticeSummary(entry: Notice, language: "zh" | "en"): string | null {
  if (entry.kind !== "notice" || entry.code !== "delivery_failed") return null;
  return language === "zh"
    ? "处理失败，消息已保留；继续前请核查已有操作。"
    : "Handling failed. Message retained; review prior actions before continuing.";
}

/** Reuse the renderer's React instance; known system notices are compact, not hidden. */
export function createConversationNotice(React: typeof ReactAPI) {
  const subscribe = (listener: () => void) => {
    window.addEventListener("sand-ui-language-changed", listener);
    return () => window.removeEventListener("sand-ui-language-changed", listener);
  };
  const language = (): "zh" | "en" => (window as Window & { __sandUiLanguage?: string }).__sandUiLanguage === "zh" ? "zh" : "en";
  return function ConversationNotice({ entry, original }: { entry: Notice; original?: ReactAPI.ReactNode }) {
    const lang = React.useSyncExternalStore<"zh" | "en">(subscribe, language, () => "en");
    const summary = conversationNoticeSummary(entry, lang);
    if (summary == null) return original ?? React.createElement("div", { className: "sand-notice" }, entry.text);
    return React.createElement("details", { className: "sand-notice bb-delivery-notice", "data-bb-feedback-kind": entry.code, "data-reply-to": entry.replyTo },
      React.createElement("summary", null, summary),
      React.createElement("div", { className: "bb-delivery-notice__detail" }, entry.text));
  };
}
