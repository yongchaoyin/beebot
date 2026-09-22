import { canAnimatePresence, gazeOffset, type PresenceState } from "./state";

export type AvatarSurface = "auto" | "header" | "sidebar" | "message" | "onboarding";
export interface MotionOptions {
  state: PresenceState;
  paused: boolean;
  emphasis?: boolean;
  following?: boolean;
  surface?: AvatarSurface;
  identity?: string;
}
export interface MotionCandidate {
  id: number;
  identity?: string;
  priority: number;
  visible: boolean;
  paused: boolean;
  state: PresenceState;
}
/** At most two live portraits, and only one animated occurrence per colleague. */
export function selectMotionCandidates<T extends MotionCandidate>(items: readonly T[], limit = 2): T[] {
  const result: T[] = [], identities = new Set<string>();
  for (const item of [...items].filter(item => item.visible && !item.paused && item.priority > 0 && canAnimatePresence(item.state)).sort((a, b) => b.priority - a.priority || a.id - b.id)) {
    if (result.length >= Math.max(0, Math.min(2, limit))) break;
    if (item.identity && identities.has(item.identity)) continue;
    result.push(item);
    if (item.identity) identities.add(item.identity);
  }
  return result;
}
export interface AvatarMotionHandle {
  update(options: MotionOptions): void;
  look(target: { x: number; y: number } | null): void;
  gesture(action: "spin" | "bounce" | "burst"): void;
  dispose(): void;
}
interface RecordEntry extends MotionCandidate {
  node: SVGSVGElement;
  options: MotionOptions;
  hovered: boolean;
  nextBeat: number;
  target: { x: number; y: number } | null;
  animations: Map<string, Animation>;
  enter: () => void;
  leave: () => void;
}
// Native and remote/source UI are separately bundled. A versioned document slot
// gives them ONE coordinator without sharing a React runtime or account data.
const COORDINATOR = Symbol.for("beebot.presence.motion.v1");
type MotionDocument = Document & { [COORDINATOR]?: MotionCoordinator };
const HISTORICAL = ".sand-transcript-row:not([data-presence-live='true']), .sand-group-avatar";

/** One observer, one timer and one pointer listener per document. Never a
 * requestAnimationFrame loop per message, never a transport or chat-store write. */
class MotionCoordinator {
  private readonly entries = new Map<SVGSVGElement, RecordEntry>();
  private readonly active = new Set<RecordEntry>();
  private sequence = 0;
  private timer: number | undefined;
  private pointerFrame: number | undefined;
  private pointer: { x: number; y: number } | null = null;
  private focused: boolean;
  private readonly reduced: MediaQueryList;
  private readonly observer: IntersectionObserver | null;
  private readonly view: Window;

