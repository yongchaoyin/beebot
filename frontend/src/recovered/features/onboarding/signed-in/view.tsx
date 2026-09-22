import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type TransitionEvent, type WheelEvent } from "react";
import type { DesktopBridge } from "../../../contracts/desktop-bridge";
import type { ProductionCoordinatorClient } from "../../../../production/coordinator-client";
import { createCoordinatorOnboardingReadiness, type OnboardingComputerReadiness, type OnboardingComputerSnapshot, type OnboardingComputerStatusSource } from "./computer-readiness";
import {
  advanceSignedInOnboarding, canSubmitOnboardingDraft, CHARACTER_COLORS, CHARACTER_SHAPES, COMPUTER_DEMO_FRAMES, computerDemoFrame,
  createOnboardingHandOffDwell, DAILY_TOOLS, filterDailyTools, handOffStatus, INITIAL_ONBOARDING_DRAFT, makeOnboardingCreateRequest,
  MEET_TYPED_TEXT, normalizeOnboardingDraft, ONBOARDING_DEMO_BEAT_MS,
  ONBOARDING_JOBS, ONBOARDING_JOBS_BEAT_LIMIT, ONBOARDING_JOBS_BEAT_MS, ONBOARDING_MEET_BEAT_MS,
  ONBOARDING_JOB_BUBBLE_Y_OFFSET, ONBOARDING_MEET_DELAY_BEATS, ONBOARDING_STEP_EXIT_MS, onboardingStepIndex, onboardingStepReport,
  onboardingCreateErrorMessage, previousOnboardingStep, SIGNED_IN_INITIAL_STEP, toggleDailyTool, typedMeetText,
  type OnboardingDraft, type OnboardingStep,
} from "./model";
import { avatarTargetFromRect, CHARACTER_TRANSITIONS, isAvatarLandingTransition, scenePlacements, type CharacterPlacement, type OnboardingCharacterState } from "./scene";
import { flattenSuggestionDescription, selectOnboardingSuggestions, suggestionIdentities, type OnboardingSuggestion, type SuggestionIdentity } from "./suggestions";
import { TOOL_ASSET_URLS } from "./tool-assets";
import { rendererRuntimeAssetUrl } from "../../../../production/runtime-assets";
import { defaultOnboardingCharacterRenderer } from "./character";
import "./view.css";

// Immutable UI anchors (renderer JS, line 523): catalog byte 4,479,930;
// cast byte 5,385,191; suggestions byte 5,397,272; wallpaper byte 5,412,826;
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=2195040 (app-icon URL; SHA256=79e6a73e634ce7ad8d1982739e9064bcc9c9ec5106bdd7281d7514ee68169ad2)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5425495 (signed-in hand-off consumer; 64px image)
// readiness byte 5,441,790. The expanded mirror is navigation-only.

const WALLPAPER_URL = rendererRuntimeAssetUrl("demo-computer-wallpaper-BO7Ye4dV.jpg");
const APP_ICON_URL = new URL("../../../../../../branding/beebot-app-icon.svg", import.meta.url).href;
const APP_ICON_SIZE_PX = 64;
const EMPTY_COMPUTER: OnboardingComputerSnapshot = { isComputerReady: false, computerState: null, pullPercent: null };

export interface OnboardingCharacterVisualProps {
  color: string; shape: string; sizePx: number; state: OnboardingCharacterState;
  isFollowingPointer?: boolean; paused?: boolean; surfaceTheme?: "light"; pointerShown?: boolean;
  className?: string; sourceId?: string; emphasis?: boolean; spinSignal?: number;
  followTarget?: { x: number; y: number } | null;
}
export type OnboardingCharacterRenderer = (props: OnboardingCharacterVisualProps) => ReactNode;

