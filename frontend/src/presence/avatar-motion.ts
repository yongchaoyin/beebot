import { normalizeAvatarState, selectMotionCandidates, type AvatarState } from "./avatar-state.ts";

export type AvatarMotionPreference = "auto" | "subtle" | "off";
const KEY = "beebot.avatar-motion.v1";
const EVENT = "beebot-avatar-motion-change";
// Native and remote renderer chunks can evaluate this module separately. Share
// only presentation state on the actual Document, never Bot/account data.
const MOTION_STATE = Symbol.for("beebot.presence.avatar-motion.v2");
type MotionDocument = Document & { [MOTION_STATE]?: { preference?: AvatarMotionPreference; coordinator?: MotionCoordinator } };
const shared = (document: Document) => (document as MotionDocument)[MOTION_STATE] ??= {};
const preferences = {
  get: (document: Document) => shared(document).preference,
  set: (document: Document, value: AvatarMotionPreference) => { shared(document).preference = value; },
  delete: (document: Document) => { delete shared(document).preference; },
};
export function getAvatarMotionPreference(document: Document): AvatarMotionPreference {
  const cached = preferences.get(document);
  if (cached) return cached;
  try { const value = document.defaultView?.localStorage.getItem(KEY); return value === "off" || value === "subtle" ? value : "auto"; }
  catch { return "auto"; }
}
export function setAvatarMotionPreference(document: Document, preference: AvatarMotionPreference): void {
  if (!["auto", "subtle", "off"].includes(preference)) return;
  preferences.set(document, preference);
  try { document.defaultView?.localStorage.setItem(KEY, preference); } catch { /* Restricted storage must not disable the control. */ }
  const runtime = coordinators.get(document);
  if (runtime) runtime.preference = preference;
  const event = document.createEvent("Event"); event.initEvent(EVENT, false, false);
  document.defaultView?.dispatchEvent(event);
}
export function subscribeAvatarMotionPreference(document: Document, listener: () => void): () => void {
  const win = document.defaultView;
  const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) { preferences.delete(document); listener(); } };
  win?.addEventListener(EVENT, listener); win?.addEventListener("storage", storage);
  return () => { win?.removeEventListener(EVENT, listener); win?.removeEventListener("storage", storage); };
}
export interface AvatarMotionOptions { state?: string; paused?: boolean; priority?: number; followingPointer?: boolean; size?: number; identity?: string }
export interface AvatarMotionHandle { update(options: AvatarMotionOptions): void; gesture(kind: "nod" | "greet" | "ack"): void; destroy(): void }
interface Actor {
  id: number; svg: SVGSVGElement; state: AvatarState; paused: boolean; priority: number; size: number;
  visible: boolean; pointer: boolean; identity?: string; nextAt: number; animations: Set<Animation>;
}
const coordinators = {
  get: (document: Document) => shared(document).coordinator,
  set: (document: Document, value: MotionCoordinator) => { shared(document).coordinator = value; },
  delete: (document: Document) => { delete shared(document).coordinator; },
};
const INACTIVE = new Set<AvatarState>(["offline", "paused", "error", "waiting", "needs_user"]);
const priorityFromSurface = (svg: SVGSVGElement): number => svg.closest(".bb-avatar-preview,.sand-chat-header,[data-avatar-priority='primary']") ? 100 : svg.closest(".sand-message") ? 80 : 50;

/** One coordinator per document: one observer, one sparse clock and one pointer
 * listener. Animation never changes React state, transport, task status or focus. */
