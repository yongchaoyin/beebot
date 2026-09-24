import { useEffect, useState, type ReactNode } from "react";
import type { CursorUsageSummary, CursorUsageUpgradeAction, DesktopTimeZoneState } from "../../../contracts/desktop-bridge";
import { egressTunnelStatusDescription, type EgressTunnelStatus, type UpdateStatus, type UpdateTrack } from "./updates";
// @evidence src/app/dist/renderer/assets/index-BlqerJhg.js#L1
import { INTERNAL_RELEASE_TRACK_CONFIG_URL, UPDATE_TRACK_LABELS, updateStatusMessage } from "./updates";
import { AutoReviewRulesPanel, type AutoReviewSettings } from "./auto-review";
import { SettingsComputerPanel } from "./computer-view";
import type { SettingsComputerMount } from "./computer";
import { useAsyncAction } from "../../../runtime/async-action";
import { SandButton, SandIconButton } from "../../../ui/sand-kit-primitives";
import type { SandIconPlatform } from "../../../ui/sand-icon-registry";
import { SandSelect } from "../../../ui/sand-floating-primitives";
import { SandSwitch } from "../../../ui/sand-form-primitives";
import { OverlayDialog } from "../../../ui/overlay-primitives";
import { HTTP_ROUTER_PROVIDERS, ROUTER_PROVIDERS, routerProviderById, type HttpRouterProviderId, type RouterProviderId } from "./router";

export type AccountState =
  | { kind: "logged-out"; errorMessage?: string }
  | { kind: "logging-in"; errorMessage?: string }
  | { kind: "logged-in"; name: string; email?: string; avatarDataUrl?: string };

export interface GeneralSettingsPanelProps {
  account: AccountState;
  accountPending?: boolean;
  accountError?: string | null;
  theme: "system" | "light" | "dark";
  onAccountAction(): void;
  onThemeChange(theme: "system" | "light" | "dark"): void | Promise<unknown>;
  language?: "en" | "zh";
  languagePending?: boolean;
  onLanguageChange?(language: "en" | "zh"): void | Promise<unknown>;
  timeZone?: { state: DesktopTimeZoneState; onChange(timeZone: string | null): void | Promise<DesktopTimeZoneState> };
  localToolPermission?: { state: LocalToolPermissionState; onChange(permission: LocalToolPermission): void | Promise<LocalToolPermission> };
  securityKey?: { enabled: boolean; platform: NodeJS.Platform; onChange(enabled: boolean): void | Promise<boolean> };
  autoReview?: { settings: AutoReviewSettings; onChange(settings: AutoReviewSettings): void | Promise<unknown> };
  platform?: SandIconPlatform;
}

export type LocalToolPermission = "always" | "ask" | "never";

export const THEME_PREFERENCE_OPTIONS: readonly { value: GeneralSettingsPanelProps["theme"]; label: string }[] = [
  // @evidence recovered/frontend/app/assets/index-BlqerJhg.js#byteOffset=37830 (immutable theme option map)
  { value: "system", label: "Follow System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" }
];

export interface LocalToolPermissionState {
  permission: LocalToolPermission;
  ceiling: LocalToolPermission | null;
}

// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#L3864
export function accountCopyIconCodePoint(copied: boolean): number {
  return copied ? 0xeab2 : 0xebcc;
}

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=578220 (ui-select-trigger)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=578352 (ui-select-label)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=580482 (select-popup data component)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=580874 (select-item data component)

// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#L20087-L20091
const LOCAL_TOOL_PERMISSION_OPTIONS: readonly { value: LocalToolPermission; label: string }[] = [
  { value: "always", label: "Always allow" },
  { value: "ask", label: "Ask every time" },
  { value: "never", label: "Never allow" }
];

const LOCAL_TOOL_PERMISSION_RANK: Record<LocalToolPermission, number> = { never: 0, ask: 1, always: 2 };

function localToolPermissionExceedsCeiling(permission: LocalToolPermission, ceiling: LocalToolPermission | null): boolean {
  return ceiling != null && LOCAL_TOOL_PERMISSION_RANK[permission] > LOCAL_TOOL_PERMISSION_RANK[ceiling];
}

export interface ThemePreferencePickerProps {
  value: GeneralSettingsPanelProps["theme"];
  disabled?: boolean;
  onChange(value: GeneralSettingsPanelProps["theme"]): void;
}

export function ThemePreferencePicker({ value, disabled = false, onChange }: ThemePreferencePickerProps) {
  return <SandSelect
    ariaLabel="Theme"
    className="ui-select-trigger"
    disabled={disabled}
    menuSize="md"
    onValueChange={onChange}
    options={THEME_PREFERENCE_OPTIONS}
    placement="bottom-end"
    value={value}
  />;
}