interface SignedInOnboardingProps {
  bridge: DesktopBridge;
  client: ProductionCoordinatorClient | null;
  accountSlot: string;
  computerReadiness?: OnboardingComputerReadiness;
  computerStatus?: OnboardingComputerStatusSource;
  isAccountOnboarded?: () => Promise<boolean>;
  renderCharacter?: OnboardingCharacterRenderer;
  onComplete(agentId: string | null): void;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
function useSceneBeat(active: boolean, intervalMs: number, limit: number): number {
  const [beat, setBeat] = useState(() => prefersReducedMotion() ? limit : 0);
  useEffect(() => {
    setBeat(prefersReducedMotion() ? limit : 0);
    if (!active || prefersReducedMotion()) return;
    const timer = window.setInterval(() => setBeat((current) => { if (current >= limit) { window.clearInterval(timer); return current; } return current + 1; }), intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs, limit]);
  return beat;
}
function Footer({ onBack, onForward, forwardLabel = "Next", disabled = false }: { onBack?: () => void; onForward(): void; forwardLabel?: string; disabled?: boolean }) {
  return <div className="sand-onboarding__footer"><button disabled={disabled} onClick={onForward} type="button">{forwardLabel}</button><span>{onBack == null ? null : <button onClick={onBack} type="button">Back</button>}</span></div>;
}
function FramedStep({ step, exiting = false, children }: { step: OnboardingStep; exiting?: boolean; children: ReactNode }) {
  return <div aria-hidden={exiting || undefined} className="sand-onboarding__step" style={exiting ? { animation: "sand-onboarding-step-exit .1s ease-in both", pointerEvents: "none" } : undefined}><main aria-labelledby={`sand-onboarding-${step}-heading`}>{children}</main></div>;
}
function StepLayout({ step, title, children, footer }: { step: OnboardingStep; title: string; children?: ReactNode; footer: ReactNode }) {
  return <section className={`sand-onboarding__${step}`}><h1 id={`sand-onboarding-${step}-heading`}>{title}</h1>{children}{footer}</section>;
}
function ToolLogo({ name, sizePx }: { name: string; sizePx: number }) {
  const src = TOOL_ASSET_URLS[name];
  return src == null ? null : <img alt="" draggable={false} height={sizePx} src={src} width={sizePx} />;
}
function SearchIcon() {
  return <span aria-hidden="true" data-icon-name="search" data-size="sm" style={{ fontFamily: "cursor-icons" }}>{String.fromCodePoint(0xea6d)}</span>;
}

function Character({ renderCharacter, placement, sizePx = 80, pointerShown = false }: { renderCharacter?: OnboardingCharacterRenderer; placement: CharacterPlacement; sizePx?: number; pointerShown?: boolean }) {
  const render = renderCharacter ?? defaultOnboardingCharacterRenderer;
  return <>{render({ color: placement.color, shape: placement.shape, sizePx, state: placement.state, isFollowingPointer: placement.isGazing && placement.opacity > 0, surfaceTheme: placement.surfaceTheme, pointerShown })}</>;
}
export function SceneCast({ step, meetBeat, demoBeat, jobsBeat, draft, avatarTarget, isAvatarLanded, renderCharacter, onSalesForecastLanded }: {
  step: OnboardingStep; meetBeat: number; demoBeat: number; jobsBeat: number; draft: OnboardingDraft; avatarTarget: { x: number; y: number } | null; isAvatarLanded: boolean;
  renderCharacter?: OnboardingCharacterRenderer; onSalesForecastLanded?(): void;
}) {
  const frame = computerDemoFrame(demoBeat);
  const placements = scenePlacements({ step, meetBeat, demoBeat, demoCursor: frame.cursor, jobsBeat, avatarTarget, isAvatarLanded, createColor: draft.color, createShape: draft.shape });
  return <div aria-hidden="true" className="sand-onboarding__cast">{placements.map((placement) => {
    const transition = CHARACTER_TRANSITIONS[placement.transition];
    const style = { transform: `translate(${placement.x}px, ${placement.y}px) scale(${placement.scale})`, opacity: placement.opacity, transitionDuration: `${prefersReducedMotion() ? 0 : transition.duration}ms`, transitionTimingFunction: transition.easing };
    const content = <Character placement={placement} pointerShown={step === "computer-demo" && placement.id === "hero"} renderCharacter={renderCharacter} />;
    return <div className={`sand-onboarding__cast-${placement.id}`} data-character-state={placement.state} key={placement.id} onTransitionEnd={(event: TransitionEvent<HTMLDivElement>) => { if (placement.id === "sales-forecast" && isAvatarLandingTransition(event.propertyName)) onSalesForecastLanded?.(); }} style={style}>
      {content}
    </div>;
  })}</div>;
}

function WindowLights({ closePressed = false }: { closePressed?: boolean }) {
  const light = (backgroundColor: string, transform?: string): CSSProperties => ({ backgroundColor, borderRadius: "50%", height: 7.3, transition: "transform .15s", width: 7.3, ...(transform ? { transform } : {}) });
  return <div style={{ display: "flex", gap: 4.6, left: 8.9, position: "absolute", top: 8.5 }}><span style={light("#ff5f57", closePressed ? "scale(.72)" : undefined)} /><span style={light("#febc2e")} /><span style={light("#28c840")} /></div>;
}
function DemoTile({ id, pressed, style }: { id?: string; pressed?: boolean; style: CSSProperties }) {
  return <div data-demo-control={id} style={{ backgroundColor: pressed ? "#0000002e" : style.backgroundColor ?? "#fff", borderRadius: 5.5, position: "absolute", transition: "background-color .15s, transform .15s", ...style, ...(pressed ? { backgroundColor: "#0000002e", transform: "scale(.96)" } : {}) }} />;
}
export function ComputerDemo({ beat }: { beat: number }) {
  const frame = computerDemoFrame(beat), pressed = frame.pressed;
  const shownA = beat >= 0 && beat < 6, shownB = beat >= 3;
  const windowStyle = (shown: boolean, geometry: CSSProperties): CSSProperties => { const transition = prefersReducedMotion() ? "0s linear" : shown ? ".42s cubic-bezier(.1,.9,.2,1)" : ".26s cubic-bezier(.2,0,0,1)"; return { background: "#f2f2f4", border: ".75px solid #1414141a", borderRadius: 8.3, boxShadow: "0 12px 30px #0000001f, 0 4.5px 10.5px #0000000d", opacity: shown ? 1 : 0, position: "absolute", transform: shown ? "scale(1)" : "scale(.86)", transition: `opacity ${transition}, transform ${transition}`, ...geometry }; };
  const divider: CSSProperties = { borderTop: ".75px solid #1414141a", left: 0, position: "absolute", right: 0, top: 25 };
  return <div aria-hidden="true" className="sand-onboarding__demo-card" data-pressed={pressed ?? undefined}>
    <img alt="" draggable={false} src={WALLPAPER_URL} />
    <div style={windowStyle(shownA, { height: 183.9, left: 29.6, top: 32.4, width: 300 })}>
      <DemoTile style={{ height: 102.3, left: 13.8, top: 89.8, width: 272.4 }} />
      <DemoTile style={{ height: 44.2, left: 13.8, top: 33.2, width: 59.4 }} />
      <DemoTile id="a-tile-2" pressed={pressed === "a-tile-2"} style={{ height: 44.2, left: 82.9, top: 33.2, width: 59.4 }} />
      <DemoTile style={{ height: 44.2, left: 153.5, top: 33.2, width: 59.4 }} />
      <DemoTile id="a-tile-4" pressed={pressed === "a-tile-4"} style={{ height: 44.2, left: 224, top: 33.2, width: 59.4 }} />
      <div style={divider} /><WindowLights closePressed={pressed === "a-close"} />
    </div>
    <div style={windowStyle(shownB, { height: 183.9, left: 125, top: 73.9, width: 262.7 })}>
      <DemoTile style={{ height: 145.2, left: 82.9, top: 38.7, width: 179.7 }} /><DemoTile style={{ height: 145.5, left: 6.9, top: 38.6, width: 69 }} />
      <DemoTile style={{ backgroundColor: "rgba(0,0,0,.1)", height: 16.6, left: 100.9, top: 56.7, width: 16.6 }} /><DemoTile style={{ backgroundColor: "rgba(0,0,0,.1)", height: 16.6, left: 100.9, top: 89.9, width: 16.6 }} />
      <DemoTile style={{ backgroundColor: "rgba(0,0,0,.1)", height: 6.9, left: 131.3, top: 62.2, width: 89.9 }} /><DemoTile style={{ backgroundColor: "rgba(0,0,0,.1)", height: 6.9, left: 131.3, top: 87.1, width: 89.9 }} /><DemoTile style={{ backgroundColor: "rgba(0,0,0,.1)", height: 6.9, left: 131.3, top: 102.3, width: 58.1 }} />
      <DemoTile id="b-button" pressed={pressed === "b-button"} style={{ backgroundColor: "rgba(4,4,4,.12)", height: 44.2, left: 96.8, top: 125.8, width: 152.1 }} />
      <div style={divider} /><WindowLights />
    </div>
  </div>;
}

export function mapSuggestionWheel(deltaX: number, deltaY: number): number | null {
  const delta = Math.abs(deltaY) > Math.abs(deltaX) ? deltaY : deltaX || deltaY;
  return delta === 0 ? null : delta;
}
function SuggestionScroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null), [edges, setEdges] = useState({ start: false, end: false });
  const sync = useCallback(() => { const node = ref.current; if (node == null) return; const left = Math.abs(node.scrollLeft), remaining = node.scrollWidth - node.clientWidth; setEdges({ start: left > 5, end: left + node.clientWidth < node.scrollWidth - 5 && remaining > 0 }); }, []);
  useLayoutEffect(() => { const node = ref.current; if (node == null) return; sync(); const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync); observer?.observe(node); node.firstElementChild && observer?.observe(node.firstElementChild); return () => observer?.disconnect(); }, [sync]);
  const onWheel = (event: WheelEvent<HTMLDivElement>) => { const delta = mapSuggestionWheel(event.deltaX, event.deltaY), node = event.currentTarget; if (delta == null || node.scrollWidth <= node.clientWidth) return; const max = node.scrollWidth - node.clientWidth, left = node.scrollLeft; if ((delta < 0 && left <= 0) || (delta > 0 && left >= max - .5)) return; event.preventDefault(); node.scrollLeft = left + delta; sync(); };
  const mask = `linear-gradient(to right, transparent 0px, black ${edges.start ? 28 : 0}px, black calc(100% - ${edges.end ? 28 : 0}px), transparent 100%)`;
  return <div onScroll={sync} onWheel={onWheel} ref={ref} style={{ height: 126, maskImage: mask, overflowX: "auto", overflowY: "hidden", paddingInline: 20, WebkitMaskImage: mask }}>{children}</div>;
}
function SuggestionRail({ dailyTools, pickedTemplateId, onPick, renderCharacter }: { dailyTools: readonly string[]; pickedTemplateId: string | null; onPick(suggestion: OnboardingSuggestion, identity: SuggestionIdentity): void; renderCharacter?: OnboardingCharacterRenderer }) {
  const suggestions = selectOnboardingSuggestions(dailyTools, 10), identities = suggestionIdentities(suggestions);
  const logos = new Map<string, string>(DAILY_TOOLS.map((tool) => [tool.label, tool.logo]));
  const render = renderCharacter ?? defaultOnboardingCharacterRenderer;
  return <section aria-label="Suggestions" className="sand-onboarding__suggestions"><h2>Suggestions</h2><SuggestionScroller><div>{suggestions.map((suggestion, index) => {
    const identity = identities[index] ?? { color: "orange", shape: "blob" };
    return <button aria-pressed={pickedTemplateId === suggestion.templateId} className="sand-onboarding__suggestion-card" key={suggestion.templateId} onClick={() => onPick(suggestion, identity)} style={{ animationDelay: `${index * 70}ms` }} type="button">
      {render({ color: identity.color, shape: identity.shape, sizePx: 40, state: "idle" })}
      <span><span>{suggestion.name}</span><span>{suggestion.description.map((part, partIndex) => part.kind === "text" ? part.text : <span key={`${part.label}-${partIndex}`} style={{ alignItems: "center", display: "inline-flex", gap: 3, whiteSpace: "nowrap" }}><ToolLogo name={logos.get(part.label) ?? ""} sizePx={12} />{part.label}</span>)}</span></span>
    </button>;
  })}</div></SuggestionScroller></section>;
}

