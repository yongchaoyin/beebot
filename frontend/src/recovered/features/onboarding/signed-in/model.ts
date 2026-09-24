// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L20492
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L130486

export const ONBOARDING_STEPS = ["landing", "meet", "computer-demo", "jobs", "tools", "create"] as const;
export const SIGNED_IN_ONBOARDING_STEPS = ["meet", "computer-demo", "jobs", "tools", "create", "hand-off"] as const;
export type OnboardingStep = typeof ONBOARDING_STEPS[number] | "hand-off";

export const SIGNED_IN_INITIAL_STEP: OnboardingStep = "meet";
export type OnboardingRoute = "sign-in" | "onboarding" | "shell";
export const ONBOARDING_ACCOUNT_CONSULT_TIMEOUT_MS = 10_000;

/**
 * The shipped hand-off re-checks both onboarding state and the roster after
 * the computer wait. Probe failures fail open so a transient account/roster
 * read does not strand the first-agent flow.
 */
export async function isOnboardingAccountOnboarded(probe: {
  readSeen(): Promise<boolean>;
  countAgents(): Promise<unknown>;
}, timeoutMs = ONBOARDING_ACCOUNT_CONSULT_TIMEOUT_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const consult = Promise.allSettled([probe.readSeen(), probe.countAgents()]);
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const result = await Promise.race([consult, deadline]);
  if (timer != null) clearTimeout(timer);
  if (result === null) return false;
  const [seen, roster] = result;
  return (seen.status === "fulfilled" && seen.value === true)
    || (roster.status === "fulfilled" && typeof roster.value === "number" && Number.isFinite(roster.value) && roster.value > 0);
}
export const ONBOARDING_STEP_EXIT_MS = 200;
export const ONBOARDING_HAND_OFF_DWELL_MS = 1_500;
export const ONBOARDING_MEET_BEAT_MS = 35;
export const ONBOARDING_MEET_DELAY_BEATS = 20;
export const ONBOARDING_DEMO_BEAT_MS = 900;
export const ONBOARDING_JOBS_BEAT_MS = 800;
export const ONBOARDING_JOBS_BEAT_LIMIT = 2;
// Shipped job bubbles use pin="top" at characterY + characterHeight / 2 + 10:
// 80px character size / 2 + 10px label gap = 50px.
export const ONBOARDING_JOB_BUBBLE_Y_OFFSET = 50;
export const ONBOARDING_BOX_PROBE_MS = 2_500;
export const ONBOARDING_BOX_WAIT_TIMEOUT_MS = 60_000;

export const MEET_WELCOME_TEXT = "Welcome to BeeBot";
export const MEET_TYPED_TEXT = "Hand off any task to your team of agents";

export const COMPUTER_DEMO_FRAMES = [
  { cursor: { x: -78.3, y: -62.3 }, pressed: null },
  { cursor: { x: -78.3, y: -62.3 }, pressed: "a-tile-2" },
  { cursor: { x: 62.8, y: -62.3 }, pressed: null },
  { cursor: { x: 62.8, y: -62.3 }, pressed: "a-tile-4" },
  { cursor: { x: -178.4, y: -105.5 }, pressed: null },
  { cursor: { x: -178.4, y: -105.5 }, pressed: "a-close" },
  { cursor: { x: 77.4, y: 71.8 }, pressed: null },
  { cursor: { x: 77.4, y: 71.8 }, pressed: "b-button" },
] as const;

export const ONBOARDING_JOBS = [
  { id: "invoice-chaser", label: "Invoice Chaser", x: 0, y: -112 },
  { id: "weekly-standup", label: "Weekly Standup", x: -132, y: 27 },
  { id: "sales-forecast", label: "Sales Forecast", x: 138, y: 7 },
] as const;

