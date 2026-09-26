import { AVATAR_SHAPES } from "./avatar-shapes.ts";
import { expressionFromState, expressionPose, paintExpression, mixPose, settleProgress, blinkDelay, identitySeed, faceFit, bounded, type AvatarExpression, type ExpressionPose } from "./avatar-expression.ts";
import { normalizeAvatarState, selectMotionCandidates, type AvatarState } from "./avatar-state.ts";
import { activityChoreography, activityDelay } from "./avatar-choreography.ts";

export type AvatarMotionPreference = "auto" | "subtle" | "off";
const KEY = "beebot.avatar-motion.v1";
const EVENT = "beebot-avatar-motion-change";
// Native and remote renderer chunks can evaluate this module separately. Share
// only presentation state on the actual Document, never Bot/account data.
const MOTION_STATE = Symbol.for("beebot.presence.avatar-motion.v3");
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
export interface AvatarMotionOptions {
  state?: string; paused?: boolean; priority?: number; followingPointer?: boolean; size?: number; identity?: string; shape?: string;
}
export type AvatarGesture = "nod" | "greet" | "ack" | "celebrate";
export interface AvatarMotionHandle { update(options: AvatarMotionOptions): void; gesture(kind: AvatarGesture): void; reset(): void; destroy(): void }
interface Actor {
  id: number; svg: SVGSVGElement; state: AvatarState; paused: boolean; priority: number; size: number;
  visible: boolean; pointer: boolean; identity?: string; nextBlinkAt: number; nextActivityAt: number; animations: Map<SVGElement, Animation>;
  expression: AvatarExpression; shape: string; pose: ExpressionPose; blinkCycle: number; activityCycle: number;
  transition?: { from: ExpressionPose; to: ExpressionPose; start: number; duration: number };
  scheduledPoses: {at: number; pose: ExpressionPose; duration: number}[];
  gaze: { x: number; y: number; tx: number; ty: number };
}
const coordinators = {
  get: (document: Document) => shared(document).coordinator,
  set: (document: Document, value: MotionCoordinator) => { shared(document).coordinator = value; },
  delete: (document: Document) => { delete shared(document).coordinator; },
};
const INACTIVE = new Set<AvatarState>(["offline", "paused", "error", "waiting", "needs_user"]);
const priorityFromSurface = (svg: SVGSVGElement): number => svg.closest(".bb-avatar-preview,.bb-avatar-picker__preview,.sand-chat-header,[data-avatar-priority='primary']") ? 100 : svg.closest(".sand-message") ? 80 : 50;
const moving = (a: Actor) => a.transition != null || Math.abs(a.gaze.x-a.gaze.tx) + Math.abs(a.gaze.y-a.gaze.ty) > .004;

/** One coordinator per document. Sparse scheduling for idle life; a shared rAF
 * runs ONLY while a pose/gaze is settling. React and business state never tick. */
