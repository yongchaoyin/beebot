import type {
  CursorAuthStatus,
  CursorUsageSummary,
  CursorUsageUpgradeAction,
  DesktopAutoReviewInstructions,
  DesktopBridge,
  DesktopTimeZoneState,
  DesktopUpdateStatus,
  ThemePreference,
  ThemeState,
  Unsubscribe
} from "../../../contracts/desktop-bridge";
import type { ProductionCoordinatorClient } from "../../../../production/coordinator-client";
// @evidence src/app/dist/renderer/assets/index-BlqerJhg.js#L1
import type { AutoReviewSettings } from "./auto-review";
import type { AccountState, LocalToolPermission, LocalToolPermissionState } from "./panels";
import type { UsageActionResult, UsageLoadState, UsageMeter } from "./panels";
import { type EgressTunnelStatus } from "./updates";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L20745-L20762
function defaultAutoReviewSettings(): AutoReviewSettings {
  return { isEnabled: true, allowInstructions: [], blockInstructions: [] };
}

export interface SettingsDesktopSnapshot {
  account: AccountState;
  accountPending: boolean;
  accountError: string | null;
  autoReview: AutoReviewSettings;
  theme: ThemePreference;
  timeZone: DesktopTimeZoneState;
  localToolPermission: LocalToolPermissionState;
  securityKeyEnabled: boolean;
  update: DesktopUpdateStatus | null;
  usageSummary: CursorUsageSummary | null;
  usage: UsageLoadState;
  usagePageFeatureGateEnabled: boolean;
  egressTunnel: EgressTunnelSettings;
}

export interface EgressTunnelSettings {
  available: boolean;
  featureGateEnabled: boolean;
  enabled: boolean;
  status: EgressTunnelStatus;
}

export interface SettingsDesktopSubscriptions {
  account?(status: CursorAuthStatus): void;
  securityKey?(enabled: boolean): void;
  theme?(state: ThemeState): void;
  update?(status: DesktopUpdateStatus): void;
  experiments?(snapshot: unknown): void;
  egressTunnel?(enabled: boolean): void;
  egressTunnelStatus?(status: unknown): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function egressTunnelFeatureGateEnabled(snapshot: unknown): boolean {
  if (!isRecord(snapshot) || !isRecord(snapshot.featureGates)) return false;
  return snapshot.featureGates.sand_box_egress_tunnel === true;
}

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=840668
export function usagePageFeatureGateEnabled(snapshot: unknown): boolean {
  if (!isRecord(snapshot) || !isRecord(snapshot.featureGates)) return false;
  return snapshot.featureGates.sand_usage_page === true;
}

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5468252
export function shouldShowUsageSettings(featureGateEnabled: boolean, state: UsageLoadState): boolean {
  if (!featureGateEnabled) return false;
  switch (state.status) {
    case "ready":
      return state.summary?.isEnterprise === false;
    case "loading":
    case "failed":
      return state.summary?.isEnterprise === false;
    case "empty":
    case "unavailable":
      return false;
  }
}

function loadExperimentSnapshot(bridge: DesktopBridge): Promise<unknown> {
  const experiments = (bridge as Partial<DesktopBridge>).experiments;
  return experiments == null
    ? Promise.resolve(undefined)
    : experiments.getSnapshot().catch(() => experiments.initialSnapshot);
}

export function normalizeEgressTunnelStatus(value: unknown): EgressTunnelStatus {
  if (!isRecord(value)) return { state: "off" };
  if (value.state === "connecting") return { state: "connecting" };
  if (value.state === "connected" && typeof value.activeStreams === "number" && Number.isFinite(value.activeStreams) && typeof value.relayedStreams === "number" && Number.isFinite(value.relayedStreams)) {
    return { state: "connected", activeStreams: value.activeStreams, relayedStreams: value.relayedStreams };
  }
  return { state: "off" };
}

export async function loadEgressTunnelState(
  bridge: DesktopBridge,
  coordinatorClient?: Pick<ProductionCoordinatorClient, "isEgressTunnelAvailable">,
  experimentSnapshot: Promise<unknown> = loadExperimentSnapshot(bridge)
): Promise<EgressTunnelSettings> {
  const egressTunnel = (bridge.foreverBox as DesktopBridge["foreverBox"] & { egressTunnel?: DesktopBridge["foreverBox"]["egressTunnel"] }).egressTunnel;
  const [available, resolvedExperimentSnapshot] = await Promise.all([
    coordinatorClient == null
      ? Promise.resolve(false)
      : coordinatorClient.isEgressTunnelAvailable().catch(() => false),
    experimentSnapshot
  ]);
  return {
    available,
    featureGateEnabled: egressTunnelFeatureGateEnabled(resolvedExperimentSnapshot),
    enabled: egressTunnel?.initial === true,
    status: normalizeEgressTunnelStatus(egressTunnel?.initialStatus)
  };
}

function usageStateFromSummary(summary: CursorUsageSummary | null): UsageLoadState {
  return summary == null ? { status: "unavailable", summary: null } : { status: "ready", summary };
}

function normalizeLocalToolPermission(value: unknown): LocalToolPermission {
  return value === "always" || value === "ask" || value === "never" ? value : "ask";
}

function normalizeLocalToolPermissionCeiling(value: unknown): LocalToolPermission | null {
  return value === "always" || value === "ask" || value === "never" ? value : null;
}

export function accountStateFromCursorStatus(status: CursorAuthStatus, avatarDataUrl?: string): AccountState {
  if (status.kind !== "logged-in") return status;
  return {
    kind: "logged-in",
    name: status.displayName ?? status.email ?? "External account",
    ...(status.authId === "local" ? { isLocal: true } : {}),
    ...(status.email == null ? {} : { email: status.email }),
    ...(avatarDataUrl == null ? {} : { avatarDataUrl })
  };
}

// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#L133175-L133176
export function cursorAuthErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message.replace(/^[A-Za-z]*Error:\s*/, "") : "External provider authentication failed.";
}

