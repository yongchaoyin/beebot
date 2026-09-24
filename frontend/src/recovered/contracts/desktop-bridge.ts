/**
 * Renderer-facing API exposed by the shipped 0.18 Electron preload.
 *
 * This is deliberately a contract, not a replacement preload. Argument shapes
 * mirror the readable wrapper functions in `dist/electron-preload/preload.cjs`;
 * opaque return values stay unknown until their producing main-process handler
 * has been recovered with equal confidence.
 */
export type Unsubscribe = () => void;
export type BridgeListener<Value = unknown> = (value: Value) => void;

export type ThemePreference = "system" | "light" | "dark";
export interface ThemeState {
  preference: ThemePreference;
  resolved: "light" | "dark";
}

export type CursorAuthStatus =
  | { kind: "logged-out"; errorMessage?: string }
  | { kind: "logging-in" }
  | {
      kind: "logged-in";
      authId?: string;
      email?: string;
      expiresAt?: number;
      displayName?: string;
      profilePictureUrl?: string;
      isAnysphereUser?: boolean;
    };

export type DesktopUpdateTrack = "stable" | "nightly" | "dogfood";
export type DesktopUpdateState =
  | { type: "disabled"; reason: "not-packaged" | "lab-build" | "unsupported-platform" | "disabled-by-env" }
  | { type: "idle"; lastCheck?: { at: number; result: "up-to-date" | "error"; errorMessage?: string } }
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "downloading"; version: string; progress?: number }
  | { type: "staging"; version: string }
  | { type: "ready"; version: string; lastCheck?: { at: number; result: "up-to-date" | "error"; errorMessage?: string } };

export interface DesktopUpdateStatus {
  state: DesktopUpdateState;
  currentVersion: string;
  currentTrack: DesktopUpdateTrack;
  trackOverride: DesktopUpdateTrack | null;
  buildDefaultTrack: DesktopUpdateTrack;
  availableTracks: DesktopUpdateTrack[];
  isTrackManagedByPolicy: boolean;
  isBelowMinimumVersion: boolean;
  autoUpdateWhenIdleOptIn: boolean;
  autoUpdateWhenIdleGateEnabled: boolean;
}

export interface DesktopAutoReviewInstructions {
  isEnabled: boolean;
  allowInstructions: string[];
  blockInstructions: string[];
}

export interface CursorUsageOnDemand {
  usedCents: number;
  limitCents: number | null;
  resetTimestampMs: number | null;
}

export type CursorUsageUpgradeAction =
  | { kind: "open-url"; url: string }
  | {
      kind: "dashboard-action";
      action: string;
      args: Record<string, string>;
      successMessage: string | null;
    };

export interface CursorUsageUpgradeCta {
  label: string;
  disabled: boolean;
  action: CursorUsageUpgradeAction;
}

/** Exact value assembled by electron-main/account/cursor-profile.ts in 0.18. */
export interface CursorUsageSummary {
  isEnterprise: boolean;
  sandUsagePercent: number | null;
  sandUsageResetTimestampMs: number | null;
  hasAvailableUsage: boolean;
  isSandTrial: boolean;
  hasEndedSandTrial: boolean;
  hasNonZeroIncludedLimit: boolean;
  canCancelSandTrial: boolean;
  onDemand: CursorUsageOnDemand | null;
  upgradeCta: CursorUsageUpgradeCta | null;
}

export interface DesktopWindowState {
  isFullscreen: boolean;
  isMaximized: boolean;
}

export type AttachmentMedia =
  | { kind: "image"; dataUrl: string; width: number | null; height: number | null }
  | { kind: "video"; src: string; width: number | null; height: number | null }
  | { kind: "audio"; src: string };

export type AttachmentTextResult =
  | { kind: "binary"; bytes: number }
  | { kind: "text"; text: string; truncated: boolean; bytes: number };

export type AttachmentBytesResult =
  | { kind: "too-large"; size: number }
  | { kind: "bytes"; bytes: Uint8Array };

export type StagedAttachmentResult =
  | { ok: true; path: string }
  | { ok: false; reason: "empty" | "too-large" | "failed" };

export interface AvatarFileSelection {
  dataUrl: string;
  fileName: string;
}

export interface TranscriptionResult {
  text: string;
  transcriptionTimeMs?: number;
}

