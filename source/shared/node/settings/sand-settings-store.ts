import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { DEFAULT_SAND_THEME_PREFERENCE, isSandThemePreference, type SandThemePreference } from "../../desktop.js";
import { DEFAULT_UI_LANGUAGE, isUiLanguage, type UiLanguage } from "../../ui-language.js";
import { SAND_DISABLED_NOTIFICATION_CONFIG } from "../../host-settings.js";
import { SAND_DEFAULT_LOCAL_TOOL_PERMISSION, isSandLocalToolPermission, resolveSandLocalToolPermission, type SandLocalToolPermission } from "../../local-tool-permission.js";
import { clampMcpCustomInstruction, getDefaultMcpCustomInstruction } from "../../mcp-custom-instructions.js";
import { DEFAULT_SAND_AUTO_REVIEW_INSTRUCTIONS, normalizeSandAutoReviewInstructions, type SandAutoReviewInstructions } from "../../sand-auto-review-instructions.js";
import { SidebarSections, type SidebarSection } from "../../sidebar-sections.js";
import { coerceToEnabledTrack, isSandUpdateTrack, type SandUpdateTrack } from "../../update-track.js";
import { isSandAgentModelSelection, type SandAgentModelSelection } from "../../agents/sand-agent-model.js";
import { emptySandInferenceRouterUsage, isSandInferenceProvider, type SandInferenceProvider, type SandInferenceRouterUsage } from "../../inference-router.js";
import { isHttpInferenceVendor, parseInferenceHttpConfig, parseInferenceVendorAccounts, vendorPreset, type InferenceHttpConfig, type InferenceVendorAccount } from "../../inference-vendor.js";
import { DEFAULT_SAND_BOX_RUNTIME, isSandBoxRuntime, type SandBoxRuntime } from "../../box-runtime.js";

export const SETTINGS_VERSION = 1;
export const SAND_DOWNGRADE_MAX_FAST_MIGRATION_ID = "downgrade-persisted-max-fast";
export const SAND_SETTINGS_MIGRATION_IDS = [SAND_DOWNGRADE_MAX_FAST_MIGRATION_ID] as const;

type StringMap = Record<string, string>;
type StringListMap = Record<string, string[]>;
export interface SandStoredSettings {
  version: 1; mcpBoxServers: string[]; autoUpdateWhenIdleOptIn: boolean; egressTunnelEnabled: boolean; webauthnProxyEnabled: boolean;
  mcpCustomInstructions: StringMap; mcpCustomInstructionsByServerId: StringMap; mcpDisabledToolsByServerId: StringListMap;
  conciergeConsent: "unset" | "allowed" | "denied"; settingsMigrations: string[];
  hasSeenOnboarding?: boolean; hasSeenOnboardingAccountScope?: string; updateTrackOverride?: SandUpdateTrack; themePreference?: SandThemePreference;
  agentDefaultModel?: SandAgentModelSelection; computerUseModel?: SandAgentModelSelection; notifications?: Record<string, unknown>;
  userTimeZone?: string; userTimeZoneOverride?: string; autoReviewInstructions?: SandAutoReviewInstructions;
  localToolPermission?: SandLocalToolPermission; localToolPermissionCeiling?: SandLocalToolPermission;
  inferenceProvider?: SandInferenceProvider; inferenceRouterUsage?: SandInferenceRouterUsage;
  inferenceHttp?: InferenceHttpConfig; localAccountActive?: boolean;
  boxRuntime?: SandBoxRuntime; uiLanguage?: UiLanguage;
  inferenceVendors?: InferenceVendorAccount[]; defaultInferenceVendorId?: string;
  mcpCustomInstructionsAccountScope?: string; pinnedAgentIds?: string[]; sidebarSections?: SidebarSection[];
}

export function emptySettings(): SandStoredSettings {
  return { version: SETTINGS_VERSION, mcpBoxServers: [], autoUpdateWhenIdleOptIn: false, egressTunnelEnabled: false, webauthnProxyEnabled: true, mcpCustomInstructions: {}, mcpCustomInstructionsByServerId: {}, mcpDisabledToolsByServerId: {}, conciergeConsent: "unset", settingsMigrations: [...SAND_SETTINGS_MIGRATION_IDS] };
}