export async function loadSettingsDesktopSnapshot(bridge: DesktopBridge, coordinatorClient?: Pick<ProductionCoordinatorClient, "isEgressTunnelAvailable">): Promise<SettingsDesktopSnapshot> {
  const experimentSnapshot = loadExperimentSnapshot(bridge);
  const [status, avatar, autoReview, theme, timeZone, localToolPermission, securityKeyEnabled, update, usageResult, resolvedExperimentSnapshot, egressTunnel] = await Promise.all([
    bridge.cursorAccount.getStatus(),
    // @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L133195-L133204
    bridge.cursorAccount.getAvatar().catch(() => null),
    bridge.autoReviewInstructions.get().catch(() => defaultAutoReviewSettings()),
    bridge.theme.get(),
    bridge.timeZone.get(),
    Promise.all([
      bridge.localToolPermission.get().then(normalizeLocalToolPermission, () => "ask" as const),
      bridge.localToolPermission.ceiling().then(normalizeLocalToolPermissionCeiling, () => null)
    ]).then(([permission, ceiling]) => ({ permission, ceiling })),
    bridge.foreverBox.webauthnProxy.get().then((enabled) => enabled === true, () => bridge.foreverBox.webauthnProxy.initial === true),
    bridge.update.getStatus().catch(() => null),
    bridge.cursorAccount.getUsageSummary().then(
      (summary) => usageStateFromSummary(summary),
      (reason: unknown) => ({
        status: "failed" as const,
        summary: null,
        error: reason instanceof Error ? reason.message : String(reason)
      })
    ),
    experimentSnapshot,
    loadEgressTunnelState(bridge, coordinatorClient, experimentSnapshot)
  ]);
  return {
    account: accountStateFromCursorStatus(status, typeof avatar === "string" ? avatar : undefined),
    accountPending: false,
    accountError: status.kind === "logged-out" ? status.errorMessage ?? null : null,
    autoReview,
    theme: theme.preference,
    timeZone,
    localToolPermission,
    securityKeyEnabled,
    update,
    usageSummary: usageResult.summary,
    usage: usageResult,
    usagePageFeatureGateEnabled: usagePageFeatureGateEnabled(resolvedExperimentSnapshot),
    egressTunnel
  };
}

