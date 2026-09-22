import type * as ReactAPI from "react";
import { getAvatarMotionPreference, setAvatarMotionPreference, subscribeAvatarMotionPreference, type AvatarMotionPreference } from "./avatar-motion";

/** Same control in source and native avatar editors. This preference only affects
 * presentation; it cannot pause an agent, hide approvals or change a task. */
export function createPresenceMotionSetting(React: typeof ReactAPI) {
  const h = React.createElement;
  const subscribe = (listener: () => void) => {
    if (typeof document === "undefined") return () => {};
    const stop = subscribeAvatarMotionPreference(document, listener);
    window.addEventListener("sand-ui-language-changed", listener);
    return () => { stop(); window.removeEventListener("sand-ui-language-changed", listener); };
  };
  const snapshot = () => `${getAvatarMotionPreference(document)}:${(window as Window & { __sandUiLanguage?: string }).__sandUiLanguage ?? document.documentElement.lang ?? "en"}`;
  return function MotionSetting() {
    const id = React.useId();
    const value = React.useSyncExternalStore(subscribe, snapshot, () => "auto:en");
    const [preference, language] = value.split(":");
    const zh = language?.startsWith("zh");
    return h("div", { className: "bb-motion-setting" },
      h("label", { htmlFor: id }, zh ? "头像动态" : "Avatar motion", h("small", null, zh ? "始终遵循系统减少动态效果设置" : "Always respects Reduce Motion")),
      h("select", { id, value: preference, onChange: (event: ReactAPI.ChangeEvent<HTMLSelectElement>) => setAvatarMotionPreference(event.currentTarget.ownerDocument, event.currentTarget.value as AvatarMotionPreference) },
        h("option", { value: "auto" }, zh ? "自然" : "Natural"),
        h("option", { value: "subtle" }, zh ? "轻微" : "Subtle"),
        h("option", { value: "off" }, zh ? "关闭" : "Off")));
  };
}