function ToolPickerStep({ dailyTools, onDailyToolsChange, onBack, onForward }: { dailyTools: string[]; onDailyToolsChange(tools: string[]): void; onBack(): void; onForward(): void }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const tools = filterDailyTools(deferredQuery);
  return <StepLayout step="tools" title="What do you use every day?" footer={<Footer onBack={onBack} onForward={onForward} />}><label><SearchIcon /><input aria-label="Search tools" onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search" spellCheck={false} type="text" value={query} /></label><div>{tools.length === 0 ? <p>No tools match “{deferredQuery.trim()}”</p> : tools.map((tool, index) => { const selected = dailyTools.includes(tool.label); return <button aria-pressed={selected} data-logo={tool.logo} key={tool.logo} onClick={() => onDailyToolsChange(toggleDailyTool(dailyTools, tool.label))} style={{ animationDelay: `${Math.min(index * 22, 330)}ms` }} type="button"><ToolLogo name={tool.logo} sizePx={32} /><span>{tool.label}</span>{selected ? <span aria-hidden="true">✓</span> : null}</button>; })}</div></StepLayout>;
}

export function SignedInOnboardingStep({ step, draft, dailyTools, meetBeat = 0, demoBeat = 0, jobsBeat = 0, error = null, computer = EMPTY_COMPUTER, isAvatarLanded = false, renderCharacter, onAvatarSlotAttached, onDraftChange, onDailyToolsChange, onBack, onForward, onCreate }: {
  step: OnboardingStep; draft: OnboardingDraft; dailyTools: string[]; meetBeat?: number; demoBeat?: number; jobsBeat?: number; error?: string | null; computer?: OnboardingComputerSnapshot; isAvatarLanded?: boolean;
  renderCharacter?: OnboardingCharacterRenderer; onAvatarSlotAttached?(node: HTMLDivElement | null): void; onDraftChange(draft: OnboardingDraft): void; onDailyToolsChange(tools: string[]): void; onBack(): void; onForward(): void; onCreate(): void;
}) {
  const normalizedDraft = normalizeOnboardingDraft(draft);
  if (step === "meet") return <StepLayout step={step} title="Meet Grok Bot" footer={<Footer onForward={onForward} />}><div aria-hidden="true" className="sand-onboarding__composer"><p>{typedMeetText(meetBeat)}{meetBeat >= ONBOARDING_MEET_DELAY_BEATS && meetBeat < ONBOARDING_MEET_DELAY_BEATS + MEET_TYPED_TEXT.length ? <span style={{ borderLeft: "1px solid currentColor", display: "inline-block", height: "1em" }} /> : null}</p><span><button aria-label="Attach" tabIndex={-1} type="button">+</button><button aria-label="Send" onClick={onForward} tabIndex={-1} type="button">↑</button></span></div></StepLayout>;
  if (step === "computer-demo") return <StepLayout step={step} title="Grok Bot has its own computer and works just like you" footer={<Footer onBack={onBack} onForward={onForward} />}><ComputerDemo beat={demoBeat} /></StepLayout>;
  if (step === "jobs") return <StepLayout step={step} title="Give each Bot a job" footer={<Footer onBack={onBack} onForward={onForward} />}><div aria-hidden="true">{ONBOARDING_JOBS.map((job) => <span className="sand-onboarding__job-bubble" key={job.id} style={{ opacity: jobsBeat >= 2 ? 1 : 0, transform: `translate(${job.x}px, ${job.y + ONBOARDING_JOB_BUBBLE_Y_OFFSET}px) translate(-50%, 0)` }}>{job.label}</span>)}</div></StepLayout>;
  if (step === "tools") return <ToolPickerStep dailyTools={dailyTools} onBack={onBack} onDailyToolsChange={onDailyToolsChange} onForward={onForward} />;
  if (step === "create") return <section className="sand-onboarding__create"><aside aria-label="Sidebar preview"><div aria-hidden="true" /><div><button aria-label="Create your first Bot" className="sand-agent-item" disabled type="button"><strong>Create your first Bot</strong></button><p>No chats yet</p></div></aside><div><header><h1 id={`sand-onboarding-${step}-heading`}>New Bot</h1></header><div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 24 }}>
    <div ref={onAvatarSlotAttached} style={{ height: 64, width: 64 }}><span style={{ display: "block", opacity: isAvatarLanded ? 1 : 0, transition: "opacity .12s" }}>{(renderCharacter ?? defaultOnboardingCharacterRenderer)({ color: normalizedDraft.color, shape: normalizedDraft.shape, sizePx: 64, state: "happy" })}</span></div>
    <div aria-label="Character color" role="radiogroup">{CHARACTER_COLORS.map((color) => <button aria-checked={normalizedDraft.color === color.id} aria-label={`${color.label} color`} key={color.id} onClick={() => onDraftChange({ ...normalizedDraft, color: color.id })} role="radio" style={{ backgroundColor: color.value }} title={color.label} type="button" />)}</div>
    <div aria-label="Character shape" role="radiogroup">{CHARACTER_SHAPES.map((shape) => <button aria-checked={normalizedDraft.shape === shape} aria-label={`${shape} shape`} key={shape} onClick={() => onDraftChange({ ...normalizedDraft, shape })} role="radio" title={shape} type="button" />)}</div>
    <label htmlFor="sand-onboarding-create-name">Name</label><input id="sand-onboarding-create-name" onChange={(event) => onDraftChange({ ...normalizedDraft, name: event.currentTarget.value, pickedTemplateId: null })} placeholder="New Bot" spellCheck={false} type="text" value={normalizedDraft.name} /><button disabled={!canSubmitOnboardingDraft(normalizedDraft)} onClick={onCreate} type="button">Get started</button>
    </div><SuggestionRail dailyTools={dailyTools} onPick={(suggestion, identity) => onDraftChange({ name: suggestion.name, description: flattenSuggestionDescription(suggestion.description), color: identity.color, shape: identity.shape, pickedTemplateId: suggestion.templateId })} pickedTemplateId={normalizedDraft.pickedTemplateId} renderCharacter={renderCharacter} /></div></section>;
  return <div className="sand-onboarding__hand-off"><span aria-hidden="true"><img alt="" className="sand-1lliihq sand-2lah0s sand-47corl sand-87ps6o sand-10xuot4" draggable={false} height={APP_ICON_SIZE_PX} src={APP_ICON_URL} width={APP_ICON_SIZE_PX} /><span>BeeBot</span></span><p aria-live="polite" id={`sand-onboarding-${step}-heading`}>{error == null ? handOffStatus(computer) : "BeeBot couldn’t finish setting up"}</p>{error == null ? null : <><p>{error}</p><button autoFocus onClick={onCreate} type="button">Try again</button></>}</div>;
}

