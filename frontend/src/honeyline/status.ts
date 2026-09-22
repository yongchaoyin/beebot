/** Facts supplied by the owning transport, never inferred from model prose. */
export type WorkPhase = "queued" | "running" | "review" | "failed" | "uncertain" | "succeeded" | "cancelled";
export type WorkWait = { kind: "user" | "agent" | "resource" | "review" | "unknown"; targetName?: string };
export interface WorkState {
  isRunning?: boolean;
  isComposingMessage?: boolean;
  awaitingUserResponse?: unknown;
  currentActivity?: unknown;
  /** Legacy explanatory text. It does not establish who owns the next action. */
  waitingReason?: string;
  waiting?: WorkWait;
  workPhase?: WorkPhase;
  connectionState?: "online" | "offline" | "unknown";
}
export interface WorkLabel { state: "working" | "attention" | "waiting" | "error" | "unknown"; zh: string; en: string }
const label = (state: WorkLabel["state"], zh: string, en: string): WorkLabel => ({ state, zh, en });
export function needsUserInput(agent: WorkState): boolean {
  const awaiting = agent.awaitingUserResponse;
  if (agent.waiting != null) return agent.waiting.kind === "user";
  return awaiting === true || (awaiting != null && typeof awaiting === "object" && !Array.isArray(awaiting));
}
/** Shared presentation contract for source headers and packaged adapters.
 * Connection loss takes precedence over stale cached execution flags.
 */
export function workLabel(agent: WorkState): WorkLabel | null {
  if (agent.connectionState === "offline") return label("unknown", "连接已断开，进度待确认", "Disconnected · progress unconfirmed");
  if (agent.connectionState === "unknown" || agent.workPhase === "uncertain") return label("unknown", "结果待核查", "Outcome needs verification");
  if (agent.workPhase === "failed") return label("error", "未能完成", "Could not finish");
  if (agent.workPhase === "succeeded" || agent.workPhase === "cancelled") return null;
  if (needsUserInput(agent)) return label("attention", "需要你确认", "Needs your input");
  if (agent.waiting?.kind === "review" || agent.workPhase === "review") return label("waiting", "已提交，待验收", "Submitted · awaiting review");
  if (agent.waiting?.kind === "agent") {
    const name = typeof agent.waiting.targetName === "string" ? agent.waiting.targetName.trim().slice(0, 60) : undefined;
    return label("waiting", name ? `等待 ${name}` : "等待同事", name ? `Waiting for ${name}` : "Waiting for a colleague");
  }
  if (agent.waiting?.kind === "resource" || agent.workPhase === "queued") return label("waiting", "已排队", "Queued");
  if (agent.waiting != null || (typeof agent.waitingReason === "string" && agent.waitingReason.trim())) return label("waiting", "等待中", "Waiting");
  if (!agent.isRunning && !agent.isComposingMessage && agent.workPhase !== "running") return null;
  if (agent.isComposingMessage) return label("working", "正在回复", "Writing a reply");
  const activity = agent.currentActivity != null && typeof agent.currentActivity === "object" ? agent.currentActivity as Record<string, unknown> : {};
  const verb = typeof activity.verb === "string" ? activity.verb : "";
  const tool = typeof activity.tool === "string" ? activity.tool : "";
  let labels: [string, string] = ["正在处理", "Working"];
  if (["searching", "browsing", "reading"].includes(verb) || ["WebSearch", "WebFetch"].includes(tool)) labels = ["正在查阅资料", "Checking sources"];
  else if (["writing", "coding"].includes(verb)) labels = ["正在整理内容", "Preparing content"];
  else if (verb === "running-commands") labels = ["正在运行命令", "Running commands"];
  else if (verb === "sending" || tool === "SendToAgent") labels = ["正在交接", "Handing over"];
  return label("working", labels[0], labels[1]);
}
