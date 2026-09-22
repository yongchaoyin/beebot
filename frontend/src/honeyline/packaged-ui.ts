import type * as ReactAPI from "react";
export { createHoneylineCharacter } from "./character";
export { createCharacterSvg } from "./avatar-art";
import { workLabel, type WorkState } from "./status";

/** This adapter is injected into the native renderer alongside its existing
 * React instance. Keep native connections and preference persistence untouched. */
export function createHoneylineWorkStatus(React: typeof ReactAPI) {
  const subscribe = (listener: () => void) => {
    window.addEventListener("sand-ui-language-changed", listener);
    return () => window.removeEventListener("sand-ui-language-changed", listener);
  };
  const language = () => (window as Window & { __sandUiLanguage?: string }).__sandUiLanguage === "zh" ? "zh" : "en";
  return function WorkStatus({ agent }: { agent: WorkState }) {
    const lang = React.useSyncExternalStore(subscribe, language, () => "en");
    const label = workLabel(agent);
    return label == null ? null : React.createElement("small", { className: "bee-status", "data-state": label.state }, React.createElement("span", { className: "bee-status__label" }, lang === "zh" ? label.zh : label.en));
  };
}
