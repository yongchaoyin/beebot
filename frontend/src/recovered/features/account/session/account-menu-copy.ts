export type UiLanguage = "en" | "zh";

export const BEEBOT_FEEDBACK_URL = "https://github.com/yongchaoyin/beebot/issues/new";

export function beebotDocumentationUrl(language: UiLanguage): string {
  return language === "zh"
    ? "https://github.com/yongchaoyin/beebot/blob/main/README.zh.md"
    : "https://github.com/yongchaoyin/beebot/blob/main/README.md";
}

export interface AccountMenuCopy {
  readonly settings: string;
  readonly configureAi: string;
  readonly about: string;
  readonly documentation: string;
  readonly feedback: string;
  readonly openFailed: string;
}

export function accountMenuCopy(language: UiLanguage): AccountMenuCopy {
  if (language === "zh") {
    return {
      settings: "设置",
      configureAi: "配置 AI",
      about: "关于",
      documentation: "文档",
      feedback: "反馈",
      openFailed: "无法打开该链接。",
    };
  }
  return {
    settings: "Settings",
    configureAi: "Configure AI",
    about: "About",
    documentation: "Documentation",
    feedback: "Feedback",
    openFailed: "Couldn't open that link.",
  };
}

export const accountMenuActions = () =>
  ["settings", "configureAi", "about", "documentation", "feedback"] as const;
