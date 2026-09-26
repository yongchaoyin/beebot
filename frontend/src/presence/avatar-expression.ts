import { avatarStateFromAgent, normalizeAvatarState, type AvatarActivity } from "./avatar-state.ts";

/** BeeBot-authored parametric artwork. No third-party contours, keyframes or
 * emotion data are embedded here. Expressions are presentation, not task truth. */
export const AVATAR_EXPRESSIONS = ["idle", "attentive", "thinking", "reading", "searching", "writing", "working", "handoff", "speaking", "waiting", "needs_user", "paused", "offline", "error", "happy", "puzzled"] as const;
export type AvatarExpression = typeof AVATAR_EXPRESSIONS[number];
export const EXPRESSION_LABELS: Record<AvatarExpression, readonly [string, string]> = {
  idle: ["At ease", "自然"], attentive: ["Attentive", "关注"], thinking: ["Thinking", "思考"],
  reading: ["Reading", "阅读"], searching: ["Searching", "检索"], writing: ["Writing", "整理内容"],
  working: ["Working", "执行工作"], handoff: ["Handing over", "交接"], speaking: ["Replying", "回复"],
  waiting: ["Waiting", "等待"], needs_user: ["Needs your input", "等待确认"], paused: ["Paused", "暂停"],
  offline: ["Disconnected", "连接未知"], error: ["Action failed", "异常"], happy: ["Smile", "微笑"], puzzled: ["Puzzled", "疑问"],
};
export function expressionFromState(state?: string): AvatarExpression {
  if ((AVATAR_EXPRESSIONS as readonly string[]).includes(state ?? "")) return state as AvatarExpression;
  return normalizeAvatarState(state);
}
/** Only inspect tool facts while actually running. Never parse model prose,
 * drafts or historic tool text to invent work, permission or task completion. */
export function avatarExpressionFromAgent(input: AvatarActivity): AvatarExpression {
  const state = avatarStateFromAgent(input);
  if (state !== "thinking") return state;
  const activity = input.currentActivity;
  if (!activity || typeof activity !== "object" || Array.isArray(activity)) return state;
  const { kind, verb, tool } = activity as { kind?: unknown; verb?: unknown; tool?: unknown };
  if (kind != null && kind !== "tool") return state;
  // The local Host and Group tracker publish named tool facts. Do not infer
  // writing from a shell command, filename, MCP name or an activity description.
  switch (tool) {
    case "SendToAgent": return "handoff";
    case "WebSearch": return "searching";
    case "Read": case "ExternalRead": case "WebFetch": return "reading";
    case "Shell": case "ExternalShell": case "AwaitShell": case "ExternalAwaitShell":
    case "Computer": case "GenerateImage": return "working";
  }
  if (kind === "tool") return state;
  // Retain the older renderer's explicit activity verbs, only when a typed
  // Host activity has not already supplied a different authoritative meaning.
  if (verb === "sending") return "handoff";
  if (verb === "searching") return "searching";
  if (verb === "reading" || verb === "browsing") return "reading";
  if (verb === "writing" || verb === "coding") return "writing";
  if (verb === "running-commands") return "working";
  return state;
}

export interface EyePose { width: number; height: number; bend: number; tilt: number; y: number }
export interface ExpressionPose { left: EyePose; right: EyePose; mouth: { width: number; bend: number; open: number }; lookX: number; lookY: number }
const eye = (height = 7, bend = 0, tilt = 0, y = 0): EyePose => ({ width: 4.6, height, bend, tilt, y });
const pose = (left = eye(), right = { ...left }, bend = 2.6, open = 1.5, lookX = 0, lookY = 0): ExpressionPose => ({ left, right, mouth: { width: 6.5, bend, open }, lookX, lookY });
const POSES: Record<AvatarExpression, ExpressionPose> = {
  idle: pose(), attentive: pose(eye(8.3), eye(8.3), 2, 1.4),
  thinking: pose(eye(5.6, .5, -.4), eye(6.2, .5, .4), .4, 1.4, .7, -.7),
  reading: pose(eye(5, .3), eye(5, .3), .5, 1.4, -.9, .8),
  searching: pose(eye(6.2, .3), eye(6.2, .3), .8, 1.4, -1, 0),
  writing: pose(eye(5.5), eye(5.5), 1.2, 1.4, .6, .7),
  working: pose(eye(5.4, .2, .45), eye(5.4, .2, -.45), .5, 1.4),
  handoff: pose(eye(6.8), eye(6.8), 2, 1.4, 1.1, 0),
  speaking: pose(eye(6.5, -.3), eye(6.5, -.3), 1.5, 3.4),
  waiting: pose(eye(4.8, .5), eye(4.8, .5), .3, 1.4),
  needs_user: pose(eye(8.2, .1, 0, -.4), eye(6.8, .1, 0, .2), .4, 2.1),
  paused: pose(eye(1.3, 1.1), eye(1.3, 1.1), .3, 1.4),
  offline: pose(eye(2.6), eye(2.6), 0, 1.4),
  error: pose(eye(5.8, 0, -.7), eye(5.8, 0, .7), -2.6, 1.4),
  happy: pose({ ...eye(1.5, -2.2), width: 6 }, { ...eye(1.5, -2.2), width: 6 }, 3.5, 1.6),
  puzzled: pose(eye(8, .2, -.6, -.7), eye(4.2, .2, .7, .7), -.3, 1.4),
};
export function expressionPose(expression: AvatarExpression): ExpressionPose {
  const p = Object.hasOwn(POSES,expression) ? POSES[expression] : POSES.idle;
  return { ...p, left: { ...p.left }, right: { ...p.right }, mouth: { ...p.mouth } };
}
export function mixPose(a: ExpressionPose, b: ExpressionPose, fraction: number): ExpressionPose {
  const t = bounded(fraction, 0, 1), lerp = (x: number, y: number) => x + (y - x) * t;
  const mixEye = (x: EyePose, y: EyePose): EyePose => ({ width: lerp(x.width,y.width), height: lerp(x.height,y.height), bend: lerp(x.bend,y.bend), tilt: lerp(x.tilt,y.tilt), y: lerp(x.y,y.y) });
  return { left: mixEye(a.left,b.left), right: mixEye(a.right,b.right), mouth: { width: lerp(a.mouth.width,b.mouth.width), bend: lerp(a.mouth.bend,b.mouth.bend), open: lerp(a.mouth.open,b.mouth.open) }, lookX: lerp(a.lookX,b.lookX), lookY: lerp(a.lookY,b.lookY) };
}
export function bounded(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : Math.max(min,Math.min(max,0)); }
/** Critically damped step response sampled in elapsed milliseconds. Unlike an
 * Euler integrator this transition is independent of frame frequency. */
