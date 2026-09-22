import type { WorkState } from "../honeyline/status";
/** Visual state only. Animation can never change work, approval or delivery. */
export type PresenceState = "idle" | "thinking" | "speaking" | "waiting" | "needs_user" | "paused" | "error" | "offline" | "unknown";
export function presenceFromWork(agent: WorkState): PresenceState {
  if (agent.connectionState === "offline") return "offline";
  if (agent.connectionState === "unknown" || agent.workPhase === "uncertain") return "unknown";
  if (agent.workPhase === "failed") return "error";
  if (agent.workPhase === "cancelled") return "paused";
  if (agent.workPhase === "succeeded") return "idle";
  if (agent.waiting) return agent.waiting.kind === "user" ? "needs_user" : "waiting";
  const awaiting = agent.awaitingUserResponse;
  if (awaiting === true || (awaiting != null && typeof awaiting === "object" && !Array.isArray(awaiting))) return "needs_user";
  if (agent.workPhase === "queued" || agent.workPhase === "review" || (typeof agent.waitingReason === "string" && agent.waitingReason.trim())) return "waiting";
  if (agent.isComposingMessage === true) return "speaking";
  // A stale activity object without an active execution flag is not work.
  return agent.isRunning === true || agent.workPhase === "running" ? "thinking" : "idle";
}
const LEGACY: Record<string, PresenceState> = {
  working: "thinking", searching: "thinking", loading: "thinking", writing: "thinking", progress: "thinking", radar: "thinking",
  sending: "thinking", receiving: "thinking", uploading: "thinking", dictating: "speaking", orbit: "waiting",
  sleeping: "paused", drowsy: "paused", "powering-down": "paused",
};
export function normalizePresence(state: string | undefined): PresenceState {
  if (["idle", "thinking", "speaking", "waiting", "needs_user", "paused", "error", "offline", "unknown"].includes(state ?? "")) return state as PresenceState;
  return state && Object.hasOwn(LEGACY, state) ? LEGACY[state] : "idle";
}
export const canAnimatePresence = (state: PresenceState): boolean => state === "idle" || state === "thinking" || state === "speaking";
export function gazeOffset(rect: Pick<DOMRect, "left" | "top" | "width" | "height">, target: { x: number; y: number }): { x: number; y: number } {
  if (![rect.left, rect.top, rect.width, rect.height, target.x, target.y].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  return { x: clamp((target.x - rect.left - rect.width / 2) / Math.max(40, rect.width)) * 2.4, y: clamp((target.y - rect.top - rect.height / 2) / Math.max(40, rect.height)) * 1.8 };
}