export function GeneralSettingsPanel({ account, accountPending = false, accountError = null, theme, onAccountAction, onThemeChange, language = "en", languagePending = false, onLanguageChange, timeZone, localToolPermission, securityKey, autoReview, platform }: GeneralSettingsPanelProps) {
  const [emailCopied, setEmailCopied] = useState(false);
  const [themePending, setThemePending] = useState(false);
  const signedIn = account.kind === "logged-in";
  const isAccountPending = accountPending;
  const visibleAccountError = accountError ?? (account.kind === "logged-out" ? account.errorMessage ?? null : null);
  useEffect(() => {
    if (!emailCopied) return;
    const timeout = window.setTimeout(() => setEmailCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [emailCopied]);
  const title = signedIn ? account.name : account.kind === "logging-in" ? "Signing in" : "Not signed in";
  const detail = signedIn ? account.email ?? "Signed in to Cursor" : account.kind === "logging-in" ? "Finish signing in from your browser" : "Connect your Cursor account to BeeBot";
  const action = signedIn ? "Sign Out" : account.kind === "logging-in" ? "Cancel" : "Sign In with Cursor";
  // @evidence recovered/frontend/app/assets/index-BlqerJhg.js#L40-L50
  const copyEmail = async () => {
    if (!signedIn || account.email == null || typeof navigator === "undefined" || navigator.clipboard == null) return;
    try {
      await navigator.clipboard.writeText(account.email);
      setEmailCopied(true);
    } catch {
      setEmailCopied(false);
    }
  };
  const handleThemeChange = (nextTheme: GeneralSettingsPanelProps["theme"]) => {
    if (themePending) return;
    setThemePending(true);
    void Promise.resolve()
      .then(() => onThemeChange(nextTheme))
      .catch(() => undefined)
      .finally(() => setThemePending(false));
  };

  return (
    <div className="sand-settings-general">
      <SettingsGroup title="Account">
        <div className="sand-account-card" data-state={account.kind}>
          <span aria-hidden="true" className="sand-account-card__avatar">
            {signedIn && account.avatarDataUrl ? <img alt="" src={account.avatarDataUrl} /> : title.slice(0, 1).toLocaleUpperCase()}
          </span>
          <span className="sand-account-card__body">
            <strong>{title}</strong>
            <span>{detail}</span>
            {signedIn && account.email ? <SandIconButton aria-label="Copy email address" className="sand-account-card__copy-email" icon={emailCopied ? "check" : "copy"} label="Copy email address" onClick={() => void copyEmail()} platform={platform} size="sm" title="Copy email address" /> : null}
          </span>
          <SandButton disabled={isAccountPending} onClick={onAccountAction} shape="pill" size="md" variant={signedIn ? "secondary" : "primary"}>{action}</SandButton>
        </div>
        {visibleAccountError ? <p className="sand-account__error">{visibleAccountError}</p> : null}
      </SettingsGroup>

      <SettingsGroup title="Appearance">
        <label>
          <span>Theme</span>
          <ThemePreferencePicker disabled={themePending} onChange={handleThemeChange} value={theme} />
        </label>
        {onLanguageChange == null ? null : (
          <label>
            <span>{language === "zh" ? "语言" : "Language"}</span>
            <SandSelect
              ariaLabel={language === "zh" ? "语言" : "Language"}
              disabled={languagePending}
              onValueChange={(value) => {
                if (value === "en" || value === "zh") void onLanguageChange(value);
              }}
              options={[{ value: "en", label: "English" }, { value: "zh", label: "中文" }]}
              value={language ?? "en"}
            />
          </label>
        )}
      </SettingsGroup>
      {timeZone || localToolPermission || autoReview ? <SettingsGroup title="Agent">
        {timeZone ? <TimeZoneSettingsPanel {...timeZone} /> : null}
        {localToolPermission ? <LocalToolPermissionSettingsPanel {...localToolPermission} /> : null}
        {autoReview ? <AutoReviewRulesPanel {...autoReview} /> : null}
      </SettingsGroup> : null}
      {securityKey ? <SecurityKeySettingsGroup {...securityKey} /> : null}
    </div>
  );
}

const SECURITY_KEY_PLATFORMS: readonly NodeJS.Platform[] = ["darwin", "win32"];

export interface SecurityKeySettingsGroupProps {
  enabled: boolean;
  platform: NodeJS.Platform;
  onChange(enabled: boolean): void | Promise<boolean>;
}

// @evidence recovered/frontend/app/assets/index-BlqerJhg.js#L519-L529
export function SecurityKeySettingsGroup({ enabled, platform, onChange }: SecurityKeySettingsGroupProps) {
  const action = useAsyncAction(onChange);
  const isPending = action.isPending;
  const supported = SECURITY_KEY_PLATFORMS.includes(platform);
  const description = supported
    ? "Allow BeeBot to use a security key (such as a YubiKey) connected to your computer. You’ll be asked to approve each use."
    : "Security keys from BeeBot's computer aren't supported on this platform yet.";
  const handleChange = () => {
    if (!supported || isPending) return;
    action.dispatch(!enabled);
  };

  return (
    <SettingsGroup title="Security Key">
      <div className="sand-settings-row">
        <SandSwitch
          checked={supported && enabled}
          disabled={isPending || !supported}
          label={<span className="sand-settings-copy"><strong>Use hardware security keys</strong><small>{description}</small></span>}
          onCheckedChange={handleChange}
        />
      </div>
    </SettingsGroup>
  );
}

export interface LocalToolPermissionSettingsPanelProps {
  state: LocalToolPermissionState;
  onChange(permission: LocalToolPermission): void | Promise<LocalToolPermission>;
}

export function LocalToolPermissionSettingsPanel({ state, onChange }: LocalToolPermissionSettingsPanelProps) {
  const action = useAsyncAction(onChange);
  const isPending = action.isPending;
  const handleChange = (permission: LocalToolPermission) => {
    action.dispatch(permission);
  };

  return (
    <label>
      <span>
        <strong>Execution on Local Computer</strong>
        <small>Let the assistant open files and run tasks on your computer. Auto-review still checks everything first.</small>
        {state.ceiling != null ? <small>Your team&apos;s admin allows at most &quot;{LOCAL_TOOL_PERMISSION_OPTIONS.find((option) => option.value === state.ceiling)?.label}&quot;</small> : null}
      </span>
      <SandSelect
        ariaLabel="Execution on Local Computer"
        className="ui-select-trigger"
        disabled={isPending}
        onValueChange={handleChange}
        options={LOCAL_TOOL_PERMISSION_OPTIONS.map((option) => ({ ...option, disabled: localToolPermissionExceedsCeiling(option.value, state.ceiling) }))}
        placement="bottom-end"
        value={state.permission}
      />
    </label>
  );
}

export interface TimeZoneSettingsPanelProps {
  state: DesktopTimeZoneState;
  onChange(timeZone: string | null): void | Promise<DesktopTimeZoneState>;
}

function formatTimeZoneName(timeZone: string): string {
  return timeZone.replaceAll("_", " ");
}

function supportedTimeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

export function TimeZoneSettingsPanel({ state, onChange }: TimeZoneSettingsPanelProps) {
  const action = useAsyncAction(onChange);
  const isPending = action.isPending;
  const autoLabel = state.detectedTimeZone == null ? "Auto-detect" : `Auto-detect (${formatTimeZoneName(state.detectedTimeZone)})`;
  const options = supportedTimeZones();
  const values = [
    { value: "auto", label: autoLabel },
    ...(state.overrideTimeZone != null && !options.includes(state.overrideTimeZone)
      ? [{ value: state.overrideTimeZone, label: formatTimeZoneName(state.overrideTimeZone) }]
      : []),
    ...options.map((value) => ({ value, label: formatTimeZoneName(value) }))
  ];
  const handleChange = (value: string) => {
    action.dispatch(value === "auto" ? null : value);
  };

  return (
    <label>
      <span>Timezone</span>
      <SandSelect ariaLabel="Timezone" className="ui-select-trigger" disabled={isPending} onValueChange={handleChange} options={values} placement="bottom-end" value={state.overrideTimeZone ?? "auto"} />
    </label>
  );
}

export interface UsageMeter {
  title: string;
  valueLabel: string;
  percent?: number;
  resetLabel?: string;
}

export type UsageLoadState =
  | { status: "loading" | "failed"; summary: CursorUsageSummary | null; error?: string }
  | { status: "ready"; summary: CursorUsageSummary }
  | { status: "empty" | "unavailable"; summary: null };

export interface UsageActionResult {
  ok: boolean;
  message: string | null;
}

export interface UsageSettingsPanelProps {
  /** Legacy fixture input used by the developer preview. */
  meters?: readonly UsageMeter[];
  state?: UsageLoadState;
  onRetry?(): void;
  onUpgrade?(action: CursorUsageUpgradeAction): Promise<UsageActionResult>;
  onCancelTrial?(): Promise<UsageActionResult>;
  onCancelDialogOpen?(open: boolean): void;
  provider?: RouterProviderId;
}

const UPGRADE_ERROR = "Couldn’t complete the upgrade action — try again";
const CANCEL_TRIAL_COPY = "This ends your BeeBot trial now and removes your remaining trial credits. Your card won’t be charged either way — the trial never turns into a paid plan on its own.";

export function UsageSettingsPanel({ meters = [], state, onRetry, onUpgrade, onCancelTrial, onCancelDialogOpen, provider = "cursor" }: UsageSettingsPanelProps) {
  const [upgradePending, setUpgradePending] = useState(false);
  const [upgradeNotice, setUpgradeNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);
  useEffect(() => {
    onCancelDialogOpen?.(cancelConfirmOpen);
    return () => {
      onCancelDialogOpen?.(false);
    };
  }, [cancelConfirmOpen, onCancelDialogOpen]);

  const selectedProvider = routerProviderById(provider);
  if (selectedProvider.usageSource === "external") return (
    <div className="sand-usage-section">
      <SettingsGroup title={`${selectedProvider.label} usage`}>
        <div className="sand-provider-usage-card">
          <strong>{selectedProvider.label}</strong>
          <span>{selectedProvider.usageDescription}</span>
        </div>
      </SettingsGroup>
    </div>
  );
  if (state?.status === "empty" || state?.status === "unavailable") return (
    <div className="sand-usage-section">
      <SettingsGroup title={`${selectedProvider.label} usage`}>
        <div className="sand-provider-usage-card">
          <strong>{selectedProvider.label}</strong>
          <span>No usage information is available for this account right now.</span>
        </div>
      </SettingsGroup>
    </div>
  );
  const summary = state?.summary ?? null;
  const loading = state?.status === "loading";
  const failed = state?.status === "failed";
  if (state != null && summary == null) {
    return (
      <div className="sand-usage-section">
        <SettingsGroup title={`${selectedProvider.label} usage`}>
          <div className="sand-usage-state">
            {failed ? <span style={{ color: "#ef8585" }}>Couldn’t load usage.</span> : <span>Loading usage…</span>}
            {failed && onRetry ? <SandButton disabled={loading} onClick={onRetry} size="sm" variant="secondary">Retry</SandButton> : null}
          </div>
        </SettingsGroup>
      </div>
    );
  }

  const projectedMeters = summary == null || meters.length > 0 ? meters : usageMetersFromSummary(summary);
  const upgrade = summary?.upgradeCta ?? null;
  const upgradeSupportingText = summary == null ? null : upgrade == null ? null
    : !summary.hasNonZeroIncludedLimit && summary.hasAvailableUsage && summary.sandUsagePercent != null && summary.sandUsagePercent < 100
      ? "Get more BeeBot usage"
      : summary.isSandTrial
        ? "You’ve used all of your trial usage"
        : summary.hasEndedSandTrial
          ? "Your trial has ended. Upgrade to continue using BeeBot."
          : null;
  const canCancelTrial = summary?.isSandTrial === true && summary.canCancelSandTrial && onCancelTrial != null;

  const invokeUpgrade = async () => {
    if (upgrade == null || onUpgrade == null || upgrade.disabled || upgradePending) return;
    setUpgradeNotice(null);
    setUpgradePending(true);
    try {
      if (upgrade.action.kind === "open-url") {
        const result = await onUpgrade(upgrade.action);
        if (result.ok) setUpgradeNotice(result.message == null ? null : { tone: "info", text: result.message });
        else setUpgradeNotice({ tone: "error", text: result.message ?? UPGRADE_ERROR });
      } else {
        const result = await onUpgrade(upgrade.action);
        if (result.ok) {
          const message = result.message ?? upgrade.action.successMessage;
          setUpgradeNotice(message == null ? null : { tone: "info", text: message });
        } else setUpgradeNotice({ tone: "error", text: result.message ?? UPGRADE_ERROR });
      }
    } catch {
      setUpgradeNotice({ tone: "error", text: UPGRADE_ERROR });
    } finally {
      setUpgradePending(false);
    }
  };

  const confirmCancelTrial = async () => {
    if (onCancelTrial == null || cancelPending) return;
    setCancelNotice(null);
    setCancelPending(true);
    try {
      const result = await onCancelTrial();
      if (!result.ok) {
        setCancelNotice(result.message ?? "Couldn’t cancel the trial. Try again.");
        return;
      }
      setCancelConfirmOpen(false);
    } catch {
      setCancelNotice("Couldn’t cancel the trial. Try again.");
    } finally {
      setCancelPending(false);
    }
  };

  return (
    <div className="sand-usage-section">
      <SettingsGroup title={`${selectedProvider.label} usage`}>
        {projectedMeters.length === 0 ? <span>No included usage available on your plan right now.</span> : projectedMeters.map((meter) => (
          <div className="sand-usage-meter" key={meter.title}>
            <div className="sand-usage-meter__header"><strong>{meter.title}</strong>{meter.resetLabel ? <small>{meter.resetLabel}</small> : null}</div>
            {meter.percent != null ? (
              <span aria-label={`${meter.title}: ${meter.valueLabel}`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={meter.percent} className="sand-usage-meter__track" role="meter">
                <span className="sand-usage-meter__fill" style={{ width: `${Math.max(0, Math.min(100, meter.percent))}%` }} />
              </span>
            ) : null}
            <span>{meter.valueLabel}</span>
          </div>
        ))}
        {upgrade != null && upgradeSupportingText != null && onUpgrade ? (
          <div className="sand-usage-upgrade">
            <span style={upgradeNotice?.tone === "error" ? { color: "#ef8585" } : undefined}>{upgradeNotice?.text ?? upgradeSupportingText}</span>
            <div className="sand-usage-actions">
              {canCancelTrial ? <SandButton disabled={cancelPending} onClick={() => setCancelConfirmOpen(true)} size="sm" variant="secondary">{cancelPending ? "Canceling…" : "Cancel Trial"}</SandButton> : null}
              <SandButton disabled={upgrade.disabled || upgradePending} onClick={() => void invokeUpgrade()} size="sm" variant="primary">{upgrade.label}</SandButton>
            </div>
          </div>
        ) : canCancelTrial ? (
          <div className="sand-usage-actions"><SandButton disabled={cancelPending} onClick={() => setCancelConfirmOpen(true)} size="sm" variant="secondary">{cancelPending ? "Canceling…" : "Cancel Trial"}</SandButton></div>
        ) : null}
        {failed && summary != null && onRetry ? (
          <div className="sand-usage-state" style={{ borderTop: 0, borderRadius: "0 0 9px 9px" }}>
            <span style={{ color: "#ef8585" }}>Couldn’t refresh usage — showing the last known values.</span>
            <SandButton disabled={loading} onClick={onRetry} size="sm" variant="secondary">Retry</SandButton>
          </div>
        ) : null}
      </SettingsGroup>
      <OverlayDialog
        label="Cancel your trial?"
        onClose={() => {
          if (!cancelPending) setCancelConfirmOpen(false);
        }}
        open={cancelConfirmOpen}
        panelStyle={{
          width: "min(400px, calc(100vw - 32px))",
          padding: 20,
          color: "var(--cursor-text-primary, #ececec)",
          background: "var(--cursor-bg-elevated, #202020)",
          border: "1px solid var(--cursor-border-secondary, #414141)",
          borderRadius: 10,
          boxShadow: "0 18px 60px rgba(0, 0, 0, 0.55)"
        }}
        role="alertdialog"
      >
          <h3>Cancel your trial?</h3>
          <p>{CANCEL_TRIAL_COPY}</p>
          {cancelNotice ? <p role="alert" style={{ color: "#ef8585" }}>{cancelNotice}</p> : null}
          <footer style={{ display: "flex", justifyContent: "flex-end", gap: 8, margin: "18px -20px -20px", padding: "12px 16px", borderTop: "1px solid var(--cursor-border-secondary, #383838)" }}>
              <SandButton disabled={cancelPending} onClick={() => setCancelConfirmOpen(false)} size="sm" variant="secondary">Keep Trial</SandButton>
              <SandButton disabled={cancelPending} onClick={() => void confirmCancelTrial()} sentiment="danger" size="sm" variant="primary">{cancelPending ? "Canceling…" : "Cancel Trial"}</SandButton>
          </footer>
      </OverlayDialog>
    </div>
  );
}

export interface VendorAccountView {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly baseUrl: string;
  readonly modelId: string;
}

export interface RouterSettingsPanelProps {
  provider: RouterProviderId;
  pending?: boolean;
  onChange(provider: RouterProviderId): void | Promise<unknown>;
  http?: {
    baseUrl: string;
    modelId: string;
    apiKey: string;
    onBaseUrlChange(value: string): void;
    onModelIdChange(value: string): void;
    onApiKeyChange(value: string): void;
    onSave(): void | Promise<unknown>;
  };
  vendorAccounts?: {
    vendors: readonly VendorAccountView[];
    defaultVendorId: string | null;
    pending?: boolean;
    error?: string | null;
    language?: "en" | "zh";
    onAdd(input: { id?: string; label: string; provider: HttpRouterProviderId; apiKey: string; baseUrl: string; modelId: string }): void | Promise<unknown>;
    onRemove(id: string): void | Promise<unknown>;
    onMakeDefault(account: VendorAccountView): void | Promise<unknown>;
  };
}

function VendorAccountsPanel({ accounts }: { accounts: NonNullable<RouterSettingsPanelProps["vendorAccounts"]> }) {
  const zh = accounts.language === "zh";
  const copy = zh
    ? { title: "模型 API", add: "添加模型", save: "保存", cancel: "取消", remove: "删除", edit: "编辑", def: "默认", setDef: "设为默认", name: "名称", namePh: "例如 DeepSeek 主力", vendor: "厂商", key: "API key", keyPh: "粘贴 API key", keyReplace: "已保存 — 粘贴即可更换", base: "Base URL", model: "模型 ID", empty: "还没有保存的模型。添加后，新建 Bot 时可以为每个 Bot 选择不同的 API。", adding: "添加模型", editing: "编辑模型" }
    : { title: "Model APIs", add: "Add model", save: "Save", cancel: "Cancel", remove: "Remove", edit: "Edit", def: "Default", setDef: "Set default", name: "Name", namePh: "e.g. DeepSeek main", vendor: "Vendor", key: "API key", keyPh: "Paste API key", keyReplace: "Saved — paste to replace", base: "Base URL", model: "Model ID", empty: "No saved models yet. Add one, then pick it when you create a bot.", adding: "Add model", editing: "Edit model" };
  const first = HTTP_ROUTER_PROVIDERS[0]!;
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState<HttpRouterProviderId>(first.id);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(first.defaultBaseUrl);
  const [modelId, setModelId] = useState(first.defaultModelId);
  const [hasKey, setHasKey] = useState(false);
  const pick = (id: HttpRouterProviderId) => {
    const next = HTTP_ROUTER_PROVIDERS.find((item) => item.id === id) ?? first;
    setProvider(next.id);
    setBaseUrl(next.defaultBaseUrl);
    setModelId(next.defaultModelId);
  };
  const reset = () => {
    setAdding(false);
    setEditingId(null);
    setLabel("");
    setProvider(first.id);
    setApiKey("");
    setBaseUrl(first.defaultBaseUrl);
    setModelId(first.defaultModelId);
    setHasKey(false);
  };
  const beginEdit = (item: VendorAccountView) => {
    setAdding(true);
    setEditingId(item.id);
    setLabel(item.label);
    setProvider((HTTP_ROUTER_PROVIDERS.some((option) => option.id === item.provider) ? item.provider : first.id) as HttpRouterProviderId);
    setApiKey("");
    setBaseUrl(item.baseUrl);
    setModelId(item.modelId);
    setHasKey(true);
  };
  const field = (rowLabel: string, control: ReactNode, divided = false) => (
    <label className="sand-settings-row" data-divided={divided || undefined}>
      <span className="sand-settings-copy"><strong>{rowLabel}</strong></span>
      {control}
    </label>
  );
  return (
    <SettingsGroup title={copy.title}>
      {accounts.vendors.length === 0
        ? <label className="sand-settings-row"><span className="sand-settings-copy"><strong>{copy.title}</strong><small>{copy.empty}</small></span><SandButton disabled={accounts.pending} onClick={() => { reset(); setAdding(true); }} size="sm">{copy.add}</SandButton></label>
        : accounts.vendors.map((item) => (
          <label className="sand-settings-row" key={item.id}>
            <span className="sand-settings-copy">
              <strong>{item.label}</strong>
              <small>{item.provider} · {item.modelId}</small>
            </span>
            <span className="sand-settings-row__actions">
              {item.id === accounts.defaultVendorId
                ? <small>{copy.def}</small>
                : <SandButton disabled={accounts.pending} onClick={() => void accounts.onMakeDefault(item)} size="sm" variant="secondary">{copy.setDef}</SandButton>}
              <SandButton disabled={accounts.pending} onClick={() => beginEdit(item)} size="sm" variant="secondary">{copy.edit}</SandButton>
              <SandButton disabled={accounts.pending} onClick={() => void accounts.onRemove(item.id)} size="sm" variant="secondary">{copy.remove}</SandButton>
            </span>
          </label>
        ))}
      {accounts.vendors.length > 0 && !adding ? <SandButton disabled={accounts.pending} onClick={() => { reset(); setAdding(true); }} size="sm">{copy.add}</SandButton> : null}
      {adding ? (
        <SettingsGroup title={editingId == null ? copy.adding : copy.editing}>
          {field(copy.name, <input aria-label={copy.name} onChange={(event) => setLabel(event.currentTarget.value)} placeholder={copy.namePh} value={label} />)}
          {field(copy.vendor, <SandSelect ariaLabel={copy.vendor} className="ui-select-trigger" menuSize="md" onValueChange={(value) => { if (value != null) pick(value as HttpRouterProviderId); }} options={HTTP_ROUTER_PROVIDERS.map((item) => ({ value: item.id, label: item.label }))} placement="bottom-end" value={provider} />, true)}
          {field(copy.key, <input aria-label={copy.key} onChange={(event) => setApiKey(event.currentTarget.value)} placeholder={hasKey ? copy.keyReplace : copy.keyPh} type="password" value={apiKey} />, true)}
          {field(copy.base, <input aria-label={copy.base} onChange={(event) => setBaseUrl(event.currentTarget.value)} placeholder={copy.base} value={baseUrl} />, true)}
          {field(copy.model, <input aria-label={copy.model} onChange={(event) => setModelId(event.currentTarget.value)} placeholder={copy.model} value={modelId} />, true)}
          <div className="sand-settings-row__actions">
            <SandButton disabled={accounts.pending} onClick={reset} size="sm" variant="secondary">{copy.cancel}</SandButton>
            <SandButton disabled={accounts.pending || apiKey.trim().length === 0 && !hasKey} onClick={() => void Promise.resolve(accounts.onAdd({ id: editingId ?? undefined, label, provider, apiKey, baseUrl, modelId })).then(() => reset())} size="sm">{accounts.pending ? "Saving…" : copy.save}</SandButton>
          </div>
        </SettingsGroup>
      ) : null}
      {accounts.error == null ? null : <p aria-live="polite">{accounts.error}</p>}
    </SettingsGroup>
  );
}

export function RouterSettingsPanel({ provider, pending = false, onChange, http, vendorAccounts }: RouterSettingsPanelProps) {
  const selectedProvider = routerProviderById(provider);
  return (
    <div className="sand-router-section">
      {vendorAccounts != null ? <VendorAccountsPanel accounts={vendorAccounts} /> : null}
      <SettingsGroup title="Provider">
        <label className="sand-settings-row">
          <span className="sand-settings-copy">
            <strong>Route agent requests through</strong>
            <small>{selectedProvider.description}</small>
          </span>
          <SandSelect
            ariaLabel="Router provider"
            className="ui-select-trigger"
            disabled={pending}
            menuSize="md"
            onValueChange={(value) => void onChange(value as RouterProviderId)}
            options={ROUTER_PROVIDERS.map((option) => ({ value: option.id, label: option.label }))}
            placement="bottom-end"
            value={provider}
          />
        </label>
      </SettingsGroup>
      {selectedProvider.kind === "http" && http != null ? (
        <SettingsGroup title="Account">
          <label className="sand-settings-row">
            <span className="sand-settings-copy"><strong>API key</strong></span>
            <input aria-label="API key" disabled={pending} onChange={(event) => http.onApiKeyChange(event.currentTarget.value)} placeholder="Paste API key" type="password" value={http.apiKey} />
          </label>
          <label className="sand-settings-row">
            <span className="sand-settings-copy"><strong>Base URL</strong></span>
            <input aria-label="Base URL" disabled={pending} onChange={(event) => http.onBaseUrlChange(event.currentTarget.value)} value={http.baseUrl} />
          </label>
          <label className="sand-settings-row">
            <span className="sand-settings-copy"><strong>Model ID</strong></span>
            <input aria-label="Model ID" disabled={pending} onChange={(event) => http.onModelIdChange(event.currentTarget.value)} value={http.modelId} />
          </label>
          <SandButton disabled={pending} onClick={() => void http.onSave()} size="sm">Save vendor</SandButton>
        </SettingsGroup>
      ) : null}
      <SettingsGroup title="Usage">
        <div className="sand-provider-usage-card">
          <strong>{selectedProvider.label}</strong>
          <span>{selectedProvider.usageDescription}</span>
        </div>
      </SettingsGroup>
    </div>
  );
}

function usageMetersFromSummary(summary: CursorUsageSummary): UsageMeter[] {
  const meters: UsageMeter[] = [];
  if (summary.sandUsagePercent != null) meters.push({
    title: summary.isSandTrial ? "Trial usage" : "Weekly usage",
    valueLabel: `${Math.max(0, Math.min(100, Math.round(summary.sandUsagePercent)))}%`,
    percent: Math.max(0, Math.min(100, summary.sandUsagePercent))
  });
  if (summary.onDemand != null) meters.push({
    title: "On-demand usage",
    valueLabel: summary.onDemand.limitCents == null
      ? `$${(summary.onDemand.usedCents / 100).toFixed(2)}`
      : `$${(summary.onDemand.usedCents / 100).toFixed(2)} / $${(summary.onDemand.limitCents / 100).toFixed(2)}`,
    ...(summary.onDemand.limitCents == null ? {} : { percent: Math.max(0, Math.min(100, summary.onDemand.usedCents / summary.onDemand.limitCents * 100)) })
  });
  return meters;
}

export interface UpdatesSettingsPanelProps {
  status: UpdateStatus | null;
  availableTracks: readonly UpdateTrack[];
  autoUpdateWhenIdle: boolean;
  onCheck(): void | Promise<unknown>;
  onInstall?(): void | Promise<unknown>;
  onSetTrack(track: UpdateTrack): void | Promise<unknown>;
  onSetAutoUpdateWhenIdle(enabled: boolean): void | Promise<unknown>;
  computer?: SettingsComputerMount;
  egressTunnel?: {
    available: boolean;
    enabled: boolean;
    featureGateEnabled: boolean;
    onChange(enabled: boolean): void | Promise<boolean>;
    status: EgressTunnelStatus;
  };
}

export function UpdatesSettingsPanel({
  status,
  availableTracks,
  autoUpdateWhenIdle,
  onCheck,
  onInstall,
  onSetTrack,
  onSetAutoUpdateWhenIdle,
  computer,
  egressTunnel
}: UpdatesSettingsPanelProps) {
  const [checkPending, setCheckPending] = useState(false);
  const [installPending, setInstallPending] = useState(false);
  const [trackPending, setTrackPending] = useState(false);
  const [autoUpdatePending, setAutoUpdatePending] = useState(false);
  const runPendingAction = (action: () => void | Promise<unknown>, setPending: (pending: boolean) => void) => {
    setPending(true);
    void Promise.resolve(action()).catch(() => undefined).finally(() => setPending(false));
  };
  // @evidence src/app/dist/renderer/assets/index-BlqerJhg.js#L445-L459
  if (status == null) {
    return (
      <div className="sand-settings-beta-stack">
        <SettingsGroup title="Updates">
          <div className="sand-settings-beta__status" role="status">
            <span>BeeBot couldn&apos;t load update status. Check again to retry.</span>
            <SandButton disabled={checkPending} onClick={() => runPendingAction(onCheck, setCheckPending)} size="md" variant="secondary">{checkPending ? "Checking…" : "Check for Updates"}</SandButton>
          </div>
        </SettingsGroup>
        {egressTunnel?.featureGateEnabled === true || egressTunnel?.enabled === true ? <EgressTunnelSettingsGroup
          available={egressTunnel.available}
          description={egressTunnel.enabled
            ? egressTunnelStatusDescription(egressTunnel.status)
            : egressTunnel.available
              ? "Route web traffic from BeeBot's computer out through this desktop instead of the cloud. Applies to new connections."
              : "BeeBot's computer wasn't provisioned with the egress tunnel — start a new one to use this."}
          enabled={egressTunnel.enabled}
          onChange={egressTunnel.onChange}
        /> : null}
        {computer ? <SettingsComputerPanel {...computer} /> : null}
      </div>
    );
  }
  const message = updateStatusMessage(status);
  const isDisabled = status.state.type === "disabled";
  const isChecking = status.state.type === "checking";
  const isTransitioning = isChecking || status.state.type === "available" || status.state.type === "downloading" || status.state.type === "staging";
  const trackManagedByPolicy = status.isTrackManagedByPolicy ?? false;
  const autoUpdateGateEnabled = status.autoUpdateWhenIdleGateEnabled ?? true;
  const effectiveAutoUpdateWhenIdle = status.autoUpdateWhenIdleOptIn ?? autoUpdateWhenIdle;
  const trackDescription = trackManagedByPolicy ? (
    <>
      Update access is managed by internal release-track policy. <a href={INTERNAL_RELEASE_TRACK_CONFIG_URL} rel="noopener noreferrer" target="_blank">Open Statsig config</a>
    </>
  ) : "Stable is the safe default. Other tracks ship new builds earlier and more often. Switching checks for updates right away.";
  const egressVisible = egressTunnel?.featureGateEnabled === true || egressTunnel?.enabled === true;
  const egressAvailable = egressTunnel?.available === true;
  const egressDescription = egressTunnel?.enabled === true
    ? egressTunnelStatusDescription(egressTunnel.status)
    : egressAvailable
      ? "Route web traffic from BeeBot's computer out through this desktop instead of the cloud. Applies to new connections."
      : "BeeBot's computer wasn't provisioned with the egress tunnel — start a new one to use this.";
  return (
    <div className="sand-settings-beta-stack">
      <SettingsGroup title="Updates">
        <label className="sand-settings-row">
          <span className="sand-settings-copy"><strong>Update Track</strong><small>{trackDescription}</small></span>
          <SandSelect ariaLabel="Update Track" className="ui-select-trigger" disabled={isDisabled || trackPending || trackManagedByPolicy} onValueChange={(track) => runPendingAction(() => onSetTrack(track), setTrackPending)} options={availableTracks.map((track) => ({ value: track, label: UPDATE_TRACK_LABELS[track] }))} placement="bottom-end" value={status.currentTrack} />
        </label>
        {autoUpdateGateEnabled ? <div className="sand-settings-row">
          <SandSwitch
            checked={effectiveAutoUpdateWhenIdle}
            disabled={isDisabled || autoUpdatePending}
            label={<span className="sand-settings-copy"><strong>Auto-update when idle</strong><small>Automatically update your client while you&apos;re away.</small></span>}
            onCheckedChange={(checked) => runPendingAction(() => onSetAutoUpdateWhenIdle(checked), setAutoUpdatePending)}
          />
        </div> : null}
        <div className="sand-settings-row">
          <span className="sand-settings-copy"><strong>BeeBot {status.currentVersion}</strong><small>Updates follow the {UPDATE_TRACK_LABELS[status.currentTrack]} track</small></span>
          {status.state.type === "ready" ? (
            <SandButton disabled={installPending || onInstall == null} onClick={() => onInstall == null ? undefined : runPendingAction(onInstall, setInstallPending)} size="md" variant="primary">Restart to Update</SandButton>
          ) : (
            <SandButton disabled={isDisabled || checkPending || isTransitioning} onClick={() => runPendingAction(onCheck, setCheckPending)} size="md" variant="secondary">{checkPending || isChecking ? "Checking…" : "Check for Updates"}</SandButton>
          )}
        </div>
        <output aria-live="polite" className="sand-settings-beta__status" data-tone={message.tone}>{message.text}</output>
      </SettingsGroup>
      {egressVisible ? <EgressTunnelSettingsGroup available={egressAvailable} description={egressDescription} enabled={egressTunnel.enabled} onChange={egressTunnel.onChange} /> : null}
      {computer ? <SettingsComputerPanel {...computer} /> : null}
    </div>
  );
}

function EgressTunnelSettingsGroup({ available, description, enabled, onChange }: {
  available: boolean;
  description: string;
  enabled: boolean;
  onChange(enabled: boolean): void | Promise<boolean>;
}) {
  const [pending, setPending] = useState(false);
  const handleChange = () => {
    if (pending) return;
    setPending(true);
    void Promise.resolve(onChange(!enabled)).catch(() => undefined).finally(() => setPending(false));
  };
  return (
    <SettingsGroup title="Egress">
      <div className="sand-settings-row">
        <SandSwitch
          checked={enabled}
          disabled={pending || !available && !enabled}
          label={<span className="sand-settings-copy"><strong>Route egress through this desktop</strong><small>{description}</small></span>}
          onCheckedChange={handleChange}
        />
      </div>
    </SettingsGroup>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3>{title}</h3>{children}</section>;
}
