import { useCallback, useEffect, useId, useMemo, useSyncExternalStore } from "react";
import type { AutoReviewApprovalActionState } from "../auto-review-actions";
import type { AutoReviewApproval, AutoReviewSurface } from "../protocol";
import { projectLeafEntry, useTranscriptCardLeafProviders, type TranscriptCardLeafProps } from "./shared";

// @evidence src/app/dist/renderer/assets/view-QqBtBG74.js#byteOffset=0 (auto-review approval leaf)
// @evidence src/app/dist/renderer/assets/view-QqBtBG74.js#byteOffset=2575 (Always-allow persistence fallback)
// @evidence src/app/dist/renderer/assets/view-QqBtBG74.js#byteOffset=2771 (approval resolution and stale projection)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=827983 (resolveAutoReviewApproval action facade)

const NOOP_SUBSCRIBE = () => () => {};
const PENDING_STATE: AutoReviewApprovalActionState = { status: "pending" };

const SURFACE_COPY: Record<string, { title: string; subject: string }> = {
  host_shell: { title: "The agent wants to run a command", subject: "command" },
  box_shell: { title: "The agent wants to run a command", subject: "command" },
  mcp: { title: "The agent wants to use a connected service", subject: "details" },
  computer: { title: "Auto-review Paused This Action", subject: "details" },
  automation_write: { title: "Auto-review Paused This Action", subject: "details" },
  cloud_agent: { title: "Auto-review Paused This Action", subject: "details" },
  subagent: { title: "The agent wants to run a task", subject: "details" },
};

function surfaceCopy(surface: AutoReviewSurface): { title: string; subject: string } {
  return SURFACE_COPY[surface] ?? { title: "Auto-review Paused This Action", subject: "details" };
}

function locationForSurface(surface: AutoReviewSurface): string | undefined {
  if (surface === "host_shell") return "Runs on your local computer";
  if (surface === "box_shell" || surface === "computer") return "Runs on BeeBot's computer";
  return undefined;
}

function truncateSummary(value: string): string {
  if (value.length <= 340) return value;
  const omitted = value.length - 340;
  return `${value.slice(0, 340)}...[${omitted} chars omitted]...`;
}

