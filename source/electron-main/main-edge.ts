import { isSandAgentModelSelection, resolveComputerUseModelSelection } from "../shared/agents/sand-agent-model.js";
import { normalizeSandAutoReviewInstructions } from "../shared/sand-auto-review-instructions.js";
import { isSandLocalToolAction, normalizeSandLocalToolPermission } from "../shared/local-tool-permission.js";
import { isSandThemePreference } from "../shared/desktop.js";
import { isSandUpdateTrack } from "../shared/update-track.js";
import { isValidIanaTimeZone } from "../shared/timezone.js";
import { sandWebauthnProxyMirroredEnablement } from "../shared/webauthn-proxy-availability.js";
import { reportDesktopEdgeFailure } from "./desktop-edge-failures.js";
import { isSandInferenceProvider } from "../shared/inference-router.js";
import { isCursorlessProvider, isHttpInferenceVendor, parseInferenceVendorAccount, parseInferenceVendorAccounts, resolveVendorHttpConfig, vendorAccountSecretKey, vendorPreset, type InferenceVendorAccount } from "../shared/inference-vendor.js";
import { parseUiLanguage } from "../shared/ui-language.js";
import { persistVendorSecret, readPersistedVendorSecrets } from "../shared/node/vendor-secrets.js";
import { getLocalInferenceCliStatus } from "../shared/node/inference-router-local.js";
import { isSandBoxRuntime } from "../shared/box-runtime.js";
import { getLocalDockerStatus, startLocalDockerBox, stopLocalDockerBox } from "./box/local-docker-host-connector.js";
import { requestApplicationMenuRebuild } from "./application-menu.js";
import { dirname, join } from "node:path";

export const MAIN_EDGE_UNSERVED = "main/unserved-method";
export const MAIN_EDGE_UPDATE_UNAVAILABLE = "main/update-unavailable";
export const MAIN_EDGE_THEME_UNAVAILABLE = "main/theme-unavailable";
export const MAIN_EDGE_EGRESS_TUNNEL_UNAVAILABLE = "main/egress-tunnel-unavailable";

type UnknownRecord = Record<string, unknown>;
type Handler = (request: UnknownRecord) => unknown;
type HandlerMap = Record<string, Handler>;
export type ServedMainEdgeHandlerMap = Record<string, {
  readonly trust: "appWindow";
  readonly run: (request: UnknownRecord, sender?: unknown) => unknown;
}>;

export class EdgeCallFailure extends Error {
  readonly code: string;
  readonly detail: string;
  constructor(args: { readonly code: string; readonly detail: string }) { super(`${args.code}: ${args.detail}`); this.name = "EdgeCallFailure"; this.code = args.code; this.detail = args.detail; }
}
export class SandHostSettingsUnreachableError extends Error {}

export interface MainEdgeDeps {
  readonly readLiveUpdateService: () => UnknownRecord | null;
  readonly readThemeController: () => UnknownRecord | null;
  readonly readEgressTunnelController: () => UnknownRecord | null;
  readonly settingsStore: UnknownRecord;
  readonly agentPrefsStore: UnknownRecord;
  readonly boxToggleStore: UnknownRecord;
  readonly onboardingSeen: UnknownRecord;
  readonly shell: UnknownRecord;
  readonly boxRecovery: UnknownRecord;
  readonly windowChrome: UnknownRecord;
  readonly avatarImages: UnknownRecord;
  readonly attachments: UnknownRecord;
  readonly cursorAccount: UnknownRecord;
  readonly experiments: UnknownRecord;
  readonly syncHostSettingsToBox: (settings: UnknownRecord) => Promise<UnknownRecord | null>;
  readonly readHostSettingsFromBox: () => Promise<UnknownRecord>;
  readonly recordLocalToolApproval: (approval: { id: string; action: string; target: string }) => Promise<void>;
  readonly clearLocalToolApprovals: () => Promise<void>;
  readonly getComputerUseModelOverride: () => unknown;
  readonly fetchAvailableModels: () => unknown;
  readonly emitEgressTunnelChanged: (enabled: boolean) => void;
  readonly emitWebauthnProxyChanged: (enabled: boolean) => void;
  readonly ensureTranscriptionManager: () => Promise<UnknownRecord>;
  readonly platform: NodeJS.Platform;
  readonly delay?: (milliseconds: number) => Promise<void>;
  readonly detectTimeZone?: () => string | null | undefined;
}

