import type * as ReactAPI from "react";

export type ProductConnectionSection = "router" | "servers";
export interface ProductConnectionsProps {
  language?: "en" | "zh";
  onOpenSection?(section: ProductConnectionSection): void;
}

/** Share the actual UI between source React and the pinned renderer's React.
 * Navigation only: no authentication, provider selection or secret writes. */
export function createProductConnections(React: typeof ReactAPI) {
  const subscribe = (listener: () => void) => {
    window.addEventListener("sand-ui-language-changed", listener);
    return () => window.removeEventListener("sand-ui-language-changed", listener);
  };
  const readLanguage = () => (window as Window & { __sandUiLanguage?: string }).__sandUiLanguage === "zh" ? "zh" : "en";
  return function ProductConnections({ language, onOpenSection }: ProductConnectionsProps) {
    const currentLanguage = React.useSyncExternalStore(subscribe, readLanguage, () => "en");
    const zh = (language ?? currentLanguage) === "zh";
    const open = (section: ProductConnectionSection) => {
      if (onOpenSection) onOpenSection(section);
      else window.dispatchEvent(new CustomEvent("sand-open-settings", { detail: { section } }));
    };
    const entry = (section: ProductConnectionSection, label: string, detail: string) => React.createElement("div", { className: "bb-product-connections__row", key: section },
      React.createElement("p", null, detail),
      React.createElement("button", { type: "button", "data-settings-target": section, onClick: () => open(section) }, label));
    return React.createElement("section", { className: "bb-product-connections", "aria-label": zh ? "模型与服务器" : "Models and servers" },
      React.createElement("h3", null, zh ? "模型与服务器" : "Models and servers"),
      entry("router", zh ? "配置模型 API" : "Configure model APIs", zh ? "本机 Bot 使用本机配置的模型，不需要额外的产品账户。" : "Local Bots use the models configured on this computer. No separate product account is required."),
      entry("servers", zh ? "管理服务器连接" : "Manage server connections", zh ? "远端 Bot 使用对应服务器的模型与权限；设备需要独立授权。" : "Remote Bots use their server's models and permissions. Each device is authorized separately."));
  };
}