class MotionCoordinator {
  readonly document: Document;
  readonly actors = new Map<SVGSVGElement, Actor>();
  preference: AvatarMotionPreference;
  private readonly win: Window | null;
  private readonly reduced?: MediaQueryList;
  private readonly observer?: IntersectionObserver;
  private timer?: number;
  private frame?: number;
  private nextId = 1;
  private focused = true;
  private selected = new Set<number>();
  private stopPreference: () => void;
  constructor(document: Document) {
    this.document = document; this.win = document.defaultView;
    this.preference = getAvatarMotionPreference(document);
    this.focused = document.hasFocus?.() ?? true;
    this.reduced = this.win?.matchMedia?.("(prefers-reduced-motion: reduce)");
    const Observer = (this.win as (Window & { IntersectionObserver?: typeof IntersectionObserver }) | null)?.IntersectionObserver;
    if (Observer) this.observer = new Observer((entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) { const actor = this.actors.get(entry.target as SVGSVGElement); if (actor) actor.visible = entry.isIntersecting; }
      this.refresh();
    }, { threshold: 0.01 });
    this.stopPreference = subscribeAvatarMotionPreference(document, this.onPreference);
    this.reduced?.addEventListener("change", this.refresh);
    document.addEventListener("visibilitychange", this.refresh);
    this.win?.addEventListener("focus", this.onFocus);
    this.win?.addEventListener("blur", this.onBlur);
    document.addEventListener("pointermove", this.onPointer, { passive: true });
  }
  private onPreference = () => { this.preference = getAvatarMotionPreference(this.document); this.refresh(); };
  private onFocus = () => { this.focused = true; this.refresh(); };
  private onBlur = () => { this.focused = false; this.refresh(); };
  private allowed(): boolean { return this.preference !== "off" && !this.reduced?.matches && !this.document.hidden && this.focused; }
  private lowPower(): boolean {
    const nav = this.win?.navigator as (Navigator & { connection?: { saveData?: boolean } }) | undefined;
    return this.preference === "subtle" || nav?.connection?.saveData === true || (typeof nav?.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4);
  }
  private clear(actor: Actor): void {
    for (const animation of actor.animations) animation.cancel();
    actor.animations.clear();
    const face = actor.svg.querySelector<SVGGElement>(".bb-character__face");
    face?.style.removeProperty("transform");
  }
  private animate(actor: Actor, selector: string, frames: Keyframe[], duration: number): void {
    if (!this.allowed() || !actor.visible || actor.paused || actor.size < 24) return;
    const node = actor.svg.querySelector<SVGElement>(selector);
    if (!node?.animate || actor.animations.size >= 4) return;
    const animation = node.animate(frames, { duration, easing: "cubic-bezier(.22,.61,.36,1)", iterations: 1 });
    actor.animations.add(animation);
    animation.onfinish = () => { actor.animations.delete(animation); animation.cancel(); };
    animation.oncancel = () => { actor.animations.delete(animation); };
  }
  private blink(actor: Actor): void {
    this.animate(actor, ".bb-character__eyes", [{ transform: "scaleY(1)" }, { transform: "scaleY(.12)", offset: .45 }, { transform: "scaleY(1)" }], 190);
  }
  private perform(actor: Actor): void {
    this.blink(actor);
    if (this.preference === "subtle") return;
    if (actor.state === "speaking") {
      this.animate(actor, ".bb-character__body", [{ transform: "none" }, { transform: "translateY(-2.1px) rotate(-2.5deg)", offset: .4 }, { transform: "none" }], 560);
      this.animate(actor, ".bb-character__mouth", [{ transform: "scaleY(1)" }, { transform: "scaleY(1.9)", offset: .3 }, { transform: "scaleY(.8)", offset: .65 }, { transform: "scaleY(1)" }], 520);
    } else if (actor.state === "thinking") {
      this.animate(actor, ".bb-character__face", [{ transform: "none" }, { transform: "translate(1.4px,-.7px)", offset: .35 }, { transform: "translate(1.4px,-.7px)", offset: .7 }, { transform: "none" }], 1300);
    } else {
      this.animate(actor, ".bb-character__body", [{ transform: "none" }, { transform: "translateY(-1px) scaleY(1.02)", offset: .5 }, { transform: "none" }], 1800);
    }
  }
  refresh = (): void => {
    if (this.timer !== undefined) { this.win?.clearTimeout(this.timer); this.timer = undefined; }
    this.selected = new Set(this.allowed() ? selectMotionCandidates([...this.actors.values()], this.lowPower()) : []);
    for (const actor of this.actors.values()) {
      const active = this.selected.has(actor.id);
      actor.svg.dataset.motion = active ? this.preference : "still";
      if (!active) this.clear(actor);
    }
    if (this.selected.size) this.timer = this.win?.setTimeout(this.tick, 650);
  };
  private tick = (): void => {
    this.timer = undefined;
    if (!this.allowed()) { this.refresh(); return; }
    const now = this.win?.performance.now() ?? 0;
    for (const actor of this.actors.values()) {
      if (!this.selected.has(actor.id) || now < actor.nextAt) continue;
      this.perform(actor);
      // Stagger by stable identity so coworkers never blink in synchrony.
      actor.nextAt = now + (actor.state === "speaking" ? 2400 : actor.state === "thinking" ? 4200 : 7000) + (actor.id % 7) * 173;
    }
    if (this.selected.size) this.timer = this.win?.setTimeout(this.tick, 650);
  };
  private onPointer = (event: PointerEvent): void => {
    if (event.pointerType === "touch" || !this.allowed() || this.lowPower() || this.frame !== undefined) return;
    const { clientX: x, clientY: y } = event;
    this.frame = this.win?.requestAnimationFrame(() => {
      this.frame = undefined;
      for (const actor of this.actors.values()) {
        if (!actor.pointer || !actor.visible || actor.paused || !this.selected.has(actor.id)) continue;
        const face = actor.svg.querySelector<SVGGElement>(".bb-character__face");
        const box = actor.svg.getBoundingClientRect();
        const near = x >= box.left - 28 && x <= box.right + 28 && y >= box.top - 28 && y <= box.bottom + 28;
        if (face) face.style.transform = near ? `translate(${Math.max(-1.8, Math.min(1.8, (x - box.left - box.width / 2) / 16))}px,${Math.max(-1.3, Math.min(1.3, (y - box.top - box.height / 2) / 20))}px)` : "";
      }
    });
  };
  register(svg: SVGSVGElement, options: AvatarMotionOptions): AvatarMotionHandle {
    const actor: Actor = { id: this.nextId++, svg, state: "idle", paused: false, priority: 50, size: 32, visible: !this.observer, pointer: false, nextAt: 0, animations: new Set() };
    this.actors.set(svg, actor); this.observer?.observe(svg);
    let destroyed = false;
    const update = (value: AvatarMotionOptions) => {
      if (destroyed) return;
      const previous = actor.state;
      actor.state = normalizeAvatarState(value.state); actor.paused = value.paused === true;
      actor.size = value.size ?? (svg.getBoundingClientRect().width || 32);
      actor.priority = value.priority ?? priorityFromSurface(svg); actor.pointer = value.followingPointer === true; actor.identity = value.identity;
      svg.dataset.state = actor.state;
      if (previous !== actor.state) { this.clear(actor); actor.nextAt = 0; }
      this.refresh();
      // Requests and errors remain static and legible. They never shake or flash.
    };
    update(options);
    return { update, gesture: kind => {
      this.gesture(actor, kind);
    }, destroy: () => {
      if (destroyed) return; destroyed = true;
      this.clear(actor); this.observer?.unobserve(svg); this.actors.delete(svg);
      if (this.actors.size) this.refresh(); else this.dispose();
    } };
  }
  gesture(actor: Actor, kind: "nod" | "greet" | "ack"): void {
    if (INACTIVE.has(actor.state) || !this.selected.has(actor.id)) return;
    this.clear(actor);
    this.animate(actor, ".bb-character__body", [{ transform: "none" }, { transform: kind === "greet" ? "rotate(-5deg)" : kind === "ack" ? "scale(1.035)" : "translateY(1.4px) scaleY(.97)", offset: .45 }, { transform: "none" }], 350);
    actor.nextAt = (this.win?.performance.now() ?? 0) + 2600;
  }
  gestureIdentity(identity: string, kind: "nod" | "greet" | "ack"): void {
    const actor = [...this.actors.values()].filter(a => a.identity === identity && this.selected.has(a.id)).sort((a,b) => b.priority-a.priority)[0];
    if (actor) this.gesture(actor, kind);
  }
  private dispose(): void {
    if (this.timer !== undefined) this.win?.clearTimeout(this.timer);
    if (this.frame !== undefined) this.win?.cancelAnimationFrame(this.frame);
    this.observer?.disconnect(); this.stopPreference();
    this.reduced?.removeEventListener("change", this.refresh);
    this.document.removeEventListener("visibilitychange", this.refresh);
    this.document.removeEventListener("pointermove", this.onPointer);
    this.win?.removeEventListener("focus", this.onFocus); this.win?.removeEventListener("blur", this.onBlur);
    coordinators.delete(this.document);
  }
}
export function registerAvatarMotion(svg: SVGSVGElement, options: AvatarMotionOptions): AvatarMotionHandle {
  let coordinator = coordinators.get(svg.ownerDocument);
  if (!coordinator) { coordinator = new MotionCoordinator(svg.ownerDocument); coordinators.set(svg.ownerDocument, coordinator); }
  return coordinator.register(svg, options);
}

export function gestureAvatarIdentity(document: Document, identity: string, kind: "nod" | "greet" | "ack"): void { coordinators.get(document)?.gestureIdentity(identity, kind); }
