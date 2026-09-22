import { avatarStateFromAgent, type AvatarActivity } from "./avatar-state.ts";
export interface WorkState extends AvatarActivity {}
export interface WorkLabel { state: "working" | "attention" | "waiting" | "offline" | "paused" | "error"; zh: string; en: string }
/** Presentation of real roster events only. No timer-driven claims or progress. */
export function workLabel(agent: WorkState): WorkLabel | null {
  const state = avatarStateFromAgent(agent);
  if (state === "offline") return { state: "offline", zh: "连接已断开", en: "Disconnected" };
  if (state === "error") return { state: "error", zh: "执行异常", en: "Action failed" };
  if (state === "paused") return { state: "paused", zh: "已暂停", en: "Paused" };
  if (state === "needs_user") return { state: "attention", zh: "需要你确认", en: "Needs your input" };
  if (state === "waiting") return { state: "waiting", zh: "正在等待", en: "Waiting" };
  if (state === "speaking") return { state: "working", zh: "正在回复", en: "Writing a reply" };
  if (state === "idle") return null;
  const activity = agent.currentActivity != null && typeof agent.currentActivity === "object" ? agent.currentActivity as Record<string, unknown> : {};
  const verb = typeof activity.verb === "string" ? activity.verb : "";
  const tool = typeof activity.tool === "string" ? activity.tool : "";
  let labels: [string, string] = ["正在处理", "Working"];
  if (["searching", "browsing", "reading"].includes(verb) || ["WebSearch", "WebFetch"].includes(tool)) labels = ["正在查阅资料", "Checking sources"];
  else if (["writing", "coding"].includes(verb)) labels = ["正在整理内容", "Preparing content"];
  else if (verb === "running-commands") labels = ["正在运行命令", "Running commands"];
  else if (verb === "sending" || tool === "SendToAgent") labels = ["正在交接", "Handing over"];
  else if (agent.isComposingMessage) labels = ["正在回复", "Writing a reply"];
  return { state: "working", zh: labels[0], en: labels[1] };
}
