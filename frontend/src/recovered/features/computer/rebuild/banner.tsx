import { createPortal } from "react-dom";
import type { ComputerRebuildKind } from "../../access/cover/computer-rebuild-model";
import type { BoxMigrationPhase } from "../../access/cover/computer-rebuild-migration-store";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#sha256=ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa#byteOffset=4782586-4793980
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#sha256=80464803b50f478598080bdc1b91da3996c6b74168e2351ea26f620f2ec62ba5#byteOffset=6005302-6020060

const UPDATE_STEPS = ["Getting ready", "Backing up your data", "Recreating BeeBot's computer", "Starting BeeBot's computer", "Cleaning up", "Reconnecting"] as const;
const RESET_STEPS = ["Getting ready", "Wiping your data", "Creating BeeBot's computer", "Starting BeeBot's computer", "Cleaning up", "Reconnecting"] as const;
const RECOVER_STEPS = ["Getting ready", "Recreating BeeBot's computer", "Starting BeeBot's computer", "Reconnecting"] as const;
const RECONNECTING_STAGES = new Set(["downloading", "starting"]);
const PROGRESS_CIRCLE = 22;
const PROGRESS_RADIUS = PROGRESS_CIRCLE * 3 / 8;
const PROGRESS_CIRCUMFERENCE = 2 * Math.PI * PROGRESS_RADIUS;

export interface ComputerRebuildBannerInput {
  readonly kind: ComputerRebuildKind | null;
  readonly stage: string | number | null;
  readonly migrationStatus: BoxMigrationPhase | null;
  readonly migrationPhases: readonly BoxMigrationPhase[];
  /** Pull progress is the coordinator's 0–100 percentage, not a fraction. */
  readonly pullPercent: number | null;
}

export interface ComputerRebuildStep {
  readonly label: string;
  readonly state: "done" | "active" | "pending";
}

export interface ComputerRebuildProgressProjection {
  readonly steps: readonly ComputerRebuildStep[];
  readonly activeIndex: number;
  readonly progress: number;
}

export type ComputerReconnectVariant = "checking" | "network" | "restarting";

export interface ComputerReconnectProjection {
  readonly variant: ComputerReconnectVariant;
  readonly title: string;
  readonly subtitle?: string;
}

function stageIndex(kind: Exclude<ComputerRebuildKind, "reconnecting">, stage: string | number | null): number | null {
  if (typeof stage === "number" && Number.isInteger(stage) && stage >= 0) return stage;
  const stageMap = kind === "reset"
    ? { preparing: 0, tearingDown: 1, downloading: 3, starting: 3, finishing: 5 }
    : kind === "recover"
      ? { preparing: 0, tearingDown: 1, downloading: 2, starting: 2, finishing: 3 }
      : { preparing: 0, tearingDown: 2, downloading: 2, starting: 3, finishing: 5 };
  switch (stage) {
    case "preparing": return stageMap.preparing;
    case "tearingDown": return stageMap.tearingDown;
    case "downloading": return stageMap.downloading;
    case "starting": return stageMap.starting;
    case "finishing": return stageMap.finishing;
    default: return null;
  }
}

function migrationIndex(kind: Exclude<ComputerRebuildKind, "reconnecting">, phase: BoxMigrationPhase, afterHealthyPhase: boolean): number {
  if (kind === "reset") {
    if (phase === "wiping") return 1;
    if (phase === "creating") return 2;
    if (phase === "moving") return 3;
    if (phase === "cleaning-up") return afterHealthyPhase ? 4 : 1;
    if (phase === "backing-up") return 0;
  } else if (kind === "recover") {
    if (phase === "backing-up" || phase === "wiping" || phase === "creating") return 1;
    if (phase === "moving") return 2;
    if (phase === "cleaning-up") return afterHealthyPhase ? 3 : 1;
  } else {
    if (phase === "backing-up") return 1;
    if (phase === "creating") return 2;
    if (phase === "moving") return 3;
    if (phase === "cleaning-up") return afterHealthyPhase ? 4 : 2;
  }
  return 0;
}

