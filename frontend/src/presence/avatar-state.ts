/** Avatar state is a projection, never a source of task/transport truth. */
export type AvatarState = "idle" | "thinking" | "speaking" | "needs_user" | "waiting" | "paused" | "error" | "offline";
export interface AvatarActivity {
  connectionState?: "online" | "offline" | "unknown";
  workPhase?: "queued" | "running" | "review" | "failed" | "uncertain" | "succeeded" | "cancelled";
  waiting?: {kind: "user" | "agent" | "resource" | "review" | "unknown"; targetName?: string};
  isRunning?: boolean;
  isComposingMessage?: boolean;
  awaitingUserResponse?: unknown;
  waitingReason?: string;
  currentActivity?: unknown;
  isTransportDown?: boolean;
  isPaused?: boolean;
  hasError?: boolean;
}
export const requiresUser = (value: unknown): boolean => value === true || (value != null && typeof value === "object" && !Array.isArray(value));
export function avatarStateFromAgent(input: AvatarActivity): AvatarState {
  // Disconnection is not task failure, and stale tool data is not current work.
  if (input.isTransportDown === true || input.connectionState === "offline" || input.connectionState === "unknown" || input.workPhase === "uncertain") return "offline";
  if (input.hasError === true || input.workPhase === "failed") return "error";
  if (input.workPhase === "succeeded" || input.workPhase === "cancelled") return "idle";
  if (input.waiting != null) return input.waiting.kind === "user" ? "needs_user" : "waiting";
  if (input.workPhase === "queued" || input.workPhase === "review") return "waiting";
  if (requiresUser(input.awaitingUserResponse)) return "needs_user";
  if (input.isPaused === true) return "paused";
  if (typeof input.waitingReason === "string" && input.waitingReason.trim()) return "waiting";
  if (input.isComposingMessage === true) return "speaking";
  return (input.isRunning === true || input.workPhase === "running") ? "thinking" : "idle";
}
export function normalizeAvatarState(state: string | undefined): AvatarState {
  switch (state) {
    case "offline": case "error": case "needs_user": case "waiting": case "paused": case "speaking": case "thinking": return state;
    case "working": case "searching": case "loading": case "sending": case "progress": case "radar": case "writing": case "uploading": return "thinking";
    case "orbit": return "waiting";
    case "notifying": case "alerting": return "needs_user";
    case "sleeping": case "drowsy": case "powering-down": return "paused";
    case "dictating": return "speaking";
    default: return "idle";
  }
}
export interface MotionCandidate { id: number; state: AvatarState; priority: number; visible: boolean; paused: boolean; size: number }
/** A window spends at most two activity slots and one quiet idle slot. The same
 * actor is stable across recomputations; candidate insertion never fabricates work. */
export function selectMotionCandidates(candidates: readonly MotionCandidate[], lowPower = false): number[] {
  const eligible = candidates.filter(c => c.visible && !c.paused && c.size >= 24 && !["paused", "offline", "error", "waiting", "needs_user"].includes(c.state));
  const rank = (c: MotionCandidate) => c.priority + (c.state === "speaking" ? 30 : c.state === "thinking" ? 10 : 0);
  eligible.sort((a, b) => rank(b) - rank(a) || a.id - b.id);
  const active = eligible.filter(c => c.state !== "idle").slice(0, lowPower ? 1 : 2);
  // Idle life belongs to a primary/header or preview, not the entire sidebar.
  const idle = lowPower || active.length ? [] : eligible.filter(c => c.state === "idle" && c.priority >= 80).slice(0, 1);
  return [...active, ...idle].map(c => c.id);
}