export interface AgentModelParameter {
  id: string;
  value: string;
}

export interface AgentModelSelection {
  modelId: string;
  maxMode: boolean;
  parameters: AgentModelParameter[];
}

export interface SidebarSection {
  id: string;
  name: string;
  agentIds: string[];
  isCollapsed: boolean;
}

export interface SecretsSnapshot {
  keys: string[];
  isPersistent: boolean;
}

export interface SecretsMutationResult {
  synced: boolean;
}

export interface ClientPersistenceEntry {
  key: string;
  value: string;
}

export interface DesktopTimeZoneState {
  detectedTimeZone: string | null;
  overrideTimeZone: string | null;
}

export interface McpServerSummary {
  id: string;
  name: string;
  serverIdentifier: string;
  accountKey: string;
  rowServerIdentifier: string;
  transport: "http" | "sse" | "stdio";
  command?: string;
  url?: string;
  toolCount: number;
  disabledToolCount?: number;
  customInstructions: string;
  isTeamServer: boolean;
  pluginId?: string;
  isRequired?: boolean;
  managedByTeamPluginPolicy?: boolean;
  status: "connected" | "needsAuth" | "initializing" | "error" | "disconnected" | "disabledByTeamAdminPolicy";
  statusDetail?: string;
}

export interface McpServerState {
  servers: McpServerSummary[];
}

export interface McpCatalogEntry {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  homepage?: string;
  iconUrl?: string;
  connectors: unknown[];
  skills: Array<{ name: string; description: string; sourceUrl?: string }>;
  fields?: PluginVariableField[];
  marketplace?: { name: string; displayName: string; ownership: "team" | "user" };
  publisher?: { name: string; displayName: string; isUserOwned: boolean };
}

export interface PluginVariableField {
  key: string;
  label: string;
  placeholder: string;
  isRequired: boolean;
  isSecret: boolean;
  defaultValue?: string;
  hint?: string;
}

export interface EffectivePlugin {
  pluginId: string;
  name: string;
  displayName: string;
  installMode: "user" | "team-default" | "team-required" | "unknown";
  isEnabled: boolean;
  hasTeamConfiguredVariables?: boolean;
}

export interface McpToolSummary {
  name: string;
  title?: string;
  description?: string;
  isDisabled: boolean;
}

export type McpAuthenticationResult =
  | { status: "started"; authorizationUrl: string; serverName: string }
  | { status: "already-authenticated"; serverName: string }
  | { status: "not-configured"; serverName: string }
  | { status: "not-supported"; serverName: string; message: string }
  | { status: "unreachable"; serverName: string; message: string };

/** Exact top-level keys exposed with contextBridge in the public 0.18 preload. */
export const DESKTOP_BRIDGE_TOP_LEVEL_KEYS = [
  "resolveAttachmentMedia", "readAttachmentText", "readAttachmentBytes", "downloadAttachment",
  "getLinkMetadata", "openExternal", "openCloudAgent", "stageAttachmentBytes",
  "commitStagedAttachments", "discardStagedAttachment", "mcp", "forceGatewayReconnect",
  "pickAvatarSource", "pickAvatarFile", "generateAgentAvatarImage", "onFocusAgent",
  "onDeepLink", "deepLinksReady", "getBoxMigrationStatus", "onBoxMigration",
  "onDevBoxRebuild", "onOpenFeedback", "onOpenAbout", "submitFeedback", "onWidgetGallery",
  "onForceOnboarding", "transcribeAudio", "cursorAccount", "experiments", "platform", "isDev",
  "getWindowState", "onWindowStateEvent", "getZoomFactor", "onZoomFactorEvent", "windowControls",
  "foreverBox", "onboarding", "telemetry", "timeZone", "autoReviewInstructions",
  "localToolPermission", "theme", "secrets", "agent", "update", "devRestart", "attachProdBox"
] as const;

export interface TransferredCoordinatorPort {
  postMessage(message: unknown): void;
  close(): void;
  start(): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: (event: Record<string, never>) => void): void;
}

export interface CoordinatorPortBridge {
  claim(consumer: { onPort(port: TransferredCoordinatorPort): void }): {
    request(): void;
    release(): void;
  } | null;
}

