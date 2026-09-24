import type * as ReactAPI from "react";
export { createPresenceCharacter } from "./character";
export { createCharacterSvg } from "./avatar-art";
import { workLabel, type WorkState } from "./status";

/** This adapter is injected into the native renderer alongside its existing
 * React instance. Keep native connections and preference persistence untouched. */
export function createPresenceWorkStatus(React: typeof ReactAPI) {
  const subscribe = (listener: () => void) => {
    window.addEventListener("sand-ui-language-changed", listener);
    return () => window.removeEventListener("sand-ui-language-changed", listener);
  };
  const language = () => (window as Window & { __sandUiLanguage?: string }).__sandUiLanguage === "zh" ? "zh" : "en";
  return function WorkStatus({ agent }: { agent: WorkState }) {
    const lang = React.useSyncExternalStore(subscribe, language, () => "en");
    const label = workLabel(agent);
    return label == null ? null : React.createElement("small", { className: "bb-status", "data-state": label.state, title: lang === "zh" ? label.zh : label.en }, React.createElement("span", { className: "bb-status__label" }, lang === "zh" ? label.zh : label.en));
  };
}

export { createPresenceMotionSetting } from "./motion-setting";
export { avatarStateFromAgent } from "./avatar-state";
export { COLORS as avatarColors, AVATAR_PALETTE as avatarPalette, characterVariant, AVATAR_SHAPES as avatarShapes } from "./avatar-art";
export { mountAvatarPicker } from "./avatar-picker";

export { installNativeWindowLayout } from "./window-layout";