function redactProposedRule(value: string | undefined): string | undefined {
  if (value == null || value.trim().length === 0) return undefined;
  const redacted = value
    .replace(/https?:\/\/[^\s"'`]+/gi, (candidate) => {
      try {
        const normalized = new URL(candidate).href.replace(/^(https?:\/\/)[^/?#]*@/i, "$1");
        return normalized.split("#")[0]?.split("?")[0] ?? normalized;
      } catch {
        return candidate;
      }
    })
    .replace(/((?:--)?(?:api[_-]?key|authorization|credential|password|secret|signature|token)\s*(?:=|:|\s)\s*)(?:"[^"]*"|'[^']*'|[^\s]+)/gi, "$1…")
    .replace(/\bBearer\s+[^\s"'`]+/gi, "Bearer …")
    .replace(/\b(?:sk[-_]|gh[pousr]_|xox[baprs]-|AIza)[A-Za-z0-9+/_=-]+/gi, "…")
    .replace(/\s+/g, " ")
    .trim();
  return redacted.length > 0 ? redacted : undefined;
}

function statusLabel(status: AutoReviewApproval["status"] | "failed" | "stale" | "unavailable"): string | undefined {
  switch (status) {
    case "approved": return "Allowed once";
    case "always": return "Always allowed";
    case "denied": return "Denied";
    case "expired": return "Expired";
    case "failed": return "Status unavailable";
    case "stale": return "Expired";
    default: return undefined;
  }
}

function useApprovalActionState(
  action: ReturnType<NonNullable<NonNullable<ReturnType<typeof useTranscriptCardLeafProviders>>["autoReviewApproval"]>> | null,
  initial: AutoReviewApprovalActionState,
): AutoReviewApprovalActionState {
  const subscribe = useCallback((listener: () => void) => action?.subscribe(listener) ?? NOOP_SUBSCRIBE(), [action]);
  const read = useCallback(() => action?.getState() ?? initial, [action, initial]);
  return useSyncExternalStore(subscribe, read, read);
}

function ApprovalStatus({ state, rawStatus }: { state: AutoReviewApprovalActionState; rawStatus: AutoReviewApproval["status"] }) {
  const status = state.status === "settled" ? state.resolution : state.status === "failed" || state.status === "stale" ? state.status : rawStatus;
  const label = statusLabel(status);
  return label == null ? null : <span role="status">{label}</span>;
}

function AutoReviewApprovalBody({ approval, entryId, isStale }: { approval: AutoReviewApproval; entryId: string; isStale: boolean }) {
  const providers = useTranscriptCardLeafProviders();
  const titleId = useId();
  const actionInput = useMemo(() => ({
    entryId,
    requestId: approval.requestId,
    agentId: providers?.scope.agentId ?? null,
    status: approval.status,
    proposedRule: approval.proposedRule,
  }), [approval, entryId, providers?.scope.agentId]);
  const action = useMemo(() => providers?.autoReviewApproval?.(actionInput) ?? null, [actionInput, providers?.autoReviewApproval]);
  useEffect(() => () => action?.dispose(), [action]);
  const initialState = useMemo<AutoReviewApprovalActionState>(() => approval.status === "pending" ? PENDING_STATE : { status: "settled", resolution: approval.status }, [approval.status]);
  const state = useApprovalActionState(action, initialState);
  const canAct = approval.status === "pending" && state.status === "pending" && action != null && providers?.scope.agentId != null && !isStale;
  const copy = surfaceCopy(approval.surface);
  const summary = approval.command ?? approval.summary;
  const hideSummary = approval.command === undefined || approval.summary === "Run a command on your local computer" || approval.summary === "Run a command on BeeBot's computer" || approval.summary === "Run a command on the agent's VM" || /^Run [“"]/.test(approval.summary) || /^Use .+ tool .+ with /.test(approval.summary);
  const redactedRule = redactProposedRule(approval.proposedRule);
  const settledNote = state.status === "settled" && state.resolution === "always"
    ? `A rule always allowing this was added to your Auto-review settings${redactedRule === undefined ? "" : `: “${redactedRule}”`}`
    : undefined;
  const resolve = (resolution: "approved" | "always" | "denied") => {
    if (!canAct) return;
    void action.resolve(resolution);
  };
  const status = state.status === "failed" ? "unavailable" : state.status === "stale" ? "expired" : state.status === "settled" ? state.resolution : approval.status;

  return <section aria-labelledby={titleId} aria-label="Auto-review approval">
    <h3 id={titleId}>{copy.title}</h3>
    {approval.reason == null ? null : <p>{approval.reason}</p>}
    {locationForSurface(approval.surface) == null ? null : <p>{locationForSurface(approval.surface)}</p>}
    {hideSummary ? null : <details><summary>{copy.subject}</summary><p>{truncateSummary(summary)}</p></details>}
    {settledNote == null ? null : <p>{settledNote}</p>}
    {status === "pending" ? <div>
      <button disabled={!canAct} onClick={() => resolve("approved")} type="button">Allow once</button>
      <button disabled={!canAct} onClick={() => resolve("always")} type="button">Always allow</button>
      <button disabled={!canAct} onClick={() => resolve("denied")} type="button">Deny</button>
    </div> : <ApprovalStatus state={state} rawStatus={approval.status} />}
  </section>;
}

export function AutoReviewApprovalTranscriptCard(props: TranscriptCardLeafProps) {
  const entry = projectLeafEntry(props.entry);
  if (entry == null || entry.message.type !== "auto-review-approval") return null;
  return <AutoReviewApprovalBody approval={entry.message.approval} entryId={entry.id} isStale={props.isStale === true} />;
}

export default AutoReviewApprovalTranscriptCard;