export interface McpDesktopBridge {
  list(): Promise<McpServerState>;
  effectivePlugins(): Promise<EffectivePlugin[]>;
  catalog(): Promise<McpCatalogEntry[]>;
  teamPopularity(): Promise<Record<string, number>>;
  pluginLogo(url: string): Promise<string | null>;
  install(request: { entryId: string; values?: Record<string, string>; hasTeamConfiguredVariables?: boolean }): Promise<McpServerState>;
  updatePluginInstall(request: { pluginId: string; values: Record<string, string> }): Promise<McpServerState>;
  remove(serverId: string): Promise<{ state: McpServerState; removed: boolean; reason?: "team-server" | "still-present" }>;
  uninstallPlugin(pluginId: string): Promise<{ state: McpServerState; removed: boolean; reason?: "team-server" | "still-present" }>;
  authenticate(serverId: string, accountKey?: string, trigger?: "connector_card"): Promise<McpAuthenticationResult>;
  renameAccount(args: { serverId: string; accountKey: string; newAccountKey: string }): Promise<McpServerState>;
  removeAccount(args: { serverId: string; accountKey: string }): Promise<McpServerState>;
  setCustomInstructions(args: { serverId: string; instructions: string }): Promise<McpServerState>;
  listServerTools(serverId: string): Promise<McpToolSummary[]>;
  toggleToolDisabled(args: { serverId: string; toolName: string }): Promise<McpToolSummary[]>;
  onAuthCompleted(listener: BridgeListener<{ serverId: string; accountKey?: string; status: string }>): Unsubscribe;
}

export interface CursorAccountDesktopBridge {
  getStatus(): Promise<CursorAuthStatus>;
  login(): Promise<CursorAuthStatus>;
  cancelLogin(): Promise<CursorAuthStatus>;
  logout(): Promise<CursorAuthStatus>;
  updateName(name: string): Promise<CursorAuthStatus>;
  getAvatar(): Promise<unknown>;
  getWeeklyUsage(): Promise<unknown>;
  getUsageSummary(): Promise<CursorUsageSummary | null>;
  getPrReviewPreferences(): Promise<unknown>;
  getPrivacyModeEnabled(): Promise<unknown>;
  getSandAccess(): Promise<unknown>;
  getSandAccessFresh(): Promise<unknown>;
  invokeDashboardAction(request: Record<string, unknown>): Promise<unknown>;
  cancelTrial(): Promise<unknown>;
  onStatusChanged(listener: BridgeListener<CursorAuthStatus>): Unsubscribe;
}

export interface ExperimentsDesktopBridge {
  readonly initialSnapshot: unknown;
  getSnapshot(): Promise<unknown>;
  applyFeatureFlagOverride(command: unknown): Promise<void>;
  refresh(): Promise<void>;
  startRpcTraceWindow(): Promise<boolean>;
  onChanged(listener: BridgeListener): Unsubscribe;
}

export interface ForeverBoxDesktopBridge {
  forceRecreate(): Promise<unknown>;
  update(id: string, force?: boolean): Promise<unknown>;
  onVncUserPresence(listener: BridgeListener<boolean>): Unsubscribe;
  onDevBoxPullProgress(listener: BridgeListener): Unsubscribe;
  egressTunnel: {
    readonly initial: boolean;
    readonly initialStatus: unknown;
    get(): Promise<boolean>;
    set(enabled: boolean): Promise<boolean>;
    onChanged(listener: BridgeListener<boolean>): Unsubscribe;
    getStatus(): Promise<unknown>;
    onStatusChanged(listener: BridgeListener): Unsubscribe;
  };
  webauthnProxy: {
    readonly initial: boolean;
    get(): Promise<boolean>;
    set(enabled: boolean): Promise<boolean>;
    onChanged(listener: BridgeListener<boolean>): Unsubscribe;
  };
}