  constructor(private readonly document: Document) {
    this.view = document.defaultView!;
    this.focused = document.hasFocus();
    this.reduced = this.view.matchMedia("(prefers-reduced-motion: reduce)");
    const Observer = (this.view as Window & typeof globalThis).IntersectionObserver;
    this.observer = Observer ? new Observer(entries => {
      for (const entry of entries) {
        const record = this.entries.get(entry.target as SVGSVGElement);
        if (record) record.visible = entry.isIntersecting && entry.intersectionRatio > 0;
      }
      this.reconcile();
    }) : null;
    document.addEventListener("visibilitychange", this.visibility);
    this.view.addEventListener("focus", this.focus);
    this.view.addEventListener("blur", this.blur);
    this.view.addEventListener("pointermove", this.pointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", this.pointerLeave);
    this.view.addEventListener("beebot-motion-changed", this.visibility);
    this.reduced.addEventListener("change", this.visibility);
  }
  private allowed = () => !this.document.hidden && this.focused && !this.reduced.matches && this.document.documentElement.dataset.beebotMotion !== "off";
  private visibility = () => this.reconcile();
  private focus = () => { this.focused = true; this.reconcile(); };
  private blur = () => { this.focused = false; this.reconcile(); };
  private pointerLeave = () => {
    this.pointer = null;
    for (const entry of this.active) this.setGaze(entry, null);
  };
  private pointerMove = (event: PointerEvent) => {
    if (!this.allowed() || event.pointerType === "touch") return;
    if (![...this.active].some(entry => entry.options.following || entry.hovered)) return;
    this.pointer = { x: event.clientX, y: event.clientY };
    if (this.pointerFrame !== undefined) return;
    this.pointerFrame = this.view.requestAnimationFrame(() => {
      this.pointerFrame = undefined;
      for (const entry of this.active) if (entry.options.following || entry.hovered) this.setGaze(entry, this.pointer);
    });
  };
  private priority(entry: RecordEntry): number {
    const { node, options } = entry;
    if (options.paused || node.closest(HISTORICAL)) return 0;
    if (entry.hovered) return 90;
    const surface = options.surface ?? "auto";
    if (surface === "message") return options.state === "speaking" ? 100 : 0;
    if (surface === "header" || node.closest(".sand-chat-header")) return options.state === "speaking" ? 100 : 70;
    if (surface === "onboarding" || (Number(node.getAttribute("width")) >= 64 && surface === "auto")) return 50;
    const item = node.closest(".sand-agent-item");
    if (item) return item.matches("[aria-current='page'],[aria-current='true'],[aria-selected='true'],[data-active='true'],[data-selected='true']") ? 30 : 0;
    return options.emphasis ? 40 : 0;
  }
  private stop(entry: RecordEntry) {
    for (const animation of entry.animations.values()) animation.cancel();
    entry.animations.clear();
    entry.node.dataset.motion = "off";
    this.setGaze(entry, null);
  }
  private animate(entry: RecordEntry, part: string, frames: Keyframe[], duration: number) {
    if (!this.active.has(entry) || !this.allowed()) return;
    const node = entry.node.querySelector<SVGGElement>(`[data-motion-part="${part}"]`);
    if (!node?.animate) return;
    entry.animations.get(part)?.cancel();
    const animation = node.animate(frames, { duration, easing: "cubic-bezier(.2,.8,.2,1)" });
    entry.animations.set(part, animation);
    const clear = () => { if (entry.animations.get(part) === animation) entry.animations.delete(part); };
    animation.onfinish = clear; animation.oncancel = clear;
  }
  private beat(entry: RecordEntry) {
    if (entry.state === "speaking") {
      this.animate(entry, "mouth", [{ transform: "scaleY(1)" }, { transform: "scaleY(1.6)" }, { transform: "scaleY(.85)" }, { transform: "scaleY(1)" }], 420);
    } else {
      this.animate(entry, "blink", [{ transform: "scaleY(1)" }, { transform: "scaleY(.12)", offset: .45 }, { transform: "scaleY(1)" }], 170);
      if (entry.state === "thinking") this.animate(entry, "head", [{ transform: "none" }, { transform: "translateY(-.65px) rotate(-1.5deg)" }, { transform: "none" }], 1100);
    }
    const stagger = (entry.id * 577) % 2100;
    entry.nextBeat = Date.now() + (entry.state === "speaking" ? 1300 + stagger % 600 : 5400 + stagger);
  }
  private schedule() {
    if (this.timer !== undefined) this.view.clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.active.size || !this.allowed()) return;
    const next = Math.min(...[...this.active].map(entry => entry.nextBeat));
    this.timer = this.view.setTimeout(() => {
      this.timer = undefined;
      for (const entry of this.active) if (entry.nextBeat <= Date.now()) this.beat(entry);
      this.schedule();
    }, Math.max(50, next - Date.now()));
  }
  private reconcile() {
    for (const entry of this.entries.values()) {
      entry.priority = this.priority(entry);
      // When IO is unavailable, fail closed on zero-sized/offscreen content.
      if (!this.observer) {
        const rect = entry.node.getBoundingClientRect();
        entry.visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < this.view.innerHeight && rect.left < this.view.innerWidth;
      }
    }
    const selected = new Set(this.allowed() ? selectMotionCandidates([...this.entries.values()]) : []);
    for (const entry of this.active) if (!selected.has(entry)) { this.stop(entry); this.active.delete(entry); }
    for (const entry of selected) if (!this.active.has(entry)) {
      this.active.add(entry); entry.node.dataset.motion = "active";
      entry.nextBeat = Date.now() + (entry.state === "speaking" ? 160 : 2200 + (entry.id * 577) % 1900);
      if (entry.target) this.setGaze(entry, entry.target);
    }
    if (!this.active.size && this.pointerFrame !== undefined) { this.view.cancelAnimationFrame(this.pointerFrame); this.pointerFrame = undefined; }
    this.schedule();
  }
  private setGaze(entry: RecordEntry, target: { x: number; y: number } | null) {
    const gaze = entry.node.querySelector<SVGGElement>('[data-motion-part="gaze"]');
    if (!gaze) return;
    const offset = target && this.active.has(entry) && this.allowed() ? gazeOffset(entry.node.getBoundingClientRect(), target) : { x: 0, y: 0 };
    if (!offset.x && !offset.y) gaze.style.removeProperty("transform");
    else gaze.style.transform = `translate(${offset.x.toFixed(2)}px,${offset.y.toFixed(2)}px)`;
  }
  register(node: SVGSVGElement, options: MotionOptions): AvatarMotionHandle {
    const entry: RecordEntry = { id: ++this.sequence, node, options, state: options.state, identity: options.identity, paused: options.paused, priority: 0, visible: false, hovered: false, nextBeat: 0, target: null, animations: new Map(), enter: () => {}, leave: () => {} };
    entry.enter = () => { entry.hovered = true; this.reconcile(); };
    entry.leave = () => { entry.hovered = false; this.setGaze(entry, null); this.reconcile(); };
    node.addEventListener("pointerenter", entry.enter); node.addEventListener("pointerleave", entry.leave);
    this.entries.set(node, entry); this.observer?.observe(node); this.reconcile();
    let disposed = false;
    return {
      update: next => {
        if (disposed) return;
        const changed = entry.state !== next.state;
        entry.options = next; entry.state = next.state; entry.paused = next.paused; entry.identity = next.identity;
        if (changed) this.stop(entry);
        this.reconcile();
        // State change acknowledges a fact; no timers invent work progression.
        if (changed && this.active.has(entry)) {
          node.dataset.motion = "active";
          entry.nextBeat = Date.now() + (next.state === "speaking" ? 180 : 5000);
          this.animate(entry, "head", [{ transform: "none" }, { transform: "translateY(-1px) rotate(-2deg)" }, { transform: "none" }], 260);
          this.schedule();
        }
      },
      look: target => { if (!disposed) { entry.target = target; this.setGaze(entry, target); } },
      gesture: action => {
        if (disposed) return;
        const middle = action === "spin" ? "rotate(-7deg)" : action === "bounce" ? "translateY(-2px)" : "scale(1.035)";
        if (this.active.has(entry)) this.animate(entry, "head", [{ transform: "none" }, { transform: middle }, { transform: "none" }], 260);
        else if (entry.identity) this.gestureByIdentity(entry.identity, action);
      },
      dispose: () => {
        if (disposed) return;
        disposed = true; this.stop(entry); this.active.delete(entry); this.entries.delete(node); this.observer?.unobserve(node);
        node.removeEventListener("pointerenter", entry.enter); node.removeEventListener("pointerleave", entry.leave);
        if (this.entries.size) this.reconcile(); else this.dispose();
      },
    };
  }
  gestureByIdentity(identity: string, action: "spin" | "bounce" | "burst"): void {
    const target = [...this.active].find(entry => entry.identity === identity);
    if (!target) return;
    const middle = action === "spin" ? "rotate(-7deg)" : action === "bounce" ? "translateY(-2px)" : "scale(1.035)";
    this.animate(target, "head", [{ transform: "none" }, { transform: middle }, { transform: "none" }], 260);
  }
  private dispose() {
    if (this.timer !== undefined) this.view.clearTimeout(this.timer);
    if (this.pointerFrame !== undefined) this.view.cancelAnimationFrame(this.pointerFrame);
    this.observer?.disconnect();
    this.document.removeEventListener("visibilitychange", this.visibility);
    this.view.removeEventListener("focus", this.focus); this.view.removeEventListener("blur", this.blur);
    this.view.removeEventListener("pointermove", this.pointerMove);
    this.document.documentElement.removeEventListener("pointerleave", this.pointerLeave);
    this.view.removeEventListener("beebot-motion-changed", this.visibility);
    this.reduced.removeEventListener("change", this.visibility);
    delete (this.document as MotionDocument)[COORDINATOR];
  }
}
export function registerAvatarMotion(node: SVGSVGElement, options: MotionOptions): AvatarMotionHandle {
  const document = node.ownerDocument;
  if (!document.defaultView?.matchMedia) return { update() {}, look() {}, gesture() {}, dispose() {} };
  let coordinator = (document as MotionDocument)[COORDINATOR];
  if (!coordinator) { coordinator = new MotionCoordinator(document); Object.defineProperty(document, COORDINATOR, { value: coordinator, configurable: true }); }
  return coordinator.register(node, options);
}

/** Legacy native gesture commands remain display-only and bounded. */
export function gestureVisibleAvatar(document: Document, identity: string | undefined, action: "spin" | "bounce" | "burst"): void {
  if (identity) (document as MotionDocument)[COORDINATOR]?.gestureByIdentity(identity, action);
}