export function setEgressTunnelEnabled(bridge: DesktopBridge, enabled: boolean): Promise<boolean> {
  return bridge.foreverBox.egressTunnel.set(enabled);
}

export function setTimeZoneOverride(bridge: DesktopBridge, timeZone: string | null): Promise<DesktopTimeZoneState> {
  return bridge.timeZone.setOverride(timeZone);
}

export function setThemePreference(bridge: DesktopBridge, theme: ThemePreference): Promise<ThemeState> {
  return bridge.theme.set(theme);
}

export async function setLocalToolPermission(bridge: DesktopBridge, permission: LocalToolPermission): Promise<LocalToolPermission> {
  return normalizeLocalToolPermission(await bridge.localToolPermission.set(permission));
}

export function setSecurityKeyEnabled(bridge: DesktopBridge, enabled: boolean): Promise<boolean> {
  return bridge.foreverBox.webauthnProxy.set(enabled);
}

export function installUpdate(bridge: DesktopBridge): Promise<void> {
  return bridge.update.quitAndInstall();
}

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L133289-L133315; src/app/dist/renderer/assets/index-UbX-y3il.js#L137211-L137216
export async function checkForUpdatesWithRecovery(
  bridge: DesktopBridge,
  onStatus: (status: DesktopUpdateStatus) => void
): Promise<DesktopUpdateStatus> {
  try {
    const status = await bridge.update.check();
    onStatus(status);
    return status;
  } catch (reason) {
    try {
      onStatus(await bridge.update.getStatus());
    } catch {
      // Preserve the original check failure when the recovery read is also unavailable.
    }
    throw reason;
  }
}

export async function loadUsageState(bridge: DesktopBridge, previous: UsageLoadState | undefined): Promise<UsageLoadState> {
  try {
    const summary = await bridge.cursorAccount.getUsageSummary();
    return summary == null
      ? { status: "unavailable", summary: null }
      : { status: "ready", summary };
  } catch (reason: unknown) {
    return {
      status: "failed",
      summary: previous?.summary ?? null,
      error: reason instanceof Error ? reason.message : String(reason)
    };
  }
}

function usageActionResult(value: unknown): UsageActionResult {
  if (typeof value !== "object" || value == null || Array.isArray(value) || typeof (value as { ok?: unknown }).ok !== "boolean") {
    return { ok: false, message: null };
  }
  const message = (value as { message?: unknown }).message;
  return { ok: (value as { ok: boolean }).ok, message: typeof message === "string" ? message : null };
}

export async function runUsageUpgradeAction(bridge: DesktopBridge, action: CursorUsageUpgradeAction): Promise<UsageActionResult> {
  if (action.kind === "open-url") {
    await bridge.openExternal(action.url);
    return { ok: true, message: null };
  }
  return usageActionResult(await bridge.cursorAccount.invokeDashboardAction({ action: action.action, args: { ...action.args } }));
}

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L131384-L131403; src/app/dist/renderer/assets/index-UbX-y3il.js#L137236-L137239
export async function runUsageUpgradeActionAndRefresh(
  bridge: DesktopBridge,
  action: CursorUsageUpgradeAction,
  refresh: () => Promise<unknown>
): Promise<UsageActionResult> {
  const result = await runUsageUpgradeAction(bridge, action);
  if (result.ok && action.kind === "dashboard-action") await refresh();
  return result;
}

export async function cancelUsageTrial(bridge: DesktopBridge): Promise<UsageActionResult> {
  return usageActionResult(await bridge.cursorAccount.cancelTrial());
}