export interface TelemetryDesktopBridge {
  reportAgentLoad(report: unknown): void;
  reportBoxVisibility(report: unknown): void;
  reportSendLatency(report: unknown): void;
  reportHeapMetrics(report: unknown): void;
  reportSendAck(report: unknown): void;
  reportReactionAck(report: unknown): void;
  reportRenderTtfr(report: unknown): void;
  reportRenderStream(report: unknown): void;
  reportAgentsUnreachable(report: unknown): void;
  reportAccessBlocked(report: unknown): void;
  reportRecoveryAction(report: unknown): void;
  reportRebuildLifecycle(report: unknown): void;
  reportReconciliation(report: unknown): void;
  reportVncSession(report: unknown): void;
  reportVncLiveness(report: unknown): void;
  reportOpenComputer(report: unknown): void;
  reportUpdatePrompt(report: unknown): void;
  reportSigninGate(report: unknown): void;
  reportOnboardingStep(report: unknown): void;
  reportClientFailure(report: unknown): void;
  noteSentryConversation(report: unknown): void;
}

export interface AgentDesktopBridge {
  getPinnedAgents(): Promise<string[] | null>;
  setPinnedAgents(pinnedAgentIds: readonly string[]): Promise<string[] | null>;
  getSidebarSections(): Promise<SidebarSection[] | null>;
  setSidebarSections(sections: readonly SidebarSection[]): Promise<SidebarSection[] | null>;
  getDefaultModel(): Promise<AgentModelSelection | null>;
  setDefaultModel(model: AgentModelSelection): Promise<AgentModelSelection | null>;
  getComputerUseModel(): Promise<AgentModelSelection | null>;
  setComputerUseModel(model: AgentModelSelection | null): Promise<AgentModelSelection | null>;
  getAvailableModels(): Promise<unknown>;
  getUiLanguage(): Promise<{ language: string }>;
  setUiLanguage(language: string): Promise<{ language: string }>;
  getInferenceVendors(): Promise<{
    vendors: readonly {
      id: string;
      label: string;
      provider: string;
      baseUrl: string;
      modelId: string;
    }[];
    defaultVendorId: string | null;
  }>;
  upsertInferenceVendor(request: {
    id?: string;
    label?: string;
    provider: string;
    apiKey?: string;
    baseUrl?: string;
    modelId?: string;
    makeDefault?: boolean;
  }): Promise<{
    vendors: readonly {
      id: string;
      label: string;
      provider: string;
      baseUrl: string;
      modelId: string;
    }[];
    defaultVendorId: string | null;
  }>;
  deleteInferenceVendor(id: string): Promise<{
    vendors: readonly {
      id: string;
      label: string;
      provider: string;
      baseUrl: string;
      modelId: string;
    }[];
    defaultVendorId: string | null;
  }>;
  getInferenceRouter(): Promise<{
    provider: string;
    usage: unknown;
    local: unknown;
    http?: { baseUrl: string; modelId: string } | null;
  }>;
  setInferenceRouter(request: string | {
    provider: string;
    apiKey?: string;
    baseUrl?: string;
    modelId?: string;
  }): Promise<unknown>;
  clientPersistence: {
    read(key: string): Promise<string | null>;
    write(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
    listKeys(prefix: string): Promise<string[]>;
    migrateFromLocalStorage(entries: readonly ClientPersistenceEntry[]): Promise<boolean>;
  };
}

export interface DesktopBridge {
  resolveAttachmentMedia(url: string): Promise<AttachmentMedia | null>;
  readAttachmentText(path: string): Promise<AttachmentTextResult | null>;
  readAttachmentBytes(path: string, maxBytes: number): Promise<AttachmentBytesResult | null>;
  downloadAttachment(path: string, suggestedName?: string): Promise<boolean>;
  getLinkMetadata(url: string): Promise<unknown>;
  openExternal(url: string): Promise<void>;
  openCloudAgent(bcId: string): Promise<void>;
  stageAttachmentBytes(filename: string, bytes: Uint8Array): Promise<StagedAttachmentResult>;
  commitStagedAttachments(paths: readonly string[], filenames: readonly string[]): Promise<string[] | null>;
  discardStagedAttachment(path: string): Promise<void>;
  readonly mcp: McpDesktopBridge;
  forceGatewayReconnect(): Promise<void>;
  pickAvatarSource(): Promise<string | null>;
  pickAvatarFile(): Promise<AvatarFileSelection | null>;
  generateAgentAvatarImage(description: string): Promise<string>;
  onFocusAgent(listener: BridgeListener): Unsubscribe;
  onDeepLink(listener: BridgeListener): Unsubscribe;
  deepLinksReady(): Promise<void>;
  getBoxMigrationStatus(): Promise<unknown>;
  onBoxMigration(listener: BridgeListener): Unsubscribe;
  onDevBoxRebuild(listener: BridgeListener): Unsubscribe;
  onOpenFeedback(listener: () => void): Unsubscribe;
  onOpenAbout(listener: () => void): Unsubscribe;
  submitFeedback(payload: Record<string, unknown>): Promise<unknown>;
  onWidgetGallery(listener: BridgeListener): Unsubscribe;
  onForceOnboarding(listener: () => void): Unsubscribe;
  transcribeAudio(audio: Uint8Array, mimeType: string, language?: string): Promise<TranscriptionResult>;
  readonly cursorAccount: CursorAccountDesktopBridge;
  readonly experiments: ExperimentsDesktopBridge;
  readonly platform: NodeJS.Platform;
  readonly isDev: boolean;
  getWindowState(): Promise<DesktopWindowState>;
  onWindowStateEvent(listener: BridgeListener<DesktopWindowState>): Unsubscribe;
  getZoomFactor(): number;
  onZoomFactorEvent(listener: BridgeListener<number>): Unsubscribe;
  readonly windowControls: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    setTitleBarOverlayTone(isOverlayTone: boolean): Promise<void>;
    resizeWidth(deltaWidth: number): Promise<number>;
  };
  readonly foreverBox: ForeverBoxDesktopBridge;
  readonly onboarding: {
    getSeen(): Promise<boolean>;
    setSeen(seen: boolean): Promise<void>;
    onSkip(listener: () => void): Unsubscribe;
  };
  readonly telemetry: TelemetryDesktopBridge;
  readonly timeZone: {
    get(): Promise<DesktopTimeZoneState>;
    setOverride(timeZone: string | null): Promise<DesktopTimeZoneState>;
  };
  readonly autoReviewInstructions: {
    get(): Promise<DesktopAutoReviewInstructions>;
    set(instructions: DesktopAutoReviewInstructions): Promise<DesktopAutoReviewInstructions>;
  };
  readonly localToolPermission: {
    get(): Promise<unknown>;
    set(permission: unknown): Promise<unknown>;
    ceiling(): Promise<unknown>;
    recordApproval(approvalId: string, action: unknown, target: unknown): Promise<void>;
    clearApprovals(): Promise<void>;
  };
  readonly theme: {
    readonly initial: ThemeState;
    get(): Promise<ThemeState>;
    set(preference: ThemePreference): Promise<ThemeState>;
    onChanged(listener: BridgeListener<ThemeState>): Unsubscribe;
  };
  readonly secrets: {
    list(): Promise<SecretsSnapshot>;
    reveal(key: string): Promise<string | null>;
    upsert(entries: Record<string, string>): Promise<SecretsMutationResult>;
    remove(keys: readonly string[]): Promise<SecretsMutationResult>;
  };
  readonly agent: AgentDesktopBridge;
  readonly update: {
    getStatus(): Promise<DesktopUpdateStatus>;
    check(): Promise<DesktopUpdateStatus>;
    setTrack(track: DesktopUpdateTrack): Promise<DesktopUpdateStatus>;
    quitAndInstall(): Promise<void>;
    setAutoUpdateWhenIdleOptIn(enabled: boolean): Promise<DesktopUpdateStatus>;
    onStatusEvent(listener: BridgeListener<DesktopUpdateStatus>): Unsubscribe;
  };
  readonly attachProdBox: {
    getStatus(): Promise<unknown>;
    setEnabled(enabled: boolean, options?: { isRestartMainApp?: boolean }): Promise<unknown>;
  };
  devRestart?(): Promise<void>;
}

export function hasDesktopBridge(value: unknown): value is DesktopBridge {
  if (typeof value !== "object" || value == null) return false;
  const candidate = value as Partial<DesktopBridge>;
  return typeof candidate.openExternal === "function"
    && typeof candidate.getWindowState === "function"
    && typeof candidate.mcp === "object"
    && candidate.mcp != null
    && typeof candidate.cursorAccount === "object"
    && candidate.cursorAccount != null
    && typeof candidate.update === "object"
    && candidate.update != null;
}

export function requireDesktopBridge(value: unknown): DesktopBridge {
  if (!hasDesktopBridge(value)) throw new Error("The BeeBot desktop preload bridge is unavailable.");
  return value;
}
