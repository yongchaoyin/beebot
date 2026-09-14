export const UI_LANGUAGES = ["en", "zh"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];
export const DEFAULT_UI_LANGUAGE: UiLanguage = "en";

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === "en" || value === "zh";
}

export function parseUiLanguage(value: unknown): UiLanguage {
  if (value === "zh" || value === "zh-CN" || value === "zh-Hans" || value === "zh-TW") return "zh";
  return "en";
}

export interface CreateBotCopy {
  readonly title: string;
  readonly nameLabel: string;
  readonly namePlaceholder: string;
  readonly create: string;
  readonly close: string;
  readonly language: string;
  readonly newBot: string;
  readonly newGroup: string;
  readonly groupTitle: string;
  readonly groupName: string;
  readonly to: string;
  readonly searchBot: string;
  readonly vendor: string;
}

export function createBotCopy(language: UiLanguage): CreateBotCopy {
  if (language === "zh") {
    return {
      title: "新建 Bot",
      nameLabel: "名称",
      namePlaceholder: "New Bot",
      create: "开始使用",
      close: "关闭",
      language: "语言",
      newBot: "新建 Bot",
      newGroup: "新建群聊",
      groupTitle: "新建群聊",
      groupName: "群名称",
      to: "收件人：",
      searchBot: "搜索 Bot",
      vendor: "使用的 API",
    };
  }
  return {
    title: "New Bot",
    nameLabel: "Name",
    namePlaceholder: "New Bot",
    create: "Get started",
    close: "Close",
    language: "Language",
    newBot: "New Bot",
    newGroup: "New group chat",
    groupTitle: "New group chat",
    groupName: "Group name",
    to: "To:",
    searchBot: "Search Bot",
    vendor: "API",
  };
}

export const BOTFLY_FEEDBACK_URL = "https://github.com/yongchaoyin/botfly/issues/new";

export function botflyDocumentationUrl(language: UiLanguage): string {
  return language === "zh"
    ? "https://github.com/yongchaoyin/botfly/blob/main/README.zh.md"
    : "https://github.com/yongchaoyin/botfly/blob/main/README.md";
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