function stringMap(value: unknown): StringMap { const result: StringMap = {}; if (typeof value !== "object" || value == null || Array.isArray(value)) return result; for (const [key, item] of Object.entries(value)) if (typeof item === "string") result[key] = item; return result; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function normalizeCustomInstructions(raw: StringMap): StringMap { const normalized: StringMap = {}; for (const [name, value] of Object.entries(raw)) { const clamped = clampMcpCustomInstruction(value); if (clamped.trim().length > 0) normalized[name] = clamped; else if (getDefaultMcpCustomInstruction(name).length > 0) normalized[name] = ""; } return normalized; }
function normalizeCustomInstructionsByServerId(raw: StringMap): StringMap { const normalized: StringMap = {}; for (const [id, value] of Object.entries(raw)) if (/^[1-9]\d*$/.test(id)) normalized[id] = clampMcpCustomInstruction(value); return normalized; }
function normalizeDisabledToolsByServerId(raw: unknown): StringListMap { const normalized: StringListMap = {}; if (typeof raw !== "object" || raw == null || Array.isArray(raw)) return normalized; for (const [id, value] of Object.entries(raw)) { if (!/^[1-9]\d*$/.test(id)) continue; const tools = [...new Set(stringArray(value).filter((name) => name.length > 0))]; if (tools.length > 0) normalized[id] = tools; } return normalized; }
function downgradePersistedFast(model: SandAgentModelSelection): SandAgentModelSelection { return { modelId: model.modelId, maxMode: true, parameters: model.parameters.map((parameter) => ({ id: parameter.id, value: parameter.id === "fast" ? "false" : parameter.value })) }; }

function parseSettings(value: unknown): SandStoredSettings | null {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>; if (raw.version !== SETTINGS_VERSION) return null;
  const base = emptySettings();
  const result: SandStoredSettings = {
    ...base,
    mcpBoxServers: [...new Set(stringArray(raw.mcpBoxServers).filter((name) => name.length > 0))],
    autoUpdateWhenIdleOptIn: raw.autoUpdateWhenIdleOptIn === true,
    egressTunnelEnabled: raw.egressTunnelEnabled === true,
    webauthnProxyEnabled: raw.webauthnProxyEnabled !== false,
    mcpCustomInstructions: normalizeCustomInstructions(stringMap(raw.mcpCustomInstructions)),
    mcpCustomInstructionsByServerId: normalizeCustomInstructionsByServerId(stringMap(raw.mcpCustomInstructionsByServerId)),
    mcpDisabledToolsByServerId: normalizeDisabledToolsByServerId(raw.mcpDisabledToolsByServerId),
    conciergeConsent: raw.conciergeConsent === "allowed" || raw.conciergeConsent === "denied" ? raw.conciergeConsent : "unset",
    settingsMigrations: stringArray(raw.settingsMigrations)
  };
  if (typeof raw.hasSeenOnboarding === "boolean") result.hasSeenOnboarding = raw.hasSeenOnboarding;
  if (typeof raw.hasSeenOnboardingAccountScope === "string" && raw.hasSeenOnboardingAccountScope.length > 0) result.hasSeenOnboardingAccountScope = raw.hasSeenOnboardingAccountScope;
  if (isSandUpdateTrack(raw.updateTrackOverride)) result.updateTrackOverride = raw.updateTrackOverride;
  if (isSandThemePreference(raw.themePreference)) result.themePreference = raw.themePreference;
  if (isUiLanguage(raw.uiLanguage)) result.uiLanguage = raw.uiLanguage;
  if (isSandAgentModelSelection(raw.agentDefaultModel)) result.agentDefaultModel = raw.agentDefaultModel;
  if (isSandAgentModelSelection(raw.computerUseModel)) result.computerUseModel = raw.computerUseModel;
  if (typeof raw.notifications === "object" && raw.notifications != null && !Array.isArray(raw.notifications)) result.notifications = raw.notifications as Record<string, unknown>;
  for (const key of ["userTimeZone", "userTimeZoneOverride", "mcpCustomInstructionsAccountScope"] as const) if (typeof raw[key] === "string" && raw[key].length > 0) result[key] = raw[key];
  if (typeof raw.autoReviewInstructions === "object" && raw.autoReviewInstructions != null) result.autoReviewInstructions = normalizeSandAutoReviewInstructions(raw.autoReviewInstructions as Record<string, unknown>);
  if (isSandLocalToolPermission(raw.localToolPermission)) result.localToolPermission = raw.localToolPermission;
  if (isSandLocalToolPermission(raw.localToolPermissionCeiling)) result.localToolPermissionCeiling = raw.localToolPermissionCeiling;
  if (isSandInferenceProvider(raw.inferenceProvider)) result.inferenceProvider = raw.inferenceProvider;
  const vendors = parseInferenceVendorAccounts(raw.inferenceVendors);
  if (vendors.length > 0) result.inferenceVendors = vendors;
  if (typeof raw.defaultInferenceVendorId === "string" && raw.defaultInferenceVendorId.trim().length > 0) result.defaultInferenceVendorId = raw.defaultInferenceVendorId.trim();
  const inferenceHttp = parseInferenceHttpConfig(raw.inferenceHttp);
  if (inferenceHttp != null) result.inferenceHttp = inferenceHttp;
  if (raw.localAccountActive === true) result.localAccountActive = true;
  if (isSandBoxRuntime(raw.boxRuntime)) result.boxRuntime = raw.boxRuntime;
  if (typeof raw.inferenceRouterUsage === "object" && raw.inferenceRouterUsage != null && !Array.isArray(raw.inferenceRouterUsage)) {
    const usage = emptySandInferenceRouterUsage();
    const rawProviders = (raw.inferenceRouterUsage as { providers?: unknown }).providers;
    if (typeof rawProviders === "object" && rawProviders != null && !Array.isArray(rawProviders)) {
      for (const provider of Object.keys(usage.providers) as SandInferenceProvider[]) {
        const item = (rawProviders as Record<string, unknown>)[provider];
        if (typeof item !== "object" || item == null || Array.isArray(item)) continue;
        const record = item as Record<string, unknown>;
        const count = (key: string): number => Number.isSafeInteger(record[key]) && (record[key] as number) >= 0 ? record[key] as number : 0;
        usage.providers[provider] = { requests: count("requests"), inputTokens: count("inputTokens"), outputTokens: count("outputTokens"), cacheReadTokens: count("cacheReadTokens"), cacheWriteTokens: count("cacheWriteTokens"), lastUsedAt: typeof record.lastUsedAt === "string" ? record.lastUsedAt : null };
      }
    }
    result.inferenceRouterUsage = usage;
  }
  if (Array.isArray(raw.pinnedAgentIds)) result.pinnedAgentIds = [...new Set(stringArray(raw.pinnedAgentIds).filter((id) => id.length > 0))];
  if (Array.isArray(raw.sidebarSections)) result.sidebarSections = SidebarSections.carryFolds({ sections: raw.sidebarSections.filter((entry): entry is SidebarSection => typeof entry === "object" && entry != null && typeof (entry as { id?: unknown }).id === "string" && typeof (entry as { name?: unknown }).name === "string" && Array.isArray((entry as { agentIds?: unknown }).agentIds)) });
  return result;
}

export class SandSettingsStore {
  constructor(readonly settingsPath: string) {}
  load(): SandStoredSettings {
    if (!existsSync(this.settingsPath)) return emptySettings();
    try { const parsed = parseSettings(JSON.parse(readFileSync(this.settingsPath, "utf8")) as unknown); return parsed == null ? emptySettings() : this.applyPendingMigrations(parsed); }
    catch { return emptySettings(); }
  }
  private applyPendingMigrations(settings: SandStoredSettings): SandStoredSettings {
    if (settings.settingsMigrations.includes(SAND_DOWNGRADE_MAX_FAST_MIGRATION_ID)) return settings;
    const migrated = { ...settings, settingsMigrations: [...settings.settingsMigrations, SAND_DOWNGRADE_MAX_FAST_MIGRATION_ID], ...(settings.agentDefaultModel === undefined ? {} : { agentDefaultModel: downgradePersistedFast(settings.agentDefaultModel) }) };
    try { this.persist(migrated); } catch {}
    return migrated;
  }
  persist(settings: SandStoredSettings): void {
    mkdirSync(dirname(this.settingsPath), { recursive: true });
    const payload = JSON.stringify(settings, null, 2);
    const temp = `${this.settingsPath}.${process.pid}.tmp`;
    writeFileSync(temp, payload, "utf8");
    try {
      renameSync(temp, this.settingsPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" && code !== "EXDEV") throw error;
      writeFileSync(this.settingsPath, payload, "utf8");
      try { unlinkSync(temp); } catch { /* The temp file is leftover only when the bind-mounted dest is already updated. */ }
    }
  }
  private update(mutator: (settings: SandStoredSettings) => SandStoredSettings): void { this.persist(mutator(this.load())); }
  getHasSeenOnboarding(): boolean | undefined { return this.load().hasSeenOnboarding; }
  setHasSeenOnboarding(value: boolean): void { this.update((current) => { const { hasSeenOnboardingAccountScope: _old, ...rest } = current; return { ...rest, hasSeenOnboarding: value, ...(rest.mcpCustomInstructionsAccountScope === undefined ? {} : { hasSeenOnboardingAccountScope: rest.mcpCustomInstructionsAccountScope }) }; }); }
  clearHasSeenOnboarding(): void { this.update((current) => { const { hasSeenOnboarding: _seen, hasSeenOnboardingAccountScope: _owner, ...rest } = current; return rest; }); }
  getAutoUpdateWhenIdleOptIn(): boolean { return this.load().autoUpdateWhenIdleOptIn; }
  setAutoUpdateWhenIdleOptIn(value: boolean): void { this.update((s) => ({ ...s, autoUpdateWhenIdleOptIn: value })); }
  getThemePreference(): SandThemePreference { return this.load().themePreference ?? DEFAULT_SAND_THEME_PREFERENCE; }
  setThemePreference(value: SandThemePreference): void { this.update((s) => ({ ...s, themePreference: value })); }
  getUiLanguage(): UiLanguage { return this.load().uiLanguage ?? DEFAULT_UI_LANGUAGE; }
  setUiLanguage(value: UiLanguage): void { this.update((s) => ({ ...s, uiLanguage: value })); }
  getBoxRuntime(): SandBoxRuntime {
    const loaded = this.load();
    if (isSandBoxRuntime(loaded.boxRuntime)) return loaded.boxRuntime;
    return loaded.localAccountActive === true ? "local-docker" : DEFAULT_SAND_BOX_RUNTIME;
  }
  setBoxRuntime(value: SandBoxRuntime): void { this.update((s) => ({ ...s, boxRuntime: value })); }
  getEgressTunnelEnabled(): boolean { return this.load().egressTunnelEnabled; }
  setEgressTunnelEnabled(value: boolean): void { this.update((s) => ({ ...s, egressTunnelEnabled: value })); }
  getWebauthnProxyEnabled(): boolean { return this.load().webauthnProxyEnabled; }
  setWebauthnProxyEnabled(value: boolean): void { this.update((s) => ({ ...s, webauthnProxyEnabled: value })); }
  getAgentDefaultModel(): SandAgentModelSelection | undefined { const model = this.load().agentDefaultModel; return model === undefined ? undefined : { ...model, maxMode: true }; }
  setAgentDefaultModel(model: SandAgentModelSelection | undefined): void { this.update((s) => { const { agentDefaultModel: _old, ...rest } = s; return model === undefined ? rest : { ...rest, agentDefaultModel: { modelId: model.modelId, maxMode: true, parameters: model.parameters.map((p) => ({ ...p })) } }; }); }
  getComputerUseModel(): SandAgentModelSelection | undefined { return this.load().computerUseModel; }
  setComputerUseModel(model: SandAgentModelSelection | undefined): void { this.update((s) => { const { computerUseModel: _old, ...rest } = s; return model === undefined ? rest : { ...rest, computerUseModel: { modelId: model.modelId, maxMode: model.maxMode, parameters: model.parameters.map((p) => ({ ...p })) } }; }); }
  getUpdateTrackOverride(): SandUpdateTrack | null { const stored = this.load().updateTrackOverride ?? null; if (stored == null) return null; const coerced = coerceToEnabledTrack(stored); if (coerced !== stored) { try { this.setUpdateTrackOverride(coerced); } catch {} } return coerced; }
  setUpdateTrackOverride(track: SandUpdateTrack | null): void { this.update((s) => { const { updateTrackOverride: _old, ...rest } = s; return track == null ? rest : { ...rest, updateTrackOverride: track }; }); }
  getMcpCustomInstructions(): StringMap { return this.load().mcpCustomInstructions; }
  setMcpCustomInstructions(value: StringMap): void { this.update((s) => ({ ...s, mcpCustomInstructions: normalizeCustomInstructions(value) })); }
  getMcpCustomInstructionsByServerId(): StringMap { return this.load().mcpCustomInstructionsByServerId; }
  setMcpCustomInstructionsByServerId(value: StringMap): void { this.update((s) => ({ ...s, mcpCustomInstructionsByServerId: normalizeCustomInstructionsByServerId(value) })); }
  getMcpCustomInstructionsAccountScope(): string | undefined { return this.load().mcpCustomInstructionsAccountScope; }
  getMcpDisabledToolsByServerId(): StringListMap { return this.load().mcpDisabledToolsByServerId; }
  setMcpDisabledToolsByServerId(value: StringListMap): void { this.update((s) => ({ ...s, mcpDisabledToolsByServerId: normalizeDisabledToolsByServerId(value) })); }
  scopeToAccount(accountScope: string): void { this.update((current) => { const seen = current.hasSeenOnboarding === undefined || (current.hasSeenOnboardingAccountScope !== undefined && current.hasSeenOnboardingAccountScope !== accountScope) ? {} : { hasSeenOnboarding: current.hasSeenOnboarding, hasSeenOnboardingAccountScope: accountScope }; const { hasSeenOnboarding: _seen, hasSeenOnboardingAccountScope: _owner, ...withoutSeen } = current; if (current.mcpCustomInstructionsAccountScope === undefined || current.mcpCustomInstructionsAccountScope === accountScope) return { ...withoutSeen, ...seen, mcpCustomInstructionsAccountScope: accountScope }; const { autoReviewInstructions: _a, agentDefaultModel: _m, computerUseModel: _c, localToolPermission: _p, localToolPermissionCeiling: _pc, ...rest } = withoutSeen; return { ...rest, ...seen, mcpCustomInstructionsAccountScope: accountScope, mcpCustomInstructions: {}, mcpCustomInstructionsByServerId: {}, mcpDisabledToolsByServerId: {} }; }); }
  clearAccountScope(): void { this.update((current) => { const { mcpCustomInstructionsAccountScope: _scope, autoReviewInstructions: _a, agentDefaultModel: _m, computerUseModel: _c, localToolPermission: _p, localToolPermissionCeiling: _pc, ...rest } = current; return { ...rest, mcpCustomInstructions: {}, mcpCustomInstructionsByServerId: {}, mcpDisabledToolsByServerId: {} }; }); }
  getUserTimeZone(): string | undefined { const s = this.load(); return s.userTimeZoneOverride ?? s.userTimeZone; }
  getDetectedUserTimeZone(): string | undefined { return this.load().userTimeZone; }
  getUserTimeZoneOverride(): string | undefined { return this.load().userTimeZoneOverride; }
  setUserTimeZone(value?: string): void { this.update((s) => { const { userTimeZone: _old, ...rest } = s; const trimmed = value?.trim(); return trimmed == null || trimmed.length === 0 ? rest : { ...rest, userTimeZone: trimmed }; }); }
  setUserTimeZoneOverride(value?: string): void { this.update((s) => { const { userTimeZoneOverride: _old, ...rest } = s; const trimmed = value?.trim(); return trimmed == null || trimmed.length === 0 ? rest : { ...rest, userTimeZoneOverride: trimmed }; }); }
  getMcpBoxServers(): string[] { return this.load().mcpBoxServers; }
  setMcpBoxServers(names: readonly string[]): void { this.update((s) => ({ ...s, mcpBoxServers: [...new Set(names)] })); }
  getRawMcpCustomInstruction(name: string): string | undefined { return this.load().mcpCustomInstructions[name]; }
  getRawMcpCustomInstructionByServerId(id: string): string | undefined { return this.load().mcpCustomInstructionsByServerId[id]; }
  setMcpCustomInstructionByServerId(args: { serverId: string; displayName: string; value: string; mirrorLegacyName: boolean }): void { this.update((s) => { const byId = { ...s.mcpCustomInstructionsByServerId, [args.serverId]: clampMcpCustomInstruction(args.value) }; const legacy = { ...s.mcpCustomInstructions }; if (args.mirrorLegacyName) { const value = clampMcpCustomInstruction(args.value); if (value.trim().length > 0 || getDefaultMcpCustomInstruction(args.displayName).length > 0) legacy[args.displayName] = value; else delete legacy[args.displayName]; } else delete legacy[args.displayName]; return { ...s, mcpCustomInstructionsByServerId: byId, mcpCustomInstructions: legacy }; }); }
  migrateMcpCustomInstructionToServerId(args: { serverId: string; displayName: string }): void { const current = this.load(); if (current.mcpCustomInstructionsByServerId[args.serverId] !== undefined) return; const legacy = current.mcpCustomInstructions[args.displayName]; if (legacy === undefined) return; this.persist({ ...current, mcpCustomInstructionsByServerId: { ...current.mcpCustomInstructionsByServerId, [args.serverId]: legacy } }); }
  deleteMcpCustomInstructionByServerId(args: { serverId: string; displayName: string; deleteLegacyName: boolean }): void { this.update((s) => { const byId = { ...s.mcpCustomInstructionsByServerId }; delete byId[args.serverId]; const legacy = { ...s.mcpCustomInstructions }; if (args.deleteLegacyName) delete legacy[args.displayName]; return { ...s, mcpCustomInstructionsByServerId: byId, mcpCustomInstructions: legacy }; }); }
  setMcpCustomInstruction(name: string, value: string): void { this.update((s) => { const next = { ...s.mcpCustomInstructions }; const clamped = clampMcpCustomInstruction(value); if (clamped.trim().length === 0) { if (getDefaultMcpCustomInstruction(name).length > 0) next[name] = ""; else delete next[name]; } else next[name] = clamped; return { ...s, mcpCustomInstructions: next }; }); }
  deleteMcpCustomInstruction(name: string): void { const current = this.load(); if (!(name in current.mcpCustomInstructions)) return; const next = { ...current.mcpCustomInstructions }; delete next[name]; this.persist({ ...current, mcpCustomInstructions: next }); }
  getNotificationConfig() { const current = this.load(); if (current.notifications?.isEnabled !== false || Object.keys(current.notifications).length !== 1) this.persist({ ...current, notifications: { isEnabled: false } }); return SAND_DISABLED_NOTIFICATION_CONFIG; }
  setNotificationConfig(_input: unknown): void { this.update((s) => ({ ...s, notifications: { isEnabled: false } })); }
  getAutoReviewInstructions(): SandAutoReviewInstructions {
    const loaded = this.load().autoReviewInstructions ?? DEFAULT_SAND_AUTO_REVIEW_INSTRUCTIONS;
    return this.getLocalAccountActive() ? { ...loaded, isEnabled: false } : loaded;
  }
  setAutoReviewInstructions(value: SandAutoReviewInstructions): void { const normalized = normalizeSandAutoReviewInstructions(value); this.update((s) => { const { autoReviewInstructions: _old, ...rest } = s; return normalized.isEnabled && normalized.allowInstructions.length === 0 && normalized.blockInstructions.length === 0 ? rest : { ...rest, autoReviewInstructions: normalized }; }); }
  getLocalToolPermission(): SandLocalToolPermission {
    const s = this.load();
    const fallback = s.localAccountActive === true ? "always" : SAND_DEFAULT_LOCAL_TOOL_PERMISSION;
    return resolveSandLocalToolPermission(s.localToolPermission ?? fallback, s.localToolPermissionCeiling);
  }
  getLocalToolPermissionChoice(): SandLocalToolPermission {
    const s = this.load();
    return s.localToolPermission ?? (s.localAccountActive === true ? "always" : SAND_DEFAULT_LOCAL_TOOL_PERMISSION);
  }
  getLocalToolPermissionCeiling(): SandLocalToolPermission | undefined { return this.load().localToolPermissionCeiling; }
  setLocalToolPermission(value: SandLocalToolPermission): void { this.update((s) => ({ ...s, localToolPermission: value })); }
  getInferenceProvider(): SandInferenceProvider { return this.load().inferenceProvider ?? "cursor"; }
  setInferenceProvider(value: SandInferenceProvider): void { this.update((s) => ({ ...s, inferenceProvider: value })); }
  getInferenceHttp(): InferenceHttpConfig | undefined { return this.load().inferenceHttp; }
  setInferenceHttp(value: InferenceHttpConfig | undefined): void { this.update((s) => { const { inferenceHttp: _old, ...rest } = s; return value == null ? rest : { ...rest, inferenceHttp: { baseUrl: value.baseUrl, modelId: value.modelId } }; }); }
  getInferenceVendors(): InferenceVendorAccount[] {
    const loaded = this.load();
    if ((loaded.inferenceVendors ?? []).length > 0) return loaded.inferenceVendors ?? [];
    const provider = loaded.inferenceProvider;
    if (!isHttpInferenceVendor(provider)) return [];
    const http = loaded.inferenceHttp;
    const preset = vendorPreset(provider);
    const id = "legacy";
    return [{ id, label: preset.label, provider, baseUrl: http?.baseUrl || preset.defaultBaseUrl, modelId: http?.modelId || preset.defaultModelId, secretKey: preset.secretKey }];
  }
  setInferenceVendors(vendors: readonly InferenceVendorAccount[]): void {
    this.update((s) => {
      const next = [...vendors];
      const { defaultInferenceVendorId: _old, ...rest } = s;
      const defaultInferenceVendorId = next.some((item) => item.id === s.defaultInferenceVendorId) ? s.defaultInferenceVendorId : next[0]?.id;
      return defaultInferenceVendorId == null
        ? { ...rest, inferenceVendors: next }
        : { ...rest, inferenceVendors: next, defaultInferenceVendorId };
    });
  }
  getDefaultInferenceVendorId(): string | undefined {
    const vendors = this.getInferenceVendors();
    const loaded = this.load().defaultInferenceVendorId;
    if (loaded != null && vendors.some((item) => item.id === loaded)) return loaded;
    return vendors[0]?.id;
  }
  setDefaultInferenceVendorId(id: string): void { this.update((s) => ({ ...s, defaultInferenceVendorId: id })); }
  getInferenceVendor(id: string | undefined): InferenceVendorAccount | undefined {
    if (id == null || id.length === 0) {
      const fallback = this.getDefaultInferenceVendorId();
      return fallback == null ? undefined : this.getInferenceVendors().find((item) => item.id === fallback);
    }
    return this.getInferenceVendors().find((item) => item.id === id);
  }
  getLocalAccountActive(): boolean { return this.load().localAccountActive === true; }
  setLocalAccountActive(value: boolean): void { this.update((s) => { const { localAccountActive: _old, ...rest } = s; return value ? { ...rest, localAccountActive: true } : rest; }); }
  getInferenceRouterUsage(): SandInferenceRouterUsage { return this.load().inferenceRouterUsage ?? emptySandInferenceRouterUsage(); }
  recordInferenceUsage(provider: SandInferenceProvider, usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }): void {
    const safe = (value: number | undefined): number => Number.isFinite(value) && value! >= 0 ? Math.round(value!) : 0;
    this.update((settings) => {
      const current = settings.inferenceRouterUsage ?? emptySandInferenceRouterUsage();
      const empty = (): SandInferenceRouterUsage["providers"][SandInferenceProvider] => ({ requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, lastUsedAt: null });
      const previous = current.providers[provider] ?? empty();
      return { ...settings, inferenceRouterUsage: { schemaVersion: 1, providers: { ...current.providers, [provider]: { requests: previous.requests + 1, inputTokens: previous.inputTokens + safe(usage.inputTokens), outputTokens: previous.outputTokens + safe(usage.outputTokens), cacheReadTokens: previous.cacheReadTokens + safe(usage.cacheReadTokens), cacheWriteTokens: previous.cacheWriteTokens + safe(usage.cacheWriteTokens), lastUsedAt: new Date().toISOString() } } } };
    });
  }
  setLocalToolPermissionCeiling(value?: SandLocalToolPermission): void { this.update((s) => { const { localToolPermissionCeiling: _old, ...rest } = s; return value === undefined ? rest : { ...rest, localToolPermissionCeiling: value }; }); }
  getPinnedAgentIds(): string[] | undefined { return this.load().pinnedAgentIds; }
  setPinnedAgentIds(ids: readonly string[]): void { this.update((s) => ({ ...s, pinnedAgentIds: [...new Set(ids)] })); }
  static storable(args: { sections: readonly SidebarSection[]; stored?: readonly SidebarSection[] }): SidebarSection[] { return SidebarSections.carryFolds(args).map((s) => ({ id: s.id, name: s.name, agentIds: [...s.agentIds], isCollapsed: s.isCollapsed ?? false })); }
  getSidebarSections(): SidebarSection[] | undefined { const stored = this.load().sidebarSections; return stored === undefined ? undefined : SidebarSections.carryFolds({ sections: stored }); }
  setSidebarSections(sections: readonly SidebarSection[]): void { this.update((s) => ({ ...s, sidebarSections: SandSettingsStore.storable(s.sidebarSections === undefined ? { sections } : { sections, stored: s.sidebarSections }) })); }
}