export const DAILY_TOOLS = [
  { logo: "workspace", label: "Workspace" }, { logo: "slack", label: "Slack" },
  { logo: "notion", label: "Notion" }, { logo: "salesforce", label: "Salesforce" },
  { logo: "microsoft-365", label: "Microsoft 365" }, { logo: "linkedin", label: "LinkedIn" },
  { logo: "zoom", label: "Zoom" }, { logo: "github", label: "GitHub" },
  { logo: "jira", label: "Jira" }, { logo: "figma", label: "Figma" },
  { logo: "hubspot", label: "HubSpot" }, { logo: "canva", label: "Canva" },
  { logo: "trello", label: "Trello" }, { logo: "monday", label: "monday.com" },
  { logo: "clickup", label: "ClickUp" }, { logo: "intercom", label: "Intercom" },
  { logo: "zendesk", label: "Zendesk" }, { logo: "box", label: "Box" },
  { logo: "dropbox", label: "Dropbox" }, { logo: "docusign", label: "DocuSign" },
  { logo: "calendly", label: "Calendly" }, { logo: "loom", label: "Loom" },
  { logo: "outreach", label: "Outreach" }, { logo: "salesloft", label: "Salesloft" },
  { logo: "apollo", label: "Apollo" }, { logo: "clay", label: "Clay" },
  { logo: "zoominfo", label: "ZoomInfo" }, { logo: "nooks", label: "Nooks" },
  { logo: "stripe", label: "Stripe" }, { logo: "shopify", label: "Shopify" },
  { logo: "quickbooks", label: "QuickBooks" }, { logo: "netsuite", label: "NetSuite" },
  { logo: "ramp", label: "Ramp" }, { logo: "workday", label: "Workday" },
  { logo: "rippling", label: "Rippling" }, { logo: "ashby", label: "Ashby" },
  { logo: "greenhouse", label: "Greenhouse" }, { logo: "vercel", label: "Vercel" },
  { logo: "tableau", label: "Tableau" }, { logo: "hex", label: "Hex" },
  { logo: "amplitude", label: "Amplitude" }, { logo: "mixpanel", label: "Mixpanel" },
  { logo: "snowflake", label: "Snowflake" }, { logo: "databricks", label: "Databricks" },
  { logo: "mailchimp", label: "Mailchimp" },
] as const;

export const CHARACTER_COLORS = [
  { id: "brown", label: "Brown", value: "#936439" },
  { id: "red", label: "Red", value: "#FF263C" },
  { id: "orange", label: "Orange", value: "#FF6700" },
  { id: "yellow", label: "Yellow", value: "#FF9800" },
  { id: "green", label: "Green", value: "#00C972" },
  { id: "cyan", label: "Cyan", value: "#00BCA6" },
  { id: "blue", label: "Blue", value: "#1084FE" },
  { id: "violet", label: "Violet", value: "#9159FE" },
  { id: "magenta", label: "Magenta", value: "#FF309B" },
  { id: "gray", label: "Gray", value: "#777777" },
] as const;
export const CHARACTER_SHAPES = ["blob", "pebble", "squircle", "tablet", "wedge", "hex", "cloud", "teardrop"] as const;

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5435957
// The shipped hand-off dwell is a cancellable delay, not an unowned window timer.
export interface OnboardingDwellClock {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const SYSTEM_DWELL_CLOCK: OnboardingDwellClock = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface OnboardingHandOffDwell {
  wait(): Promise<void>;
  cancel(): void;
  dispose(): void;
}

export function createOnboardingHandOffDwell(clock: OnboardingDwellClock = SYSTEM_DWELL_CLOCK): OnboardingHandOffDwell {
  const pending = new Map<() => void, unknown>();
  let disposed = false;
  const settle = (resolve: () => void) => {
    if (!pending.has(resolve)) return;
    const timer = pending.get(resolve);
    clock.clearTimeout(timer);
    pending.delete(resolve);
    resolve();
  };
  return {
    wait() {
      if (disposed) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const timer = clock.setTimeout(() => {
          pending.delete(resolve);
          resolve();
        }, ONBOARDING_HAND_OFF_DWELL_MS);
        pending.set(resolve, timer);
      });
    },
    cancel() {
      for (const resolve of [...pending.keys()]) settle(resolve);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const resolve of [...pending.keys()]) settle(resolve);
      pending.clear();
    },
  };
}

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L20492
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L130486
// Shipped first-run routing: signed-out users land on sign-in; an existing
// roster vetoes onboarding and marks the onboarding flag seen.
export function resolveOnboardingRoute(input: {
  isSignedIn: boolean;
  hasSeenOnboarding: boolean;
  agentCount: number | null;
}): OnboardingRoute {
  if (!input.isSignedIn) return "sign-in";
  if (input.hasSeenOnboarding || (input.agentCount != null && input.agentCount > 0)) return "shell";
  return "onboarding";
}

export interface OnboardingDraft {
  name: string;
  description: string;
  color: string;
  shape: string;
  pickedTemplateId: string | null;
}