function updateMigrationIndex(kind: Exclude<ComputerRebuildKind, "reconnecting">, stage: string | number | null, phase: BoxMigrationPhase | null, phases: readonly BoxMigrationPhase[]): number | null {
  const stageValue = stageIndex(kind, stage);
  let activeIndex: number | null = null;
  let afterHealthyPhase = false;
  const allPhases = [...phases, ...(phase != null && phase !== "done" && phase !== "failed" && phases.at(-1) !== phase ? [phase] : [])];
  for (const migrationPhase of allPhases) {
    const index = migrationIndex(kind, migrationPhase, migrationPhase === "cleaning-up" && afterHealthyPhase);
    activeIndex = activeIndex == null ? index : Math.max(activeIndex, index);
    if (migrationPhase !== "cleaning-up") afterHealthyPhase = true;
  }
  if (activeIndex == null) return stageValue;
  return stageValue == null ? activeIndex : Math.max(activeIndex, stageValue);
}

export function projectComputerRebuildProgress(input: ComputerRebuildBannerInput): ComputerRebuildProgressProjection | null {
  if (input.kind == null || input.kind === "reconnecting") return null;
  const steps = input.kind === "reset" ? RESET_STEPS : input.kind === "recover" ? RECOVER_STEPS : UPDATE_STEPS;
  const activeIndex = updateMigrationIndex(input.kind, input.stage, input.migrationStatus, input.migrationPhases);
  if (activeIndex == null || activeIndex < 0 || activeIndex >= steps.length) return null;
  const pullProgress = input.kind === "update" && input.stage === "downloading" && input.pullPercent != null && input.pullPercent > 0
    ? Math.min(input.pullPercent, 100) / 100
    : 0;
  return {
    activeIndex,
    progress: (activeIndex + pullProgress) / steps.length,
    steps: steps.map((label, index) => ({ label, state: index < activeIndex ? "done" : index === activeIndex ? "active" : "pending" }))
  };
}

export function projectComputerReconnect(input: Pick<ComputerRebuildBannerInput, "kind" | "stage"> & { readonly transport: "connected" | "down" }): ComputerReconnectProjection | null {
  if (input.kind !== "reconnecting") return null;
  if (typeof input.stage === "string" && RECONNECTING_STAGES.has(input.stage)) {
    return { variant: "restarting", title: "BeeBot's computer restarting", subtitle: "Starting BeeBot's computer" };
  }
  if (input.transport === "down") return { variant: "network", title: "Reconnecting" };
  return { variant: "checking", title: "Checking connection", subtitle: "Reconnecting" };
}

function LoadingSpinner() {
  return <span aria-hidden="true" className="sand-16rqkct sand-1y0btm7 sand-zewv6b sand-4usyfx sand-1so62im sand-r5sbw0 sand-1aquc0h sand-of6966 sand-1esw782 sand-a4qsjk sand-1hc1fzr sand-11gebw9" style={{ width: PROGRESS_CIRCLE, height: PROGRESS_CIRCLE, borderWidth: 2 }} />;
}