function invariant(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function invoke(target: UnknownRecord, method: string, ...args: unknown[]): unknown { const fn = target[method]; invariant(typeof fn === "function", `Missing main-edge dependency method ${method}.`); return Reflect.apply(fn, target, args); }
function req(value: unknown): UnknownRecord { return typeof value === "object" && value != null && !Array.isArray(value) ? value as UnknownRecord : {}; }
function detectTimeZone(): string | null { const value = Intl.DateTimeFormat().resolvedOptions().timeZone; return value.length > 0 ? value : null; }
const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function createMainEdgeTrust() { return { appWindow: { kind: "require" as const, test: (sender: { isAppWindowTopFrame?: boolean }) => sender.isAppWindowTopFrame === true, denial: "The main edge is only accessible from the Sand app window's top frame." } }; }
export const unserved = (): never => { throw new EdgeCallFailure({ code: MAIN_EDGE_UNSERVED, detail: "This method still rides its hand-wired preload channel." }); };
function required(read: () => UnknownRecord | null, code: string, detail: string): UnknownRecord { const value = read(); if (value == null) throw new EdgeCallFailure({ code, detail }); return value; }
function updateService(deps: MainEdgeDeps) { return required(deps.readLiveUpdateService, MAIN_EDGE_UPDATE_UNAVAILABLE, "The update service is not running."); }
function themeController(deps: MainEdgeDeps) { return required(deps.readThemeController, MAIN_EDGE_THEME_UNAVAILABLE, "The theme controller is not running."); }
function egressController(deps: MainEdgeDeps) { return required(deps.readEgressTunnelController, MAIN_EDGE_EGRESS_TUNNEL_UNAVAILABLE, "The egress tunnel controller is not running."); }
async function echo(deps: MainEdgeDeps, field: string, value: unknown, label: string): Promise<unknown> { const result = await deps.syncHostSettingsToBox({ [field]: value }); if (result == null) throw new SandHostSettingsUnreachableError(`Couldn't reach the computer to save ${label}.`); return result[field] ?? null; }
function computerUseModel(deps: MainEdgeDeps): unknown { const stored = invoke(deps.agentPrefsStore, "getComputerUseModel"); const override = deps.getComputerUseModelOverride(); return resolveComputerUseModelSelection({ ...(isSandAgentModelSelection(stored) ? { storedModel: stored } : {}), ...(isSandAgentModelSelection(override) ? { overrideModel: override } : {}) }) ?? null; }
function parseAgentModel(value: unknown, requireNonWhitespaceId: boolean): { modelId: string; maxMode: boolean; parameters: { id: string; value: string }[] } | null {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return null;
  const record = value as UnknownRecord;
  if (typeof record.modelId !== "string" || record.modelId.length === 0 || (requireNonWhitespaceId && record.modelId.trim().length === 0) || typeof record.maxMode !== "boolean" || !Array.isArray(record.parameters)) return null;
  const parameters: { id: string; value: string }[] = [];
  for (const raw of record.parameters) { if (typeof raw !== "object" || raw == null || Array.isArray(raw)) return null; const parameter = raw as UnknownRecord; if (typeof parameter.id !== "string" || parameter.id.length === 0 || typeof parameter.value !== "string") return null; parameters.push({ id: parameter.id, value: parameter.value }); }
  return { modelId: record.modelId, maxMode: record.maxMode, parameters };
}

export function createMainEdgeHandlers(deps: MainEdgeDeps): HandlerMap {
  const handlers: HandlerMap = {
    getUpdateStatus: () => invoke(updateService(deps), "getStatus"),
    checkForUpdates: () => invoke(updateService(deps), "checkForUpdates", { trigger: "explicit" }),
    setUpdateTrack: (raw) => { const { track } = req(raw); const service = updateService(deps); return track === null ? invoke(service, "setTrackOverride", null) : isSandUpdateTrack(track) ? invoke(service, "setTrackOverride", track) : invoke(service, "getStatus"); },
    quitAndInstallUpdate: () => { invoke(updateService(deps), "quitAndInstall"); },
    setAutoUpdateWhenIdleOptIn: (raw) => invoke(updateService(deps), "setAutoUpdateWhenIdleOptIn", req(raw).enabled === true),

    getTimeZone: () => ({ detectedTimeZone: (deps.detectTimeZone ?? detectTimeZone)() ?? null, overrideTimeZone: invoke(deps.settingsStore, "getUserTimeZoneOverride") ?? null }),
    setTimeZoneOverride: (raw) => { const { timeZone } = req(raw); if (timeZone === null) invoke(deps.settingsStore, "setUserTimeZoneOverride", undefined); else if (typeof timeZone === "string" && isValidIanaTimeZone(timeZone)) invoke(deps.settingsStore, "setUserTimeZoneOverride", timeZone); const detected = (deps.detectTimeZone ?? detectTimeZone)(); void deps.syncHostSettingsToBox({ ...(detected == null ? {} : { userTimeZone: detected }), userTimeZoneOverride: invoke(deps.settingsStore, "getUserTimeZoneOverride") ?? "" }); return { detectedTimeZone: (deps.detectTimeZone ?? detectTimeZone)() ?? null, overrideTimeZone: invoke(deps.settingsStore, "getUserTimeZoneOverride") ?? null }; },
    getAutoReviewInstructions: () => invoke(deps.settingsStore, "getAutoReviewInstructions"),
    setAutoReviewInstructions: async (raw) => { const value = req(raw).instructions; const instructions = typeof value === "object" && value != null && !Array.isArray(value) ? value as { isEnabled?: unknown; allowInstructions?: unknown; blockInstructions?: unknown } : undefined; const normalized = normalizeSandAutoReviewInstructions(instructions); invoke(deps.settingsStore, "setAutoReviewInstructions", normalized); try { await deps.syncHostSettingsToBox({ autoReviewInstructions: normalized }); } catch (error) { reportDesktopEdgeFailure("host-settings", "auto-review", error); } return invoke(deps.settingsStore, "getAutoReviewInstructions"); },
    getLocalToolPermission: () => invoke(deps.settingsStore, "getLocalToolPermission"),
    getLocalToolPermissionCeiling: () => invoke(deps.settingsStore, "getLocalToolPermissionCeiling") ?? null,
    setLocalToolPermission: async (raw) => { invoke(deps.settingsStore, "setLocalToolPermission", normalizeSandLocalToolPermission(req(raw).permission)); for (let attempt = 0; attempt < 3; attempt += 1) { const permission = invoke(deps.settingsStore, "getLocalToolPermission"); try { const applied = await deps.syncHostSettingsToBox({ localToolPermission: permission }); if (applied?.localToolPermission === permission) break; } catch (error) { reportDesktopEdgeFailure("host-settings", "local-tool-retry", error); } await (deps.delay ?? sleep)(250 * (attempt + 1)); } return invoke(deps.settingsStore, "getLocalToolPermission"); },
    recordLocalToolApproval: async (raw) => { const { approvalId, action, target } = req(raw); invariant(typeof approvalId === "string" && approvalId.length > 0 && isSandLocalToolAction(action) && typeof target === "string", "A local-tool approval needs its request id and action."); await deps.recordLocalToolApproval({ id: approvalId, action, target }); },
    clearLocalToolApprovals: async () => { await deps.clearLocalToolApprovals().catch((error: unknown) => reportDesktopEdgeFailure("local-tool-approvals", "clear", error)); },

    getThemeState: () => invoke(themeController(deps), "getState"),
    setThemePreference: (raw) => { const controller = themeController(deps); const preference = req(raw).preference; return isSandThemePreference(preference) ? invoke(controller, "setPreference", preference) : invoke(controller, "getState"); },
    getAgentDefaultModel: async () => { const settings = await deps.readHostSettingsFromBox(); invoke(deps.agentPrefsStore, "setAgentDefaultModel", settings.agentDefaultModel); return settings.agentDefaultModel ?? null; },
    setAgentDefaultModel: async (raw) => { const model = parseAgentModel(req(raw).model, false); if (model == null) return invoke(deps.agentPrefsStore, "getAgentDefaultModel") ?? null; const result = await deps.syncHostSettingsToBox({ agentDefaultModel: model }); if (result == null) throw new SandHostSettingsUnreachableError("Couldn't reach the computer to save the default model."); invoke(deps.agentPrefsStore, "setAgentDefaultModel", result.agentDefaultModel); return result.agentDefaultModel ?? null; },
    getComputerUseModel: () => computerUseModel(deps),
    setComputerUseModel: (raw) => { const requested = req(raw).model; const model = requested === null ? null : parseAgentModel(requested, true); if (requested === null || model != null) { invoke(deps.agentPrefsStore, "setComputerUseModel", model ?? undefined); void deps.syncHostSettingsToBox({ computerUseModel: invoke(deps.agentPrefsStore, "getComputerUseModel") ?? null }); } return computerUseModel(deps); },
    getHostPinnedAgents: async () => (await deps.readHostSettingsFromBox()).pinnedAgentIds ?? null,
    setHostPinnedAgents: (raw) => echo(deps, "pinnedAgentIds", req(raw).pinnedAgentIds, "pinned agents"),
    getHostSidebarSections: async () => (await deps.readHostSettingsFromBox()).sidebarSections ?? null,
    setHostSidebarSections: (raw) => echo(deps, "sidebarSections", req(raw).sections, "sidebar sections"),
    getAvailableModels: () => deps.fetchAvailableModels(),
    getUiLanguage: () => ({ language: invoke(deps.settingsStore, "getUiLanguage") }),
    setUiLanguage: (raw) => {
      const language = parseUiLanguage(req(raw).language);
      invoke(deps.settingsStore, "setUiLanguage", language);
      requestApplicationMenuRebuild(language);
      return { language };
    },
    getInferenceVendors: () => {
      const vendors = parseInferenceVendorAccounts(invoke(deps.settingsStore, "getInferenceVendors"));
      const defaultVendorId = invoke(deps.settingsStore, "getDefaultInferenceVendorId");
      return { vendors, defaultVendorId: typeof defaultVendorId === "string" ? defaultVendorId : vendors[0]?.id ?? null };
    },
    upsertInferenceVendor: (raw) => {
      const request = req(raw);
      const provider = request.provider;
      invariant(isHttpInferenceVendor(provider), "Unknown inference vendor.");
      const id = typeof request.id === "string" && request.id.trim().length > 0 ? request.id.trim() : `v${Date.now().toString(36)}`;
      const http = resolveVendorHttpConfig(provider, { baseUrl: typeof request.baseUrl === "string" ? request.baseUrl : "", modelId: typeof request.modelId === "string" ? request.modelId : "" });
      const preset = vendorPreset(provider);
      const secretKey = typeof request.secretKey === "string" && request.secretKey.trim().length > 0 ? request.secretKey.trim() : vendorAccountSecretKey(id);
      const account = parseInferenceVendorAccount({
        id,
        label: typeof request.label === "string" ? request.label : preset.label,
        provider,
        baseUrl: http.baseUrl,
        modelId: http.modelId,
        secretKey,
      });
      invariant(account != null, "Invalid vendor account.");
      if (http.baseUrl.length === 0 || http.modelId.length === 0) throw new Error("This vendor needs a Base URL and model ID.");
      const settingsPath = String(Reflect.get(deps.settingsStore, "settingsPath"));
      const secretsPath = join(dirname(settingsPath), "box-secrets.json");
      const apiKey = typeof request.apiKey === "string" ? request.apiKey.trim() : "";
      if (apiKey.length > 0) persistVendorSecret(secretsPath, account.secretKey, apiKey);
      else if ((readPersistedVendorSecrets(secretsPath)[account.secretKey] ?? "").length === 0 && (readPersistedVendorSecrets(secretsPath)[preset.secretKey] ?? "").length === 0) {
        throw new Error(`${account.label} needs an API key.`);
      }
      const vendors = parseInferenceVendorAccounts(invoke(deps.settingsStore, "getInferenceVendors"));
      const index = vendors.findIndex((item: InferenceVendorAccount) => item.id === account.id);
      if (index >= 0) vendors[index] = account; else vendors.push(account);
      invoke(deps.settingsStore, "setInferenceVendors", vendors);
      if (request.makeDefault === true || invoke(deps.settingsStore, "getDefaultInferenceVendorId") == null) invoke(deps.settingsStore, "setDefaultInferenceVendorId", account.id);
      invoke(deps.settingsStore, "setInferenceProvider", account.provider);
      invoke(deps.settingsStore, "setInferenceHttp", { baseUrl: account.baseUrl, modelId: account.modelId });
      invoke(deps.settingsStore, "setLocalAccountActive", true);
      invoke(deps.settingsStore, "setHasSeenOnboarding", true);
      invoke(deps.settingsStore, "setLocalToolPermission", "always");
      invoke(deps.settingsStore, "setAutoReviewInstructions", { isEnabled: false, allowInstructions: [], blockInstructions: [] });
      if (invoke(deps.settingsStore, "getBoxRuntime") !== "local-docker") invoke(deps.settingsStore, "setBoxRuntime", "local-docker");
      void Promise.resolve(invoke(deps.onboardingSeen, "apply", true));
      void deps.syncHostSettingsToBox({
        inferenceProvider: account.provider,
        inferenceHttp: { baseUrl: account.baseUrl, modelId: account.modelId },
        inferenceVendors: vendors,
        defaultInferenceVendorId: invoke(deps.settingsStore, "getDefaultInferenceVendorId"),
        localAccountActive: true,
      }).catch(() => null);
      return { vendors, defaultVendorId: invoke(deps.settingsStore, "getDefaultInferenceVendorId") };
    },
    deleteInferenceVendor: (raw) => {
      const id = String(req(raw).id ?? "");
      const vendors = parseInferenceVendorAccounts(invoke(deps.settingsStore, "getInferenceVendors")).filter((item) => item.id !== id);
      invoke(deps.settingsStore, "setInferenceVendors", vendors);
      return { vendors, defaultVendorId: invoke(deps.settingsStore, "getDefaultInferenceVendorId") };
    },
    getInferenceRouter: async () => { const settings = await deps.readHostSettingsFromBox().catch(() => ({} as UnknownRecord)); const provider = invoke(deps.settingsStore, "getInferenceProvider"); const http = invoke(deps.settingsStore, "getInferenceHttp"); return { provider: isSandInferenceProvider(provider) ? provider : "cursor", usage: settings.inferenceRouterUsage ?? invoke(deps.settingsStore, "getInferenceRouterUsage") ?? null, local: getLocalInferenceCliStatus(), http: http ?? null }; },
    setInferenceRouter: async (raw) => {
      const request = req(raw);
      const provider = request.provider;
      invariant(isSandInferenceProvider(provider), "Unknown inference provider.");
      const settingsPath = String(Reflect.get(deps.settingsStore, "settingsPath"));
      const secretsPath = join(dirname(settingsPath), "box-secrets.json");
      if (isHttpInferenceVendor(provider)) {
        const apiKey = typeof request.apiKey === "string" ? request.apiKey.trim() : "";
        const http = resolveVendorHttpConfig(provider, { baseUrl: typeof request.baseUrl === "string" ? request.baseUrl : "", modelId: typeof request.modelId === "string" ? request.modelId : "" });
        if (http.baseUrl.length === 0 || http.modelId.length === 0) throw new Error("This vendor needs a Base URL and model ID.");
        const secretKey = vendorPreset(provider).secretKey;
        if (apiKey.length > 0) persistVendorSecret(secretsPath, secretKey, apiKey);
        else if ((readPersistedVendorSecrets(secretsPath)[secretKey] ?? "").length === 0 && (process.env[secretKey] ?? "").trim().length === 0) {
          throw new Error(`${vendorPreset(provider).label} needs ${secretKey}. Add it in Settings.`);
        }
        invoke(deps.settingsStore, "setInferenceHttp", http);
        const vendors = parseInferenceVendorAccounts(invoke(deps.settingsStore, "getInferenceVendors"));
        const existing = vendors.find((item) => item.provider === provider && item.baseUrl === http.baseUrl && item.modelId === http.modelId);
        if (existing == null) {
          const id = `v${Date.now().toString(36)}`;
          const preset = vendorPreset(provider);
          const accountKey = vendorAccountSecretKey(id);
          if (apiKey.length > 0) persistVendorSecret(secretsPath, accountKey, apiKey);
          vendors.push({ id, label: preset.label, provider, baseUrl: http.baseUrl, modelId: http.modelId, secretKey: accountKey });
          invoke(deps.settingsStore, "setInferenceVendors", vendors);
          invoke(deps.settingsStore, "setDefaultInferenceVendorId", id);
        }
      }
      invoke(deps.settingsStore, "setInferenceProvider", provider);
      if (isCursorlessProvider(provider)) {
        invoke(deps.settingsStore, "setLocalAccountActive", true);
        invoke(deps.settingsStore, "setHasSeenOnboarding", true);
        invoke(deps.settingsStore, "setLocalToolPermission", "always");
        invoke(deps.settingsStore, "setAutoReviewInstructions", { isEnabled: false, allowInstructions: [], blockInstructions: [] });
        if (invoke(deps.settingsStore, "getBoxRuntime") !== "local-docker") invoke(deps.settingsStore, "setBoxRuntime", "local-docker");
        void Promise.resolve(invoke(deps.onboardingSeen, "apply", true));
        if (typeof Reflect.get(deps.cursorAccount, "syncPresentedAuth") === "function") await invoke(deps.cursorAccount, "syncPresentedAuth");
      }
      const settings = await deps.syncHostSettingsToBox({
        inferenceProvider: provider,
        inferenceHttp: invoke(deps.settingsStore, "getInferenceHttp") ?? null,
        localAccountActive: invoke(deps.settingsStore, "getLocalAccountActive") === true,
      }).catch(() => null);
      return { provider, usage: settings?.inferenceRouterUsage ?? invoke(deps.settingsStore, "getInferenceRouterUsage") ?? null, local: getLocalInferenceCliStatus(), http: invoke(deps.settingsStore, "getInferenceHttp") ?? null };
    },
    getBoxRuntime: async () => { const mode = invoke(deps.settingsStore, "getBoxRuntime"); invariant(isSandBoxRuntime(mode), "Unknown box runtime."); return { mode, status: await getLocalDockerStatus(String(Reflect.get(deps.settingsStore, "settingsPath"))) }; },
    setBoxRuntime: async (raw) => { const mode = req(raw).mode; invariant(isSandBoxRuntime(mode), "Unknown box runtime."); const settingsPath = String(Reflect.get(deps.settingsStore, "settingsPath")); invoke(deps.settingsStore, "setBoxRuntime", mode); try { if (mode === "local-docker") await startLocalDockerBox(settingsPath); else await stopLocalDockerBox(); } catch (error) { invoke(deps.settingsStore, "setBoxRuntime", mode === "local-docker" ? "remote" : "local-docker"); throw error; } invoke(deps.boxRecovery, "restartCoordinator"); return { mode, status: await getLocalDockerStatus(settingsPath) }; },

    getEgressTunnelEnabled: () => invoke(deps.boxToggleStore, "getEgressTunnelEnabled"),
    setEgressTunnelEnabled: (raw) => { const enabled = req(raw).enabled === true; invoke(deps.boxToggleStore, "setEgressTunnelEnabled", enabled); invoke(egressController(deps), "setEnabled", enabled); deps.emitEgressTunnelChanged(enabled); return enabled; },
    getEgressTunnelStatus: () => invoke(egressController(deps), "getStatus"),
    getWebauthnProxyEnabled: () => invoke(deps.boxToggleStore, "getWebauthnProxyEnabled"),
    setWebauthnProxyEnabled: async (raw) => { const enabled = req(raw).enabled === true; invoke(deps.boxToggleStore, "setWebauthnProxyEnabled", enabled); deps.emitWebauthnProxyChanged(enabled); const mirrored = sandWebauthnProxyMirroredEnablement(enabled, deps.platform); for (let attempt = 0; attempt < 3; attempt += 1) { const applied = await deps.syncHostSettingsToBox({ webauthnProxyEnabled: mirrored }); if (applied?.webauthnProxyEnabled === mirrored) break; await (deps.delay ?? sleep)(250 * (attempt + 1)); } return invoke(deps.boxToggleStore, "getWebauthnProxyEnabled"); },
    getOnboardingSeen: async () => await Promise.resolve(invoke(deps.onboardingSeen, "reconcile")) === true,
    setOnboardingSeen: (raw) => { const seen = req(raw).seen; if (typeof seen === "boolean") void Promise.resolve(invoke(deps.onboardingSeen, "apply", seen)); },

    openExternal: (raw) => invoke(deps.shell, "openExternalUrl", req(raw).url),
    openCloudAgent: async (raw) => { const bcId = typeof req(raw).bcId === "string" ? (req(raw).bcId as string).trim() : ""; if (bcId.length === 0) return; const base = process.env.SAND_CURSOR_WEBSITE_URL?.trim() || process.env.CURSOR_WEBSITE_URL?.trim() || "https://cursor.com"; await Promise.resolve(invoke(deps.shell, "openInSystemBrowser", new URL(`/agents/${encodeURIComponent(bcId)}`, base).toString())); },
    submitFeedback: (raw) => invoke(deps.shell, "submitFeedback", raw),
    markDeepLinksReady: () => { invoke(deps.shell, "markDeepLinksReady"); },
    getBoxMigrationStatus: () => invoke(deps.boxRecovery, "readBoxMigrationStatus"),
    forceReconnectGateway: () => { invoke(deps.boxRecovery, "restartCoordinator"); },
    forceRecreateComputer: () => invoke(deps.boxRecovery, "forceRecreateComputer"),
    updateComputer: async (raw) => { const { id } = req(raw); invariant(typeof id === "string", "A computer update names the agent by its string id."); const force = req(raw).force === true; const result = req(await Promise.resolve(invoke(deps.boxRecovery, "recreateComputer", { preserveData: true, force }))); if (result.status !== "dev-fallback") return result; await Promise.resolve(invoke(deps.boxRecovery, "updateForeverBox", { id, force })); return { status: "dev-fallback-finished" }; },

    getWindowState: () => invoke(deps.windowChrome, "getWindowState"), minimizeWindow: () => { invoke(deps.windowChrome, "minimize"); }, toggleMaximizeWindow: () => { invoke(deps.windowChrome, "toggleMaximize"); }, closeWindow: () => { invoke(deps.windowChrome, "close"); },
    setTitleBarOverlayTone: (raw) => { invoke(deps.windowChrome, "setTitleBarOverlayTone", req(raw).isOverlayTone === true); },
    resizeWindowWidth: (raw) => { const delta = req(raw).deltaWidth; return typeof delta === "number" && Number.isFinite(delta) && delta !== 0 ? invoke(deps.windowChrome, "resizeWidth", delta) : 0; },
    pickAvatarSource: () => invoke(deps.avatarImages, "pickSource"), pickAvatarFile: () => invoke(deps.avatarImages, "pickFile"), generateAgentAvatarImage: (raw) => invoke(deps.avatarImages, "generateImage", req(raw).description),
    resolveAttachmentMedia: (raw) => invoke(deps.attachments, "resolveMedia", req(raw).source), readAttachmentText: (raw) => invoke(deps.attachments, "readText", req(raw).path), readAttachmentBytes: (raw) => invoke(deps.attachments, "readBytes", req(raw).path, req(raw).maxBytes), stageAttachmentBytes: (raw) => invoke(deps.attachments, "stageBytes", req(raw).filename, req(raw).bytes), downloadAttachment: (raw) => invoke(deps.attachments, "download", req(raw).path, req(raw).suggestedName), commitStagedAttachments: (raw) => invoke(deps.attachments, "commitStaged", req(raw).paths, req(raw).filenames), discardStagedAttachment: (raw) => invoke(deps.attachments, "discardStaged", req(raw).path), getLinkMetadata: (raw) => invoke(deps.attachments, "getLinkMetadata", req(raw).url),
    getCursorAuthStatus: () => invoke(deps.cursorAccount, "getAuthStatus"), loginCursor: () => invoke(deps.cursorAccount, "login"), cancelCursorLogin: () => invoke(deps.cursorAccount, "cancelLogin"), logoutCursor: async () => { invoke(deps.settingsStore, "setLocalAccountActive", false); return await invoke(deps.cursorAccount, "logout"); }, updateCursorAccountName: (raw) => invoke(deps.cursorAccount, "updateAccountName", req(raw).name), getCursorAvatar: () => invoke(deps.cursorAccount, "getAvatar"), getCursorWeeklyUsage: () => invoke(deps.cursorAccount, "getWeeklyUsage"), getCursorUsageSummary: () => invoke(deps.cursorAccount, "getUsageSummary"), getCursorPrReviewPreferences: () => invoke(deps.cursorAccount, "getPrReviewPreferences"), getCursorPrivacyModeEnabled: () => invoke(deps.cursorAccount, "getPrivacyModeEnabled"), getSandAccess: () => invoke(deps.cursorAccount, "getSandAccess"), getSandAccessFresh: () => invoke(deps.cursorAccount, "getSandAccessFresh"), invokeCursorDashboardAction: (raw) => invoke(deps.cursorAccount, "invokeDashboardAction", raw), cancelCursorSandTrial: () => invoke(deps.cursorAccount, "cancelTrial"),
    transcribeAudio: async (raw) => { const request = req(raw); const audio = request.audio instanceof Uint8Array ? request.audio : request.audio instanceof ArrayBuffer ? new Uint8Array(request.audio) : null; invariant(audio != null && audio.length > 0, "transcribeAudio requires non-empty audio bytes."); const mimeType = typeof request.mimeType === "string" && request.mimeType.length > 0 ? request.mimeType : "audio/webm"; const language = typeof request.language === "string" && request.language.length > 0 ? request.language : undefined; const manager = await deps.ensureTranscriptionManager(); return await Promise.resolve(invoke(manager, "transcribe", { audio, mimeType, ...(language === undefined ? {} : { language }) })); },
    getExperimentsSnapshot: async () => invoke(req(await Promise.resolve(invoke(deps.experiments, "ensureService"))), "getSnapshot"),
    applyFeatureFlagOverride: async (raw) => { const service = req(await Promise.resolve(invoke(deps.experiments, "ensureService"))); invoke(service, "applyFeatureFlagOverrideCommand", req(raw).command); },
    refreshFeatureFlags: async () => { const service = req(await Promise.resolve(invoke(deps.experiments, "ensureService"))); await Promise.resolve(invoke(service, "refreshNow")); },
    startRpcTraceWindow: async () => { const service = req(await Promise.resolve(invoke(deps.experiments, "ensureService"))); const snapshot = req(invoke(service, "getSnapshot")); if (snapshot.featureFlags == null || invoke(deps.experiments, "isTelemetryDisabled") === true) return false; return invoke(deps.experiments, "startRpcTraceWindow"); },
  };
  for (const name of ["getDesktopEnvironment", "getSidebarCollapsed", "setSidebarCollapsed", "reportAgentLoad", "reportAccessBlocked", "reportAgentsUnreachable", "reportRecoveryAction", "reportRebuildLifecycle", "reportReconciliation", "reportBoxVisibility", "reportSendLatency", "reportSendAck", "reportReactionAck", "reportRenderTtfr", "reportRenderStream", "reportVncSession", "reportVncLiveness", "reportOpenComputer", "reportUpdatePrompt", "reportSigninGate", "reportOnboardingStep", "reportClientFailure", "listSecrets", "revealSecret", "upsertSecrets", "removeSecrets", "getMcpState", "getEffectivePlugins", "getMcpCatalog", "getMcpTeamPopularity", "getMcpPluginLogo", "installEntry", "updatePluginInstall", "removeMcpServer", "uninstallPlugin", "authenticateMcpServer", "renameMcpAccount", "removeMcpAccount", "setMcpCustomInstructions", "listMcpServerTools", "toggleMcpToolDisabled"]) handlers[name] = unserved;
  return handlers;
}

/** Exact `edgeFamily()("appWindow", ...)` stamp applied by every emitted group. */
export function createMainEdgeServedHandlers(deps: MainEdgeDeps): ServedMainEdgeHandlerMap {
  const handlers = createMainEdgeHandlers(deps);
  return Object.fromEntries(
    Object.entries(handlers).map(([name, run]) => [name, { trust: "appWindow", run }]),
  );
}