export const INITIAL_ONBOARDING_DRAFT: OnboardingDraft = {
  name: "", description: "", color: "", shape: "", pickedTemplateId: null,
};

export function normalizeOnboardingDraft(draft: OnboardingDraft): OnboardingDraft {
  return {
    ...draft,
    color: CHARACTER_COLORS.some(({ id }) => id === draft.color) ? draft.color : "blue",
    shape: CHARACTER_SHAPES.some((shape) => shape === draft.shape) ? draft.shape : "blob",
  };
}

// Shipped create step disables Get started when the trimmed name is empty.
export function canSubmitOnboardingDraft(draft: OnboardingDraft): boolean {
  return normalizeOnboardingDraft(draft).name.trim().length > 0;
}

export function onboardingStepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.findIndex((candidate) => candidate === step);
}

export function onboardingTelemetryIndex(step: OnboardingStep): number {
  return step === "hand-off" ? ONBOARDING_STEPS.length : onboardingStepIndex(step);
}

export function nextOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  const index = onboardingStepIndex(step);
  return index < 0 ? null : ONBOARDING_STEPS[index + 1] ?? null;
}

export function previousOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  const index = onboardingStepIndex(step);
  return index <= 1 ? null : ONBOARDING_STEPS[index - 1] ?? null;
}

export function advanceSignedInOnboarding(step: OnboardingStep): OnboardingStep {
  return nextOnboardingStep(step) ?? "hand-off";
}

export function onboardingStepReport(from: OnboardingStep, to: OnboardingStep) {
  if (to === "landing") return null;
  return {
    step: to,
    stepIndex: onboardingTelemetryIndex(to),
    direction: onboardingTelemetryIndex(to) >= onboardingTelemetryIndex(from) ? "forward" as const : "back" as const,
  };
}

export function toggleDailyTool(selected: readonly string[], label: string): string[] {
  return selected.includes(label) ? selected.filter((tool) => tool !== label) : [...selected, label];
}

export function filterDailyTools(query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  return normalizedQuery === "" ? DAILY_TOOLS : DAILY_TOOLS.filter((tool) => tool.label.toLowerCase().includes(normalizedQuery));
}

export function typedMeetText(beat: number): string {
  const count = Math.max(-1, Math.min(beat - ONBOARDING_MEET_DELAY_BEATS, MEET_TYPED_TEXT.length));
  return count <= 0 ? MEET_WELCOME_TEXT : MEET_TYPED_TEXT.slice(0, count);
}

export function computerDemoFrame(beat: number): { cursor: { x: number; y: number }; pressed: string | null } {
  if (beat < 0) return { cursor: { x: 0, y: 30 }, pressed: null };
  return COMPUTER_DEMO_FRAMES[Math.min(beat, COMPUTER_DEMO_FRAMES.length - 1)] ?? { cursor: { x: 0, y: 30 }, pressed: null };
}

export function descriptionWithDailyTools(description: string, dailyTools: readonly string[]): string {
  if (dailyTools.length === 0) return description;
  return `${description} The user works with ${dailyTools.join(", ")} every day — start with those tools when suggesting connectors or taking on work.`;
}

export function makeOnboardingCreateRequest(draft: OnboardingDraft, dailyTools: readonly string[]) {
  const normalized = normalizeOnboardingDraft(draft);
  return {
    name: normalized.name.trim(),
    description: descriptionWithDailyTools(normalized.description, dailyTools),
    origin: "user" as const,
    isKickstartRequested: true,
    ...(normalized.pickedTemplateId == null ? {} : { templateId: normalized.pickedTemplateId }),
    avatarShape: normalized.shape,
    avatarColor: normalized.color,
  };
}

// The shipped hand-off turns the coordinator's transport failure into a
// recoverable, user-facing connection message instead of exposing its code.
export function onboardingCreateErrorMessage(reason: unknown): string {
  if (typeof reason === "object" && reason !== null && "code" in reason && reason.code === "source/transport-failure") {
    return "Can't reach your computer right now. Check your connection and try again.";
  }
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

export function handOffStatus(input: { isComputerReady: boolean; pullPercent: number | null; computerState: string | null }): string {
  if (input.isComputerReady) return "Getting your team ready…";
  if (input.pullPercent != null) return `Setting up your BeeBot… ${Math.round(input.pullPercent)}%`;
  if (input.computerState === "hibernated") return "Waking your computer…";
  return "Setting up your BeeBot…";
}
