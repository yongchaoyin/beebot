export interface WorkState {
  isRunning?: boolean;
  isComposingMessage?: boolean;
  awaitingUserResponse?: unknown;
  currentActivity?: unknown;
  waitingReason?: string;
}
export interface WorkLabel { state: "working" | "attention"; zh: string; en: string }
/** Presentation of real roster events only. No timer-driven claims or progress. */
export function workLabel(agent: WorkState): WorkLabel | null {
  if ((agent.awaitingUserResponse != null && agent.awaitingUserResponse !== false) || (typeof agent.waitingReason === "string" && agent.waitingReason.trim().length > 0)) return { state: "attention", zh: "需要你确认", en: "Needs your input" };
  if (!agent.isRunning && !agent.isComposingMessage) return null;
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