function ProgressBanner({ title, subtitle, value }: { readonly title: string; readonly subtitle?: string; readonly value?: number }) {
  const clamped = value == null ? null : Math.min(1, Math.max(0, value));
  const offset = PROGRESS_CIRCUMFERENCE * (clamped ?? 0);
  const progress = clamped == null
    ? <LoadingSpinner />
    : <span aria-label="Progress" aria-valuemax={100} aria-valuemin={0} aria-valuenow={Math.round(clamped * 100)} className="sand-3nfvp2 sand-2lah0s" role="progressbar">
      <svg aria-hidden="true" fill="none" height={PROGRESS_CIRCLE} viewBox={`0 0 ${PROGRESS_CIRCLE} ${PROGRESS_CIRCLE}`} width={PROGRESS_CIRCLE}>
        <circle className="sand-1qwm25i" cx={PROGRESS_CIRCLE / 2} cy={PROGRESS_CIRCLE / 2} fill="none" r={PROGRESS_RADIUS} strokeWidth={PROGRESS_CIRCLE / 8} />
        <circle className="sand-1swv6zj sand-9tu13d sand-1g0ag68 sand-1ib35zr sand-4wkmsb sand-1bqoo3p sand-6tor67" cx={PROGRESS_CIRCLE / 2} cy={PROGRESS_CIRCLE / 2} fill="none" r={PROGRESS_RADIUS} strokeDasharray={`${offset} ${PROGRESS_CIRCUMFERENCE - offset}`} strokeLinecap="round" strokeWidth={PROGRESS_CIRCLE / 8} />
      </svg>
    </span>;
  return <div aria-label={title} aria-live="polite" className="sand-progress-banner sand-67bb7w sand-lvsv26 sand-482pwi sand-3nfvp2 sand-6s0dn4 sand-883omv sand-9f619 sand-1y1aw1k sand-cicffo sand-wib8y2 sand-1lqa7cf sand-1q4ynmn sand-4hv7ue sand-1y0btm7 sand-fnq37j sand-10e981r sand-yb0u61" role="status">
    {progress}
    <div className="sand-78zum5 sand-dt5ytf sand-euugli"><span className="sand-tyxrsu sand-78zum5 sand-dt5ytf sand-euugli sand-1y1aw1k sand-4hv7ue sand-1y0btm7 sand-fnq37j sand-10e981r sand-yb0u61">{title}</span>{subtitle == null ? null : <span className="sand-78zum5 sand-dt5ytf sand-euugli sand-1o0liin">{subtitle}</span>}</div>
  </div>;
}

export function ComputerRebuildProgressBanner({ input, onRestore }: { readonly input: ComputerRebuildBannerInput; readonly onRestore: () => void }) {
  const projection = projectComputerRebuildProgress(input);
  if (projection == null || typeof document === "undefined" || document.body == null) return null;
  const title = input.kind === "reset" ? "Resetting BeeBot's Computer" : input.kind === "recover" ? "Recovering BeeBot's Computer" : "Updating BeeBot's Computer";
  const subtitle = projection.steps[projection.activeIndex]?.label;
  const button = <button aria-label="View BeeBot's Computer progress" className="sand-computer-rebuild-banner__restore sand-67bb7w sand-3nfvp2 sand-1717udv sand-c342km sand-jbqb8w sand-1q4ynmn sand-1ypdohk" onClick={onRestore} type="button"><ProgressBanner subtitle={subtitle} title={title} value={projection.progress} /></button>;
  return createPortal(<div className="sand-computer-rebuild-banner sand-ixxii4 sand-1tk7jg1 sand-u96u03 sand-3m8u43 sand-78zum5 sand-l56j7k sand-47corl" data-kind={input.kind} data-stage={String(input.stage ?? "")} style={{ zIndex: "calc(var(--ui-portal-layer-z-index-modal, 3000) + 100)" }}>{button}</div>, document.body);
}

export function ComputerReconnectBanner({ input }: { readonly input: Pick<ComputerRebuildBannerInput, "kind" | "stage"> & { readonly transport: "connected" | "down" } }) {
  const projection = projectComputerReconnect(input);
  if (projection == null || typeof document === "undefined" || document.body == null) return null;
  return createPortal(<div className="sand-computer-reconnect-banner sand-ixxii4 sand-1tk7jg1 sand-u96u03 sand-3m8u43 sand-78zum5 sand-l56j7k sand-47corl" data-variant={projection.variant} style={{ zIndex: "calc(var(--ui-portal-layer-z-index-modal, 3000) + 100)" }}><ProgressBanner subtitle={projection.subtitle} title={projection.title} /></div>, document.body);
}