export async function runAccountAction(bridge: DesktopBridge, account: AccountState): Promise<CursorAuthStatus> {
  switch (account.kind) {
    case "logged-out":
      return await bridge.cursorAccount.login();
    case "logging-in":
      return await bridge.cursorAccount.cancelLogin();
    case "logged-in":
      return await bridge.cursorAccount.logout();
  }
}

export function subscribeToSettingsDesktop(
  bridge: DesktopBridge,
  handlers: SettingsDesktopSubscriptions
): Unsubscribe {
  const unsubscribes = [
    handlers.account == null ? null : bridge.cursorAccount.onStatusChanged(handlers.account),
    handlers.securityKey == null ? null : bridge.foreverBox.webauthnProxy.onChanged(handlers.securityKey),
    handlers.theme == null ? null : bridge.theme.onChanged(handlers.theme),
    handlers.update == null ? null : bridge.update.onStatusEvent(handlers.update),
    handlers.experiments == null ? null : bridge.experiments.onChanged(handlers.experiments),
    handlers.egressTunnel == null ? null : bridge.foreverBox.egressTunnel.onChanged(handlers.egressTunnel),
    handlers.egressTunnelStatus == null ? null : bridge.foreverBox.egressTunnel.onStatusChanged(handlers.egressTunnelStatus)
  ].filter((unsubscribe): unsubscribe is Unsubscribe => unsubscribe != null);
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}

export function saveAutoReviewSettings(
  bridge: DesktopBridge,
  settings: AutoReviewSettings
): Promise<DesktopAutoReviewInstructions> {
  return bridge.autoReviewInstructions.set(settings);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function clampPercent(value: number): number {
  return Math.min(Math.max(value, 0), 100);
}

function percentLabel(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  const percent = clampPercent(value);
  return percent > 0 && percent < 1 ? "1%" : `${Math.round(percent)}%`;
}

function resetLabel(nextResetMs: number | null, nowMs: number, verb: "Ends" | "Resets"): string | null {
  if (nextResetMs == null || !Number.isFinite(nextResetMs)) return null;
  const remaining = nextResetMs - nowMs;
  if (remaining <= 0) return `${verb} today`;
  const days = Math.ceil(remaining / DAY_MS);
  return days === 1 ? `${verb} in 1 day` : `${verb} in ${days} days`;
}

function currencyLabel(cents: number): string {
  const amount = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amount);
}

/** Exact meter projection recovered from renderer binding NKn. */
export function usageMetersFromSummary(summary: CursorUsageSummary | null, nowMs = Date.now()): UsageMeter[] {
  if (summary == null) return [];
  const meters: UsageMeter[] = [];
  if (summary.sandUsagePercent != null) {
    const reset = summary.isSandTrial
      ? resetLabel(summary.sandUsageResetTimestampMs, nowMs, "Ends")
      : resetLabel(summary.sandUsageResetTimestampMs, nowMs, "Resets")
        ?? (summary.hasNonZeroIncludedLimit ? "Resets in 7 days" : null);
    meters.push({
      title: summary.isSandTrial ? "Trial usage" : "Weekly usage",
      valueLabel: percentLabel(summary.sandUsagePercent),
      percent: clampPercent(summary.sandUsagePercent),
      ...(reset == null ? {} : { resetLabel: reset })
    });
  }
  if (summary.onDemand != null) {
    const onDemand = summary.onDemand;
    const reset = resetLabel(onDemand.resetTimestampMs, nowMs, "Resets");
    meters.push({
      title: "On-demand usage",
      valueLabel: onDemand.limitCents == null
        ? currencyLabel(onDemand.usedCents)
        : `${currencyLabel(onDemand.usedCents)} / ${currencyLabel(onDemand.limitCents)}`,
      ...(onDemand.limitCents == null ? {} : { percent: clampPercent(onDemand.usedCents / onDemand.limitCents * 100) }),
      ...(reset == null ? {} : { resetLabel: reset })
    });
  }
  return meters;
}