export function SignedInOnboarding({ bridge, client, accountSlot, computerReadiness, computerStatus, isAccountOnboarded, renderCharacter, onComplete }: SignedInOnboardingProps) {
  const [step, setStep] = useState<OnboardingStep>(SIGNED_IN_INITIAL_STEP), [exitingStep, setExitingStep] = useState<OnboardingStep | null>(null), [draft, setDraft] = useState(INITIAL_ONBOARDING_DRAFT), [dailyTools, setDailyTools] = useState<string[]>([]), [error, setError] = useState<string | null>(null), [computer, setComputer] = useState(EMPTY_COMPUTER), [avatarTarget, setAvatarTarget] = useState<{ x: number; y: number } | null>(null), [isAvatarLanded, setAvatarLanded] = useState(false);
  const creatingRef = useRef(false), createdAgentRef = useRef<{ accountSlot: string; agentId: string } | null>(null), accountSlotRef = useRef(accountSlot), readinessRef = useRef<OnboardingComputerReadiness | null>(computerReadiness ?? null);
  const [handOffDwell] = useState(() => createOnboardingHandOffDwell());
  accountSlotRef.current = accountSlot;
  const meetBeat = useSceneBeat(step === "meet", ONBOARDING_MEET_BEAT_MS, ONBOARDING_MEET_DELAY_BEATS + MEET_TYPED_TEXT.length), demoBeat = useSceneBeat(step === "computer-demo", ONBOARDING_DEMO_BEAT_MS, COMPUTER_DEMO_FRAMES.length), jobsBeat = useSceneBeat(step === "jobs", ONBOARDING_JOBS_BEAT_MS, ONBOARDING_JOBS_BEAT_LIMIT);
  useEffect(() => {
    const readiness = computerReadiness ?? (client == null ? null : createCoordinatorOnboardingReadiness(client, computerStatus));
    readinessRef.current = readiness; setComputer(readiness?.getSnapshot() ?? EMPTY_COMPUTER);
    const unsubscribe = readiness?.subscribe(() => setComputer(readiness.getSnapshot()));
    return () => { unsubscribe?.(); if (readiness !== computerReadiness) readiness?.dispose(); if (readinessRef.current === readiness) readinessRef.current = null; };
  }, [client, computerReadiness, computerStatus]);
  useEffect(() => { bridge.telemetry.reportOnboardingStep(onboardingStepReport(SIGNED_IN_INITIAL_STEP, SIGNED_IN_INITIAL_STEP)); }, [bridge]);
  useEffect(() => { if (exitingStep == null) return; const timer = window.setTimeout(() => setExitingStep(null), ONBOARDING_STEP_EXIT_MS); return () => window.clearTimeout(timer); }, [exitingStep]);
  useEffect(() => { if (step !== "create") { setAvatarTarget(null); setAvatarLanded(false); } }, [step]);
  useEffect(() => { handOffDwell.cancel(); return () => handOffDwell.cancel(); }, [accountSlot, handOffDwell]);
  useEffect(() => () => handOffDwell.dispose(), [handOffDwell]);
  const transition = (next: OnboardingStep) => { if (next === step) return; const report = onboardingStepReport(step, next); if (report != null) bridge.telemetry.reportOnboardingStep(report); setExitingStep(step); setStep(next); };
  const attachAvatarSlot = useCallback((node: HTMLDivElement | null) => { if (node == null) { setAvatarTarget(null); setAvatarLanded(false); return; } const rect = node.getBoundingClientRect(); setAvatarTarget(avatarTargetFromRect(rect, { width: window.innerWidth, height: window.innerHeight })); if (prefersReducedMotion()) setAvatarLanded(true); }, []);
  const create = async () => {
    if (client == null || creatingRef.current) return; const normalizedDraft = normalizeOnboardingDraft(draft); if (!canSubmitOnboardingDraft(normalizedDraft)) return;
    creatingRef.current = true; setError(null); if (step !== "hand-off") transition("hand-off"); const claimedAccount = accountSlot;
    try {
      await readinessRef.current?.waitForComputer(); if (accountSlotRef.current !== claimedAccount) return;
      const alreadyOnboarded = await isAccountOnboarded?.() ?? false;
      if (accountSlotRef.current !== claimedAccount) return;
      if (alreadyOnboarded) {
        await bridge.onboarding.setSeen(true);
        await handOffDwell.wait();
        if (accountSlotRef.current === claimedAccount) onComplete(null);
        return;
      }
      if (createdAgentRef.current?.accountSlot !== claimedAccount) createdAgentRef.current = null;
      if (createdAgentRef.current == null) { const result = await client.call("createAgent", makeOnboardingCreateRequest(normalizedDraft, dailyTools)); if (accountSlotRef.current !== claimedAccount) return; const candidate = result && typeof result === "object" && "agent" in result ? (result as { agent: unknown }).agent : result; const agentId = candidate && typeof candidate === "object" && "id" in candidate && typeof candidate.id === "string" ? candidate.id : null; if (agentId == null) throw new Error("createAgent returned a malformed agent reply"); createdAgentRef.current = { accountSlot: claimedAccount, agentId }; }
      const agentId = createdAgentRef.current.agentId; await bridge.onboarding.setSeen(true); await handOffDwell.wait(); if (accountSlotRef.current === claimedAccount) onComplete(agentId);
    } catch (reason) { if (accountSlotRef.current === claimedAccount) setError(onboardingCreateErrorMessage(reason)); } finally { creatingRef.current = false; }
  };
  const renderStep = (renderedStep: OnboardingStep) => <SignedInOnboardingStep computer={computer} dailyTools={dailyTools} demoBeat={demoBeat} draft={draft} error={renderedStep === "hand-off" ? error : null} isAvatarLanded={isAvatarLanded} jobsBeat={jobsBeat} meetBeat={meetBeat} onAvatarSlotAttached={attachAvatarSlot} onBack={() => { const previous = previousOnboardingStep(renderedStep); if (previous != null) transition(previous); }} onCreate={() => void create()} onDailyToolsChange={setDailyTools} onDraftChange={setDraft} onForward={() => transition(advanceSignedInOnboarding(renderedStep))} renderCharacter={renderCharacter} step={renderedStep} />;
  const normalizedDraft = useMemo(() => normalizeOnboardingDraft(draft), [draft]);
  return <div className="sand-onboarding" data-platform={bridge.platform} data-step={step} data-step-index={onboardingStepIndex(step)} data-theme={bridge.theme.initial.resolved === "dark" ? "cursor-dark" : "cursor-light"}><SceneCast avatarTarget={avatarTarget} demoBeat={demoBeat} draft={normalizedDraft} isAvatarLanded={isAvatarLanded} jobsBeat={jobsBeat} meetBeat={meetBeat} onSalesForecastLanded={() => setAvatarLanded(true)} renderCharacter={renderCharacter} step={step} />{exitingStep == null ? null : <FramedStep exiting step={exitingStep}>{renderStep(exitingStep)}</FramedStep>}<FramedStep step={step}>{renderStep(step)}</FramedStep></div>;
}