export function settleProgress(elapsed: number, duration = 360): number {
  if (elapsed <= 0) return 0;
  if (elapsed >= duration) return 1;
  const x = 7 * elapsed / duration;
  return (1 - (1 + x) * Math.exp(-x)) / (1 - 8 * Math.exp(-7));
}
export function identitySeed(identity: string): number {
  let hash = 2166136261;
  for (const char of identity) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}
export function blinkDelay(identity: string, cycle: number): number { return 4800 + identitySeed(`${identity}:${cycle}`) % 4400; }

export interface FaceFit { eyeY: number; spread: number; mouthY: number; gazeX: number; gazeY: number }
export function faceFit(shape: string): FaceFit {
  const common = { eyeY: 29, spread: 8.3, mouthY: 41, gazeX: 1.8, gazeY: 1.2 };
  switch (shape) {
    case "wedge": return { ...common, eyeY: 33, spread: 7, mouthY: 43, gazeX: 1.3, gazeY: .8 };
    case "teardrop": return { ...common, eyeY: 34, spread: 7, mouthY: 44, gazeX: 1.2, gazeY: .7 };
    case "cloud": return { ...common, eyeY: 33, spread: 7.4, mouthY: 43, gazeX: 1.3, gazeY: .9 };
    case "tablet": return { ...common, spread: 7.2, mouthY: 40, gazeX: 1.4 };
    default: return common;
  }
}
const n = (value: number) => String(Math.round(value * 100) / 100);
/** Fixed-topology cubic capsule with independently bending lids. Geometry is
 * analytic and authored for BeeBot's 64-unit canvas, not a sampled eye ring. */
function capsule(cx: number, cy: number, width: number, height: number, bend: number, tilt: number): string {
  const x = bounded(width, 1, 9) / 2, y = bounded(height, .8, 10) / 2;
  const b = bounded(bend, -4, 4), a = bounded(tilt, -1.5, 1.5);
  const p = (dx: number, dy: number) => `${n(cx+dx)} ${n(cy+dy)}`;
  return `M${p(-x,a)}C${p(-x,-y+a)} ${p(-x*.55,-y+b)} ${p(0,-y+b)}C${p(x*.55,-y+b)} ${p(x,-y-a)} ${p(x,-a)}C${p(x,y-a)} ${p(x*.55,y+b)} ${p(0,y+b)}C${p(-x*.55,y+b)} ${p(-x,y+a)} ${p(-x,a)}Z`;
}
export function expressionPaths(p: ExpressionPose, shape: string, size = 32): { left: string; right: string; mouth: string; gaze: string } {
  const fit = faceFit(shape), emphasis = Number.isFinite(size) && size <= 40 ? 1.08 : 1;
  const draw = (e: EyePose, side: -1 | 1) => capsule(32 + side * fit.spread, fit.eyeY + e.y, e.width*emphasis, e.height*emphasis, e.bend, e.tilt);
  return { left: draw(p.left,-1), right: draw(p.right,1), mouth: capsule(32, fit.mouthY, p.mouth.width, p.mouth.open, p.mouth.bend, 0), gaze: `translate(${n(bounded(p.lookX,-fit.gazeX,fit.gazeX))} ${n(bounded(p.lookY,-fit.gazeY,fit.gazeY))})` };
}
export function paintExpression(svg: SVGSVGElement, p: ExpressionPose, shape: string, size: number): void {
  const paths = expressionPaths(p, shape, size);
  const eyes = svg.querySelectorAll("[data-part=eyes]");
  const write = (node: Element | null | undefined, key: string, value: string) => { if (node && node.getAttribute(key) !== value) node.setAttribute(key,value); };
  write(eyes[0],"d",paths.left); write(eyes[1],"d",paths.right);
  write(svg.querySelector("[data-part=mouth]"),"d",paths.mouth);
  write(svg.querySelector(".bb-character__gaze"),"transform",paths.gaze);
}