class MotionCoordinator {
  readonly document: Document;
  readonly actors = new Map<SVGSVGElement, Actor>();
  preference: AvatarMotionPreference;
  private readonly win: Window | null;
  private readonly reduced?: MediaQueryList;
  private readonly observer?: IntersectionObserver;
  private timer?: number;
  private frame?: number;
  private lastFrame = 0;
  private nextId = 1;
  private focused = true;
  private wasLowPower = false;
  private selected = new Set<number>();
  private stopPreference: () => void;
  private pointerPosition?: { x: number; y: number };
  constructor(document: Document) {
    this.document = document; this.win = document.defaultView;
    this.preference = getAvatarMotionPreference(document);
    this.wasLowPower = this.lowPower();
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
    document.addEventListener("pointerout", this.onPointerOut, { passive: true });
  }
  private now(): number { return this.win?.performance.now() ?? 0; }
  private onPreference = () => { this.preference = getAvatarMotionPreference(this.document); this.refresh(); };
  private onFocus = () => { this.focused = true; this.refresh(); };
  private onBlur = () => { this.focused = false; this.refresh(); };
  private allowed(): boolean { return this.preference !== "off" && !this.reduced?.matches && !this.document.hidden && this.focused; }
  private lowPower(): boolean {
    const nav = this.win?.navigator as (Navigator & { connection?: { saveData?: boolean } }) | undefined;
    return this.preference === "subtle" || nav?.connection?.saveData === true || (typeof nav?.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4);
  }
  private render(actor: Actor): void {
    const p = { ...actor.pose, lookX: actor.pose.lookX+actor.gaze.x, lookY: actor.pose.lookY+actor.gaze.y };
    paintExpression(actor.svg,p,actor.shape,actor.size);
  }
  private clear(actor: Actor, paint = true): void {
    for (const animation of actor.animations.values()) animation.cancel();
    actor.animations.clear();
    actor.transition = undefined; actor.scheduledPoses = [];
    actor.gaze = { x:0,y:0,tx:0,ty:0 };
    actor.pose = expressionPose(actor.expression);
    actor.svg.querySelector<SVGGElement>(".bb-character__face")?.style.removeProperty("transform");
    if (paint) this.render(actor);
  }
  private animate(actor: Actor, selector: string, frames: Keyframe[], duration: number): void {
    if (!this.allowed() || !this.selected.has(actor.id) || !actor.visible || actor.paused || actor.size < 24) return;
    const node = actor.svg.querySelector<SVGElement>(selector);
    if (!node?.animate) return;
    // One owner for each transform. A second blink/gesture must replace, rather
    // than add to, the animation already driving the same SVG node.
    const previous=actor.animations.get(node);
    if (previous) { actor.animations.delete(node);previous.cancel(); }
    if (actor.animations.size >= 4) return;
    const animation = node.animate(frames, { duration, easing: "cubic-bezier(.22,.61,.36,1)", iterations: 1 });
    actor.animations.set(node,animation);
    const release = () => { if (actor.animations.get(node)===animation) actor.animations.delete(node); };
    animation.onfinish = () => { release(); animation.cancel(); };
    animation.oncancel = release;
  }
  private blink(actor: Actor): void {
    // Independent, repeatable timing. Occasional double blinks, never a shared
    // fixed interval; the pause and reopening have deliberately unequal lengths.
    const twice = !this.lowPower() && identitySeed(`${actor.identity ?? actor.id}:${actor.blinkCycle}:blink`) % 9 === 0;
    const frames: Keyframe[] = [{transform:"scaleY(1)",offset:0},{transform:"scaleY(.09)",offset:.22},{transform:"scaleY(.09)",offset:.32},{transform:"scaleY(1.035)",offset:.7},{transform:"scaleY(1)",offset:1}];
    if (this.lowPower()) this.animate(actor,".bb-character__eyes",[{transform:"scaleY(1)"},{transform:"scaleY(.35)",offset:.35},{transform:"scaleY(1)"}],220);
    else if (twice) this.animate(actor,".bb-character__eyes",[{transform:"scaleY(1)"},{transform:"scaleY(.09)",offset:.12},{transform:"scaleY(1)",offset:.4},{transform:"scaleY(.15)",offset:.63},{transform:"scaleY(1)",offset:1}],490);
    else this.animate(actor,".bb-character__eyes",frames,245);
  }
  private perform(actor: Actor): void {
    if (this.lowPower()) return;
    const plan=activityChoreography(actor.expression,actor.identity ?? String(actor.id),actor.activityCycle++);
    let at=this.now();
    actor.scheduledPoses=plan.steps.map(step=>{const scheduled={at,pose:step.pose,duration:step.duration};at+=step.duration+step.hold;return scheduled;});
    if (plan.body) this.animate(actor,".bb-character__body",plan.body.frames,plan.body.duration);
    actor.nextActivityAt=Math.max(at,this.now()+(plan.body?.duration ?? 0))+activityDelay(actor.expression,actor.identity ?? String(actor.id),actor.activityCycle);
    this.advancePoses(actor,this.now());
  }
  private advancePoses(actor: Actor, now: number): void {
    let latest: Actor["scheduledPoses"][number] | undefined;
    // A delayed timer skips elapsed accents instead of rapidly replaying them.
    while (actor.scheduledPoses.length && actor.scheduledPoses[0]!.at<=now) latest=actor.scheduledPoses.shift();
    if (latest) this.moveTo(actor,latest.pose,latest.duration);
  }
  private moveTo(actor: Actor, target: ExpressionPose, duration = 360): void {
    if (!this.allowed() || !this.selected.has(actor.id) || this.lowPower()) { actor.pose=target; this.render(actor); return; }
    actor.transition = { from: actor.pose, to: target, start: this.now(), duration };
    this.render(actor);this.requestFrame();
  }
  private requestFrame(): void {
    if (this.frame === undefined && this.allowed() && this.selected.size) this.frame = this.win?.requestAnimationFrame(this.paintFrame);
  }
  private paintFrame = (now: number): void => {
    this.frame=undefined;
    if (!this.allowed()) { this.refresh(); return; }
    const dt = this.lastFrame ? Math.max(0,Math.min(80,now-this.lastFrame)) : 16;
    this.lastFrame=now;
    const pointer=this.pointerPosition; this.pointerPosition=undefined;
    let pending=false, completedTransition=false;
    for (const actor of this.actors.values()) {
      if (!this.selected.has(actor.id)) continue;
      if (pointer && actor.pointer && !this.lowPower()) {
        const box=actor.svg.getBoundingClientRect();
        const near=pointer.x>=box.left-24 && pointer.x<=box.right+24 && pointer.y>=box.top-24 && pointer.y<=box.bottom+24;
        const fit=faceFit(actor.shape);
        actor.gaze.tx=near ? bounded((pointer.x-box.left-box.width/2)/Math.max(1,box.width)*3,-fit.gazeX,fit.gazeX) : 0;
        actor.gaze.ty=near ? bounded((pointer.y-box.top-box.height/2)/Math.max(1,box.height)*2,-fit.gazeY,fit.gazeY) : 0;
      }
      const transition=actor.transition;
      if (transition) {
        const progress=settleProgress(now-transition.start,transition.duration);
        actor.pose=mixPose(transition.from,transition.to,progress);
        if (progress>=1) { actor.transition=undefined;completedTransition=true; }
      }
      const convergence=1-Math.exp(-dt/90);
      actor.gaze.x+=(actor.gaze.tx-actor.gaze.x)*convergence;
      actor.gaze.y+=(actor.gaze.ty-actor.gaze.y)*convergence;
      if (Math.abs(actor.gaze.x-actor.gaze.tx)<.005) actor.gaze.x=actor.gaze.tx;
      if (Math.abs(actor.gaze.y-actor.gaze.ty)<.005) actor.gaze.y=actor.gaze.ty;
      this.render(actor); pending ||= moving(actor);
    }
    if (pending) this.requestFrame(); else this.lastFrame=0;
    if (completedTransition) this.schedule();
  };
  refresh = (): void => {
    if (this.timer !== undefined) { this.win?.clearTimeout(this.timer); this.timer=undefined; }
    const previouslySelected=this.selected;
    const lowPower=this.lowPower(), resumingNatural=this.wasLowPower && !lowPower;
    this.wasLowPower=lowPower;
    this.selected = new Set(this.allowed() ? selectMotionCandidates([...this.actors.values()], lowPower) : []);
    for (const actor of this.actors.values()) {
      const active=this.selected.has(actor.id);
      actor.svg.dataset.motion=active ? this.preference : "still";
      if (!active || lowPower) this.clear(actor);
      if (active && !previouslySelected.has(actor.id)) this.restartCadence(actor);
      else if (active && resumingNatural) this.restartCadence(actor,true);
    }
    if (!this.selected.size || lowPower) {
      if (this.frame!==undefined) this.win?.cancelAnimationFrame(this.frame);
      this.frame=undefined;this.pointerPosition=undefined;this.lastFrame=0;
    }
    this.schedule();
  };
  private restartCadence(actor: Actor, keepBlink = false): void {
    const identity=actor.identity ?? String(actor.id), now=this.now();
    if (!keepBlink || actor.nextBlinkAt<=0) actor.nextBlinkAt=now+900+identitySeed(`${identity}:blink-entry`)%1500;
    actor.nextActivityAt=now+550+identitySeed(`${identity}:activity-entry`)%900;
  }
  private schedule(): void {
    if (this.timer!==undefined) this.win?.clearTimeout(this.timer);
    this.timer=undefined;
    if (!this.allowed() || !this.selected.size) return;
    let due=Infinity;
    for (const actor of this.actors.values()) if (this.selected.has(actor.id)) {
      due=Math.min(due,actor.nextBlinkAt);
      if (!this.lowPower()) {
        due=Math.min(due,actor.scheduledPoses[0]?.at ?? Infinity);
        // A frame-delayed morph must not cause 16ms timeout polling. Its final
        // rAF reschedules activity once the actor can actually start it.
        if (!actor.transition && !actor.scheduledPoses.length) due=Math.min(due,actor.nextActivityAt);
      }
    }
    if (Number.isFinite(due)) this.timer=this.win?.setTimeout(this.tick,Math.max(16,due-this.now()));
  }
  private tick = (): void => {
    this.timer=undefined;
    if (!this.allowed()) { this.refresh(); return; }
    const now=this.now();
    for (const actor of this.actors.values()) {
      if (!this.selected.has(actor.id)) continue;
      this.advancePoses(actor,now);
      if (now>=actor.nextBlinkAt) {
        this.blink(actor);actor.blinkCycle++;
        actor.nextBlinkAt=now+blinkDelay(actor.identity ?? String(actor.id),actor.blinkCycle);
      }
      if (!this.lowPower() && now>=actor.nextActivityAt && !actor.transition && !actor.scheduledPoses.length) this.perform(actor);
    }
    this.schedule();
  };
  private onPointer = (event: PointerEvent): void => {
    if (event.pointerType === "touch" || !this.allowed() || this.lowPower()) return;
    if (![...this.actors.values()].some(a=>a.pointer && this.selected.has(a.id))) return;
    this.pointerPosition={x:event.clientX,y:event.clientY}; this.requestFrame();
  };
  private onPointerOut = (event: PointerEvent): void => {
    if (event.relatedTarget != null) return;
    this.pointerPosition=undefined;
    for (const actor of this.actors.values()) { actor.gaze.tx=0;actor.gaze.ty=0; }
    if ([...this.actors.values()].some(moving)) this.requestFrame();
  };
  register(svg: SVGSVGElement, options: AvatarMotionOptions): AvatarMotionHandle {
    const actor: Actor = {id:this.nextId++,svg,state:"idle",paused:false,priority:50,size:32,visible:!this.observer,pointer:false,nextBlinkAt:0,nextActivityAt:0,animations:new Map(),expression:"idle",shape:"blob",pose:expressionPose("idle"),blinkCycle:0,activityCycle:0,scheduledPoses:[],gaze:{x:0,y:0,tx:0,ty:0}};
    this.actors.set(svg,actor); this.observer?.observe(svg);
    let destroyed=false;
    const update = (value: AvatarMotionOptions) => {
      if (destroyed) return;
      const previous=actor.expression, oldShape=actor.shape, oldIdentity=actor.identity;
      const priorPose={...actor.pose,lookX:actor.pose.lookX+actor.gaze.x,lookY:actor.pose.lookY+actor.gaze.y};
      actor.state=normalizeAvatarState(value.state);actor.expression=expressionFromState(value.state);actor.paused=value.paused===true;
      actor.size=Number.isFinite(value.size) ? Math.max(1,Math.min(1024,value.size!)) : (svg.getBoundingClientRect().width || 32);
      actor.shape=(AVATAR_SHAPES as readonly string[]).includes(value.shape ?? "") ? value.shape! : AVATAR_SHAPES[Number(svg.dataset.variant)] ?? "blob";
      actor.priority=value.priority ?? priorityFromSurface(svg);actor.pointer=value.followingPointer===true;actor.identity=value.identity;
      svg.dataset.state=actor.state;svg.dataset.expression=actor.expression;
      if (oldIdentity!==actor.identity) { actor.blinkCycle=0;actor.activityCycle=0; }
      if (previous!==actor.expression || oldShape!==actor.shape || oldIdentity!==actor.identity) {
        this.clear(actor);this.restartCadence(actor,oldShape===actor.shape && oldIdentity===actor.identity);
        this.refresh();
        if (oldShape===actor.shape && oldIdentity===actor.identity && !INACTIVE.has(actor.state)) {
          actor.pose=priorPose;this.moveTo(actor,expressionPose(actor.expression));
        }
      } else { this.render(actor);this.refresh(); }
      if (!actor.pointer) { actor.gaze.tx=0;actor.gaze.ty=0; if (moving(actor)) this.requestFrame(); }
    };
    update(options);
    return { update, gesture: kind => { if (!destroyed) this.gesture(actor,kind); }, reset: () => { if (!destroyed) { this.clear(actor);this.restartCadence(actor);this.refresh(); } }, destroy: () => {
      if (destroyed) return;destroyed=true;this.clear(actor,false);this.observer?.unobserve(svg);this.actors.delete(svg);
      if (this.actors.size) this.refresh(); else this.dispose();
    }};
  }
  gesture(actor: Actor, kind: AvatarGesture): void {
    if (!["nod","greet","ack","celebrate"].includes(kind) || INACTIVE.has(actor.state) || !this.selected.has(actor.id) || this.lowPower()) return;
    this.clear(actor);
    const transform=kind==="greet" ? "rotate(-4deg)" : kind==="nod" ? "translateY(1.2px) scaleY(.97)" : "translateY(-.9px) scale(1.025)";
    this.animate(actor,".bb-character__body",[{transform:"none"},{transform,offset:.4},{transform:"none"}],420);
    if (kind==="celebrate") {
      this.moveTo(actor,expressionPose("happy"));
      actor.scheduledPoses=[{at:this.now()+850,pose:expressionPose(actor.expression),duration:360}];
    }
    actor.nextActivityAt=this.now()+2600;
    this.schedule();
  }
  gestureIdentity(identity: string, kind: AvatarGesture): void {
    const actor=[...this.actors.values()].filter(a=>a.identity===identity && this.selected.has(a.id)).sort((a,b)=>b.priority-a.priority)[0];
    if (actor) this.gesture(actor,kind);
  }
  private dispose(): void {
    if (this.timer!==undefined) this.win?.clearTimeout(this.timer);
    if (this.frame!==undefined) this.win?.cancelAnimationFrame(this.frame);
    this.observer?.disconnect();this.stopPreference();
    this.reduced?.removeEventListener("change",this.refresh);this.document.removeEventListener("visibilitychange",this.refresh);
    this.document.removeEventListener("pointermove",this.onPointer);this.document.removeEventListener("pointerout",this.onPointerOut);
    this.win?.removeEventListener("focus",this.onFocus);this.win?.removeEventListener("blur",this.onBlur);
    coordinators.delete(this.document);
  }
}
export function registerAvatarMotion(svg: SVGSVGElement, options: AvatarMotionOptions): AvatarMotionHandle {
  let coordinator=coordinators.get(svg.ownerDocument);
  if (!coordinator) { coordinator=new MotionCoordinator(svg.ownerDocument);coordinators.set(svg.ownerDocument,coordinator); }
  return coordinator.register(svg,options);
}
export function gestureAvatarIdentity(document: Document, identity: string, kind: AvatarGesture): void { coordinators.get(document)?.gestureIdentity(identity,kind); }
