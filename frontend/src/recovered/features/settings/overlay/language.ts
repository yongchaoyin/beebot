import { createContext, useContext } from "react";

export type SettingsLanguage = "en" | "zh";
export const SettingsLanguageContext = createContext<SettingsLanguage>("en");
export function useSettingsLanguage(language?: SettingsLanguage): SettingsLanguage {
  const inherited = useContext(SettingsLanguageContext);
  return language ?? inherited;
}

/** Only application-owned copy is passed here. Names, rules, endpoints, model
 * IDs and backend error details stay exactly as supplied by their owner. */
const CHINESE: Readonly<Record<string, string>> = {
  "BeeBot settings": "BeeBot 设置", "Settings sections": "设置分类", "Close": "关闭", "Dismiss": "关闭提示",
  "General": "通用", "Servers": "服务器", "Router": "路由", "Usage": "用量", "Updates": "更新",
  "Appearance": "外观", "Theme": "主题", "Follow System": "跟随系统", "Light": "浅色", "Dark": "深色", "Agent": "Bot",
  "Signing in": "正在登录", "Not signed in": "未登录", "Existing provider session": "已有服务会话",
  "Finish signing in from your browser": "请在浏览器中完成登录", "No external provider session": "没有外部服务会话",
  "Sign Out": "退出登录", "Cancel": "取消", "Disconnected": "未连接", "Copy email address": "复制邮箱地址",
  "Security Key": "安全密钥", "Use hardware security keys": "使用硬件安全密钥",
  "Allow BeeBot to use a security key (such as a YubiKey) connected to your computer. You’ll be asked to approve each use.": "允许 BeeBot 使用连接到本机的安全密钥（如 YubiKey）。每次使用都需要你确认。",
  "Security keys from BeeBot's computer aren't supported on this platform yet.": "此平台暂不支持从 BeeBot 的电脑使用安全密钥。",
  "Execution on Local Computer": "在本机执行", "Let the assistant open files and run tasks on your computer. Auto-review still checks everything first.": "允许 Bot 在本机打开文件并执行任务。自动审核仍会先检查每个操作。",
  "Your team’s admin allows at most": "团队管理员允许的最高权限为",
  "Always allow": "始终允许", "Ask every time": "每次询问", "Never allow": "从不允许",
  "Timezone": "时区", "Auto-detect": "自动检测",
  "Auto-review": "自动审核", "Auto-review Rules": "自动审核规则", "Auto-review rules": "自动审核规则",
  "BeeBot checks each action before it runs and asks you first when needed. Add rules to customize what it can do automatically.": "BeeBot 会在执行前检查每个操作，必要时先征求你的同意。添加规则可设定哪些操作能够自动执行。",
  "Write one short, natural-language rule for each action. \"Ask first\" takes priority if rules conflict.": "用简短的自然语言描述每条操作规则。规则冲突时，“先询问”优先。",
  "Auto-review rule draft": "自动审核规则草稿", "e.g. reply to emails for me": "例如：帮我回复邮件", "Rule behavior": "规则处理方式",
  "Allow automatically": "自动允许", "Ask first": "先询问", "Add Rule": "添加规则", "Action": "操作", "Behavior": "处理方式",
  "Save Rule": "保存规则", "Edit": "编辑", "Delete": "删除",
  "These rules apply only to you. Built-in safety checks always apply.": "这些规则仅对你生效。内置安全检查始终有效。",
  "Provider": "模型服务", "Route agent requests through": "Bot 请求使用的服务", "Router provider": "路由服务", "Account": "接入配置",
  "API key": "API 密钥", "Paste API key": "粘贴 API 密钥", "Base URL": "接口地址", "Model ID": "模型 ID", "Save vendor": "保存服务配置", "Saving…": "正在保存…", "Custom": "自定义",
  "Model usage": "模型用量", "Provider is not active": "服务尚未启用", "Choose a configured model provider in Router. No BeeBot subscription is required.": "请在“路由”中选择已配置的模型服务。无需订阅 BeeBot。",
  "Route through your OpenRouter account and selected model.": "使用你的 OpenRouter 账户和所选模型。",
  "OpenRouter usage and spend are managed in your OpenRouter account.": "用量和费用可在你的 OpenRouter 账户中查看。",
  "Use the OpenAI API with your own key.": "使用你自己的密钥连接 OpenAI API。",
  "OpenAI usage is billed to the API key you save.": "OpenAI 用量按你保存的 API 密钥计费。",
  "Use DeepSeek's OpenAI-compatible API.": "使用 DeepSeek 的 OpenAI 兼容 API。",
  "DeepSeek usage is billed to the API key you save.": "DeepSeek 用量按你保存的 API 密钥计费。",
  "Any OpenAI-compatible endpoint: base URL, API key, and model ID.": "连接任意 OpenAI 兼容接口：填写接口地址、API 密钥和模型 ID。",
  "Usage is billed by the provider behind the Base URL you save.": "用量由所填接口地址对应的服务商计费。",
  "Use Anthropic's Claude Code provider for agent requests.": "通过 Anthropic 的 Claude Code 处理 Bot 请求。",
  "Claude Code usage is managed by your Anthropic account and is not exposed as an in-app meter.": "Claude Code 用量由你的 Anthropic 账户管理，应用内不提供用量统计。",
  "Use OpenAI's Codex provider for agent requests.": "通过 OpenAI 的 Codex 处理 Bot 请求。",
  "Codex usage is managed by your OpenAI account and is not exposed as an in-app meter.": "Codex 用量由你的 OpenAI 账户管理，应用内不提供用量统计。",
  "BeeBot couldn't load update status. Check again to retry.": "无法读取 BeeBot 更新状态。请重新检查。",
  "Checking…": "正在检查…", "Check for Updates": "检查更新", "Update Track": "更新通道", "Stable": "稳定版", "Nightly": "每夜构建版", "Dogfood": "内部测试版",
  "Update access is managed by internal release-track policy.": "更新权限由内部发布通道策略管理。", "Open Statsig config": "打开 Statsig 配置",
  "Stable is the safe default. Other tracks ship new builds earlier and more often. Switching checks for updates right away.": "默认使用稳定版。其他通道更新更早、更频繁。切换后会立即检查更新。",
  "Auto-update when idle": "空闲时自动更新", "Automatically update your client while you're away.": "在你离开时自动更新客户端。", "Restart to Update": "重启以更新",
  "Egress": "网络出口", "Route egress through this desktop": "通过本机访问网络",
  "Route web traffic from BeeBot's computer out through this desktop instead of the cloud. Applies to new connections.": "让 BeeBot 电脑的网络请求通过本机访问互联网。仅对新连接生效。",
  "BeeBot's computer wasn't provisioned with the egress tunnel — start a new one to use this.": "BeeBot 的电脑未配置网络出口通道。需要创建新的电脑才能使用。",
  "Updates are disabled in dev builds": "开发版本不支持更新", "BeeBot Lab is a one-off test build and never auto-updates": "BeeBot Lab 是一次性测试版本，不会自动更新",
  "Updates aren't available on this platform": "此平台暂不支持更新", "Updates are disabled by SAND_DISABLE_UPDATES": "SAND_DISABLE_UPDATES 已禁用更新",
  "Checking for updates…": "正在检查更新…", "You're up to date": "已是最新版本", "unknown error": "未知错误",
  "Connecting to BeeBot's computer…": "正在连接 BeeBot 的电脑…", "Enabled, but not routing yet — waiting for BeeBot's computer to connect with egress enabled.": "已启用，等待 BeeBot 的电脑连接并启用网络出口。",
  "BeeBot's Computer": "BeeBot 的电脑", "Updates the computer your assistants share. Your files and logins stay. All assistants update together.": "更新所有 Bot 共用的电脑。文件和登录状态会保留，所有 Bot 会一起更新。",
  "Your computer is on the latest version": "电脑已是最新版本", "An agent is working. Updating now will interrupt it.": "有 Bot 正在工作。立即更新会中断它的任务。",
  "Update queued. It runs as soon as every agent is done.": "更新已排队，所有 Bot 完成后会立即进行。",
  "Further computer updates and resets are disabled for this session. Restart BeeBot after the computer is available again.": "本次会话已禁用后续电脑更新和重置。电脑恢复可用后，请重启 BeeBot。",
  "Start fresh if the computer gets stuck. It's rebuilt from your last saved snapshot, so very recent changes may be lost.": "电脑卡住时可以重置。将从最近保存的快照重建，因此近期更改可能丢失。",
  "Open an agent to reset the shared computer": "请先打开一个 Bot，再重置共享电脑", "Update BeeBot's Computer": "更新 BeeBot 的电脑", "Reset BeeBot's Computer": "重置 BeeBot 的电脑",
  "Update": "更新", "Click Again to Confirm": "再次点击确认", "Cancel Update": "取消更新", "Updating…": "正在更新…", "Resetting…": "正在重置…", "Reset": "重置", "Refresh Anyway": "仍然刷新",
  "Test the update flow even though the computer is already up to date": "即使电脑已是最新版本，也测试更新流程",
  "Server connections are not available in this build.": "此版本暂不支持服务器连接。", "Retry": "重试", "Loading settings…": "正在加载设置…",
  "Could not save the interface language. Your previous language has been restored.": "无法保存界面语言，已恢复原来的语言。"
};
export function settingsText(language: SettingsLanguage, text: string): string {
  return language === "zh" && Object.hasOwn(CHINESE, text) ? CHINESE[text]! : text;
}
export function useSettingsText(language?: SettingsLanguage): (text: string) => string {
  const current = useSettingsLanguage(language);
  return (text) => settingsText(current, text);
}
