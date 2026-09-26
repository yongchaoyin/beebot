import type { WindowShortcut } from "./window-shortcuts.js";
import {
  accountMenuCopy,
  beebotDocumentationUrl,
  BEEBOT_FEEDBACK_URL,
  parseUiLanguage,
  type UiLanguage,
} from "../shared/ui-language.js";

export type ApplicationMenuRole =
  | "close"
  | "copy"
  | "cut"
  | "delete"
  | "editMenu"
  | "front"
  | "help"
  | "hide"
  | "hideOthers"
  | "minimize"
  | "paste"
  | "pasteAndMatchStyle"
  | "quit"
  | "redo"
  | "selectAll"
  | "services"
  | "showSubstitutions"
  | "startSpeaking"
  | "stopSpeaking"
  | "togglefullscreen"
  | "toggleSmartDashes"
  | "toggleSmartQuotes"
  | "toggleTextReplacement"
  | "undo"
  | "unhide"
  | "windowMenu"
  | "zoom";

export interface ApplicationMenuItem {
  readonly label?: string;
  readonly role?: ApplicationMenuRole;
  readonly type?: "separator";
  readonly accelerator?: string;
  readonly click?: () => void;
  readonly submenu?: readonly ApplicationMenuItem[];
}

export interface ApplicationMenuElectronPort {
  readonly appName: string;
  readonly buildFromTemplate: (template: readonly ApplicationMenuItem[]) => unknown;
  readonly setApplicationMenu: (menu: unknown) => void;
  readonly openExternal: (url: string) => Promise<unknown>;
}

export interface ApplicationMenuOptions {
  readonly applyWindowShortcut: (shortcut: WindowShortcut) => void;
  readonly canUseDevTools: () => boolean;
  readonly emitOpenAbout: () => void;
  readonly uiLanguage?: UiLanguage;
  readonly platform?: NodeJS.Platform;
}

type RebuildFn = (language: UiLanguage) => void;
let rebuildHook: RebuildFn | null = null;

export function registerApplicationMenuRebuild(hook: RebuildFn): void {
  rebuildHook = hook;
}

export function requestApplicationMenuRebuild(language: UiLanguage): void {
  rebuildHook?.(language);
}

export function buildApplicationMenuTemplate(
  options: ApplicationMenuOptions,
  electron: Pick<ApplicationMenuElectronPort, "appName" | "openExternal">,
): ApplicationMenuItem[] {
  const isMac = (options.platform ?? process.platform) === "darwin";
  const zh = parseUiLanguage(options.uiLanguage) === "zh";
  const text = (en: string, cn: string): string => zh ? cn : en;
  const template: ApplicationMenuItem[] = [];
  if (isMac) {
    template.push({
      label: electron.appName,
      submenu: [
        { label: zh ? `关于 ${electron.appName}` : `About ${electron.appName}`, click: () => options.emitOpenAbout() },
        { type: "separator" },
        { role: "services", label: text("Services", "服务") },
        { type: "separator" },
        { role: "hide", label: zh ? `隐藏 ${electron.appName}` : `Hide ${electron.appName}` },
        { role: "hideOthers", label: text("Hide Others", "隐藏其他") },
        { role: "unhide", label: text("Show All", "显示全部") },
        { type: "separator" },
        { role: "quit", label: zh ? `退出 ${electron.appName}` : `Quit ${electron.appName}` },
      ],
    });
  }
  template.push({
    label: text("File", "文件"),
    submenu: [isMac ? { role: "close", label: text("Close Window", "关闭窗口") }
      : { role: "quit", label: text((options.platform ?? process.platform) === "win32" ? "Exit" : "Quit", "退出") }],
  });
  // Explicit copy follows BeeBot's saved UI language. Native roles retain
  // Electron's editing commands, selectors and platform accelerators.
  const editSubmenu: ApplicationMenuItem[] = [
    { role: "undo", label: text("Undo", "撤销") },
    { role: "redo", label: text("Redo", "重做") },
    { type: "separator" },
    { role: "cut", label: text("Cut", "剪切") },
    { role: "copy", label: text("Copy", "复制") },
    { role: "paste", label: text("Paste", "粘贴") },
  ];
  if (isMac) editSubmenu.push({ role: "pasteAndMatchStyle", label: text("Paste and Match Style", "粘贴并匹配样式") });
  editSubmenu.push({ role: "delete", label: text("Delete", "删除") });
  if (!isMac) editSubmenu.push({ type: "separator" });
  editSubmenu.push({ role: "selectAll", label: text("Select All", "全选") });
  if (isMac) editSubmenu.push(
    { type: "separator" },
    { label: text("Substitutions", "替换"), submenu: [
      { role: "showSubstitutions", label: text("Show Substitutions", "显示替换") },
      { type: "separator" },
      { role: "toggleSmartQuotes", label: text("Smart Quotes", "智能引号") },
      { role: "toggleSmartDashes", label: text("Smart Dashes", "智能破折号") },
      { role: "toggleTextReplacement", label: text("Text Replacement", "文本替换") },
    ] },
    { label: text("Speech", "语音"), submenu: [
      { role: "startSpeaking", label: text("Start Speaking", "开始朗读") },
      { role: "stopSpeaking", label: text("Stop Speaking", "停止朗读") },
    ] },
  );
  template.push({ role: "editMenu", label: text("Edit", "编辑"), submenu: editSubmenu });
  const viewSubmenu: ApplicationMenuItem[] = [
    {
      label: text("Reload", "重新加载"),
      accelerator: "CmdOrCtrl+R",
      click: () => options.applyWindowShortcut("reload"),
    },
  ];
  if (options.canUseDevTools()) {
    viewSubmenu.push(
      { type: "separator" },
      {
        label: text("Toggle Developer Tools", "切换开发者工具"),
        accelerator: isMac ? "Cmd+Alt+I" : "Ctrl+Shift+I",
        click: () => options.applyWindowShortcut("toggledevtools"),
      },
    );
  }
  viewSubmenu.push(
    { type: "separator" },
    isMac
      ? { role: "togglefullscreen", label: text("Toggle Full Screen", "切换全屏") }
      : {
          label: text("Toggle Full Screen", "切换全屏"),
          accelerator: "F11",
          click: () => options.applyWindowShortcut("fullscreen"),
        },
  );
  template.push({ label: text("View", "视图"), submenu: viewSubmenu });
  const windowSubmenu: ApplicationMenuItem[] = [
    { role: "minimize", label: text("Minimize", "最小化") },
    { role: "zoom", label: text("Zoom", "缩放") },
  ];
  if (isMac) windowSubmenu.push({ type: "separator" }, { role: "front", label: text("Bring All to Front", "全部置于前台") });
  else windowSubmenu.push({ role: "close", label: text("Close", "关闭") });
  template.push({ role: "windowMenu", label: text("Window", "窗口"), submenu: windowSubmenu });
  const language = parseUiLanguage(options.uiLanguage);
  const copy = accountMenuCopy(language);
  template.push({
    role: "help",
    label: text("Help", "帮助"),
    submenu: [
      {
        label: copy.documentation,
        click: () => {
          void electron.openExternal(beebotDocumentationUrl(language));
        },
      },
      {
        label: copy.feedback,
        click: () => {
          void electron.openExternal(BEEBOT_FEEDBACK_URL);
        },
      },
    ],
  });
  return template;
}

export function installApplicationMenu(
  options: ApplicationMenuOptions,
  electron: ApplicationMenuElectronPort,
): void {
  const template = buildApplicationMenuTemplate(options, electron);
  electron.setApplicationMenu(electron.buildFromTemplate(template));
}
