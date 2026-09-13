import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ErrorInfo, type ReactNode } from "react";
import type { CoordinatorPortBridge, CursorAuthStatus, DesktopAutoReviewInstructions, DesktopBridge, SidebarSection, ThemePreference } from "../recovered/contracts/desktop-bridge";
import computerEntrypoint from "../recovered/features/computer/overlay/entrypoint";
import { ConversationComposer } from "../recovered/features/conversation/workspace/composer";
import { commitComposerAttachments, stageComposerFiles } from "../recovered/features/conversation/workspace/desktop";
import type { ComposerDraft, ConversationTranscriptEntry, DraftAttachment, TranscriptMessage } from "../recovered/features/conversation/workspace/model";
import { createComposerDraftPersistence, createComposerDraftStateStore } from "../recovered/features/conversation/workspace/draft-state";
import { createComposerSubmissionQueue, type ComposerSubmission, type ComposerSubmissionQueue } from "../recovered/features/conversation/workspace/submission";
import { createSendJournalApprovalLifecycle } from "../recovered/features/conversation/workspace/send-journal-approval-lifecycle";
import { createTranscriptAcknowledgementController } from "../recovered/features/conversation/workspace/acknowledgement";
import { createReplyThreadController, type ReplySelection } from "../recovered/features/conversation/workspace/reply-thread-controller";
import type { ComposerReplyTarget } from "../recovered/features/conversation/workspace/reply-preview";
import { ConversationSidebar } from "../recovered/features/conversation/workspace/sidebar";
import { createSidebarProfileAction } from "../recovered/features/conversation/workspace/sidebar-profile-action";
import { createSidebarSearchTrigger } from "../recovered/features/conversation/workspace/sidebar-search-trigger";
import { ConversationAgentHeader } from "../recovered/features/conversation/workspace/chat-header";
import { createUiLayoutStateStore, SIDEBAR_LAYOUT_BOUNDS, type SidebarLayoutState } from "../recovered/features/conversation/workspace/sidebar-layout-state";
import { createSidebarCollapsePersistence, createSidebarCollapseStateStore } from "../recovered/features/conversation/workspace/sidebar-collapse-state";
import { createEmojiCatalogStore } from "../recovered/features/conversation/cards/transcript-card/emoji-catalog";
import { createComposerEditorSuggestionAdapter } from "../recovered/features/conversation/workspace/editor-suggestion-production-adapter";
import { createEditorMcpReferenceProvider } from "../recovered/features/conversation/workspace/editor-mcp-reference-provider";
import { createEditorPrReferenceProvider } from "../recovered/features/conversation/workspace/editor-pr-reference-provider";
import { TranscriptLoadErrorSurface } from "../recovered/features/conversation/workspace/transcript-load-error";
import { projectSidebarSections } from "../recovered/features/conversation/workspace/sidebar-section-projection";
import { SidebarSectionDeleteConfirmation, type SidebarSectionDeleteTarget } from "../recovered/features/conversation/workspace/sidebar-section-delete-confirmation";
import { createSidebarSectionsStateStore, SIDEBAR_SYNTHETIC_SECTION_ID } from "../recovered/features/conversation/workspace/sidebar-sections-state";
import { ConversationTranscript, type TranscriptMessageReactionPillsProps } from "../recovered/features/conversation/workspace/transcript";
import { createConversationOutlineProvider } from "../recovered/features/conversation/workspace/conversation-outline-provider";
import { ConversationOutlinePanel, type ConversationOutlineSubagent } from "../recovered/features/conversation/workspace/conversation-outline-view";
import { createFindInChatController, type FindInChatMatch, type FindInChatTranscriptHandle } from "../recovered/features/conversation/workspace/find-in-chat-controller";
import { FindInChatBar } from "../recovered/features/conversation/workspace/find-in-chat";
import { SpreadsheetViewer } from "../recovered/features/conversation/workspace/spreadsheet-viewer";
import { createSpreadsheetViewerProvider, type SpreadsheetViewerMount } from "../recovered/features/conversation/workspace/spreadsheet-viewer-provider";
import { createTranscriptCardRootMountContract } from "../recovered/features/conversation/cards/transcript-card/mount-contract";
import { isTranscriptCardActionEntry, type TranscriptCardInteractionContext } from "../recovered/features/conversation/cards/transcript-card/message-actions";
import { createTranscriptCardLeafResolver } from "../recovered/features/conversation/cards/transcript-card/resolver";
import { createCloudAgentInfoSource, createCloudAgentProvider } from "../recovered/features/conversation/cards/transcript-card/cloud-agent-provider";
import { createWidgetInteractionAdapter, createWidgetInteractionTransport } from "../recovered/features/conversation/cards/transcript-card/widget-interactions";
import { createAutoReviewApprovalActions, type AutoReviewApprovalActionInput, type AutoReviewApprovalActions, type AutoReviewInstructionsResource } from "../recovered/features/conversation/cards/transcript-card/auto-review-actions";
import { createListenerIntegrationsProvider } from "../recovered/features/conversation/cards/transcript-card/listener-integrations";
import { createSecretRequestActionAdapter, createSecretRequestTransport, type SecretRequestEntry } from "../recovered/features/conversation/cards/transcript-card/secret-request-actions";
import { createAttachmentCardDataAdapter } from "../recovered/features/conversation/cards/transcript-card/attachment-data";
import { createConnectorProvider } from "../recovered/features/conversation/cards/transcript-card/connector-actions";
import { createUrlCardProvider } from "../recovered/features/conversation/cards/transcript-card/url-card";
import { createLocalToolPermissionStore } from "../recovered/features/permissions/local-tool/store";
import { createLocalToolPermissionScopeGate } from "./local-tool-permission-scope";
import { createTranscriptPaginationController, mergeOlderTranscriptEntries } from "../recovered/features/conversation/workspace/pagination";
import { createRoutinesController } from "../recovered/features/automations/routines/controller";
import { mountRoutinesInfoPane } from "../recovered/features/automations/routines/view";
import { createAgentSettingsController, projectAgentSettingsAgent } from "../recovered/features/agent-info/settings/model";
import { AgentSettingsPanel } from "../recovered/features/agent-info/settings/view";
import { GroupMembersPane } from "../recovered/features/agent-info/group-members/view";
import { createAvatarEditorProductionAdapter } from "../recovered/features/agent-info/avatar-editor/production-adapter";
import { AvatarEditorView } from "../recovered/features/agent-info/avatar-editor/view";
import { createPluginAuthProductionAdapter } from "../recovered/features/plugins/overlay/production-adapter";
import { projectGroupMemberAgent } from "../recovered/features/agent-info/group-members/model";
import { GROUP_INFO_PANE_HEADER, projectGroupInfoPaneRoute } from "../recovered/features/agent-info/group-members/route";
import { createAsyncTasksProvider } from "../recovered/features/agent-info/async-tasks/provider";
import { AsyncTasksPanel } from "../recovered/features/agent-info/async-tasks/view";
import { createSharedRoomProvider } from "../recovered/features/agent-info/shared-room/controller";
import { projectSharedRoomAgent, type SharedRoomAgent, type SharedRoomContext, type SharedRoomSnapshot } from "../recovered/features/agent-info/shared-room/model";
import { SharedRoomDialog } from "../recovered/features/agent-info/shared-room/view";
import type { SharedRoomHeaderTriggerProps } from "../recovered/features/agent-info/shared-room/trigger";
import { createAgentInfoChannelsController } from "../recovered/features/agent-info/channels/model";
import { mountAgentInfoChannels } from "../recovered/features/agent-info/channels/view";
import { useComputerExperience } from "../recovered/features/computer/shell/controller";
import { readComputerStatusSnapshot } from "../recovered/features/computer/shell/status-store";
import { ComputerFullscreen, ComputerHeaderControl, ComputerInfoPane, renderComputerHandoffEntry } from "../recovered/features/computer/shell/view";
import { createTeachRecordingStore, IDLE_TEACH_RECORDING_STATUS, type TeachRecordingStatus, type TeachRecordingStore } from "../recovered/features/computer/teach-recording/store";
import { useTeachRecordingComputerComposition, type TeachRecordingComputerInjection } from "../recovered/features/computer/teach-recording/composition";
import { createComputerUpdateConfirmationController, projectComputerUpdateConfirmationContent } from "../recovered/features/computer/update/confirmation";
import { createOnboardingComputerStatusSource } from "../recovered/features/onboarding/signed-in/computer-readiness";
import { isOnboardingAccountOnboarded, resolveOnboardingRoute } from "../recovered/features/onboarding/signed-in/model";
import { SignedInOnboarding } from "../recovered/features/onboarding/signed-in/view";
import { ORG_CHART_GATE, orgChartAvailability } from "../recovered/features/org-chart/workspace/entrypoint";
import { createAgentNetworkTrigger } from "../recovered/features/org-chart/workspace/network-trigger";
import { AccountMenu } from "../recovered/features/account/session/menu";
import { SandBadge, SandButton, SandIcon, SandIconButton } from "../recovered/ui/sand-kit-primitives";
import { OverlayDialog } from "../recovered/ui/overlay-primitives";
import { VendorSetup } from "../recovered/features/account/session/vendor-setup";
import { CreateBotSheet, parseUiLanguage, type UiLanguage } from "../recovered/features/roster/create-bot-sheet";
import { isRosterPrivacyBlockFailure, PrivacyBlockedDialog } from "../recovered/features/roster/privacy-blocked";
import { RosterStatus } from "../recovered/features/roster/status";
import { projectRosterFailure, selectRosterAccessReadiness } from "../recovered/features/roster/access-readiness";
import { createRosterSelectionPersistence, createRosterSelectionStore } from "../recovered/features/roster/selection-state";
import { createHiddenChatsMutationController } from "../recovered/features/hidden-chats/overlay/mutation-controller";
import { createCoordinatorConnectionController, createCoordinatorConnectionSource } from "../recovered/features/root-resilience/connection-state";
import { CoordinatorConnectionHost } from "../recovered/features/root-resilience/connection-state";
import { applyOptimisticReactionUpdate } from "./reaction-root";
import type { SettingsSectionId } from "../recovered/features/settings/overlay/view";
import type { SettingsComputerMount } from "../recovered/features/settings/overlay/computer";
import "../recovered/features/settings/overlay/view.css";
import { WindowChrome } from "../recovered/features/window-chrome/view";
import { createRootShellNavigationState, recordRootShellAgentSelection, resolveAdjacentAgentId, resolveIndexedAgentId, resolveRootShellNavigation, RootShellEmptyWorkspace, RootShellLoading } from "../recovered/features/window-chrome/root-shell-state";
import { createGlobalKeyboardShortcutController, createRootShellShortcutActions } from "../recovered/features/window-chrome/global-keyboard-shortcuts";
import { WindowStatusBadge } from "../recovered/features/window-chrome/status-badge";
import { RootShellNotificationHost } from "../recovered/features/window-chrome/notification-host";
import { AppAlertHost } from "../recovered/features/window-chrome/app-alert/view";
import { WorkspaceIndicator } from "../recovered/features/window-chrome/workspace-indicator";
import { applyRootShellTheme, applyRootShellZoomFactor, shouldRefreshRootShellOnFocus } from "../recovered/features/window-chrome/model";
import { createRuntimeThemeInstaller, RUNTIME_THEME_CLASS, type ThemeDocument } from "../recovered/features/runtime-theme-token-installer";
import { CommandPalette } from "./CommandPalette";
import { AgentDeleteConfirmation, type AgentDeleteTarget } from "./AgentDeleteConfirmation";
import type { CommandPaletteCommand } from "./command-palette-model";
import { createCommandPaletteMessageProvider, type CommandPaletteMessage } from "./command-palette-message-provider";
import { createCommandPaletteRoutineProvider } from "./command-palette-provider";
import { createCommandPaletteFileProvider } from "./command-palette-search-provider";
import { commandPaletteLinksFromConversation, createCommandPaletteLinkMetadataProvider } from "./command-palette-link-provider";
import { commandPaletteUpdateCommand } from "./command-palette-update-command";
import { commandPaletteRootCommands, type CommandPaletteComputerUpdateAction, type CommandPaletteInfoSection } from "./command-palette-root-commands";
import { CoordinatorCallError, createCoordinatorClient, type ProductionCoordinatorClient } from "./coordinator-client";
import { UI_TEXT } from "./evidence";
import { movePinnedAgent, partitionSidebarAgents } from "./sidebar-model";
import { SignOutDialog } from "../recovered/features/account/session/sign-out";
import { FeedbackDialog, type FeedbackCode } from "../recovered/features/feedback/overlay/view";
import { UpdateRequired } from "../recovered/features/update/required/view";
import { UpdatePill } from "../recovered/features/update/status/pill";
import { AboutDialog as RecoveredAboutDialog } from "../recovered/features/about/overlay/view";
import { DeepLinkInfoDialog } from "../recovered/features/deep-links/overlay/view";
import { AccessCover } from "../recovered/features/access/cover/view";
import { projectAccessCoverComposition } from "../recovered/features/access/cover/composition";
import { INITIAL_FIRST_BOX_GATE, projectFirstBoxGate, resetFirstBoxGate } from "../recovered/features/access/cover/first-box-gate";
import { SAND_ACCESS_CHECKING, SAND_ACCESS_UNKNOWN, readFreshSandAccess } from "../recovered/features/access/cover/model";
import { createComputerRebuildBoxSource, createComputerRebuildBoxStore } from "../recovered/features/access/cover/computer-rebuild-box-store";
import { createComputerRebuildMigrationStore } from "../recovered/features/access/cover/computer-rebuild-migration-store";
import { initialComputerRebuildState } from "../recovered/features/access/cover/computer-rebuild-model";
import { createComputerRebuildTransportSource, createComputerRebuildTransportStore } from "../recovered/features/access/cover/computer-rebuild-transport-store";
import { ComputerReconnectBanner, ComputerRebuildProgressBanner, type ComputerRebuildBannerInput } from "../recovered/features/computer/rebuild/banner";
import { createRosterSnapshotSource, createRosterSnapshotStore } from "../recovered/features/access/cover/roster-snapshot-store";
import { createSettingsUpdateController } from "../recovered/features/settings/overlay/updates-controller";
import { SettingsNoticeView } from "../recovered/features/settings/overlay/notice";
import { createSettingsNoticeController } from "./settings-notice-controller";
import { createGroupMembersRootScope } from "./group-members-root";
import { createProductionReactionRootScope } from "./reaction-root";
import { createStrictModeDisposalGuard, type StrictModeDisposable } from "./strict-mode-disposal";
import { MessageReactionAction, ReactionPills } from "../recovered/features/conversation/cards/transcript-card/reaction-picker";
import type { TranscriptMessageReactionSlotProps } from "../recovered/features/conversation/cards/transcript-card/message-actions";
import { LocalToolPermissionDock, type LocalToolPermissionRequest } from "../recovered/features/permissions/local-tool/view";
import {
  parseDesktopIntent,
  projectRendererAgent,
  projectRendererAgents,
  projectTranscriptEntry,
  projectTranscriptFeedEntries,
  projectTranscriptPageResult,
  type DeepLinkInfo,
  type RendererAgent
} from "./model";
import "../recovered/features/conversation/workspace/view.css";
import "./production.css";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L132985

const SettingsDesktopSurface = lazy(async () => {
  const module = await import("../recovered/features/settings/overlay/desktop-surface");
  return { default: module.SettingsDesktopSurface };
});

interface SettingsOverlayErrorBoundaryProps {
  children: ReactNode;
  onClose(): void;
}

interface SettingsOverlayErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

class SettingsOverlayErrorBoundary extends Component<SettingsOverlayErrorBoundaryProps, SettingsOverlayErrorBoundaryState> {
  state: SettingsOverlayErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): SettingsOverlayErrorBoundaryState {
    return { error, componentStack: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[settings-overlay-error]", error, info.componentStack ?? "");
    this.setState({ error, componentStack: info.componentStack ?? null });
  }

  private retry = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  render() {
    if (this.state.error == null) return this.props.children;
    return <OverlayDialog
      className="sand-settings-dialog"
      label={UI_TEXT.settings}
      onClose={this.props.onClose}
      open
      panelStyle={{ height: "auto", minHeight: 0, padding: 24 }}
      role="alertdialog"
    >
      <div aria-live="assertive" role="alert">
        <h2>{UI_TEXT.settings}</h2>
        <p>{this.state.error.message}</p>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <SandButton onClick={this.retry} size="sm" variant="secondary">Retry</SandButton>
        <SandButton onClick={this.props.onClose} size="sm">Close</SandButton>
      </div>
    </OverlayDialog>;
  }
}
const PluginsDesktopSurface = lazy(async () => {
  const module = await import("../recovered/features/plugins/overlay/desktop-surface");
  return { default: module.PluginsDesktopSurface };
});
const HiddenChatsDialog = lazy(async () => {
  const module = await import("../recovered/features/hidden-chats/overlay/view");
  return { default: module.HiddenChatsDialog };
});
const ComputerOverlayRouteView = lazy(() => computerEntrypoint.loadView());
const OrgChartWorkspaceView = lazy(() => import("../recovered/features/org-chart/workspace/view"));

type AuxiliaryOverlay = "hidden-chats" | "settings" | "plugins" | "about" | "feedback" | "confirm-logout" | null;
type WorkspaceRoute = "org-chart" | null;
type TransportState = "browser" | "connecting" | "connected" | "down";

const EMPTY_DRAFT: ComposerDraft = { prompt: "", attachments: [] };
type ComposerResendJournalInput = {
  submission: ComposerSubmission;
  onJournaled?: (event: ComposerJournalEvent) => void;
};
type ComposerJournalEvent = { nonce: string };
const EMPTY_ENTRIES: ConversationTranscriptEntry[] = [];
const EMPTY_SHARED_ROOM_SNAPSHOT: SharedRoomSnapshot = {
  context: null,
  state: null,
  room: null,
  isHost: false,
  selfAgentIds: [],
  candidates: [],
  requests: [],
  pending: new Set(),
  pendingAction: null,
  invite: null,
  isLoading: false,
  transport: "unknown",
  failure: null
};
const EMPTY_SHARED_ROOM_SUBSCRIBE = (_listener: () => void): (() => void) => () => {};
const readEmptySharedRoomSnapshot = (): SharedRoomSnapshot => EMPTY_SHARED_ROOM_SNAPSHOT;

function applyAuthoritativeReactionUpdate(
  entries: readonly ConversationTranscriptEntry[],
  entryId: string,
  projection: Pick<import("../recovered/features/conversation/cards/transcript-card/reaction-actions").ReactionAuthoritativeUpdate, "projection">["projection"],
): readonly ConversationTranscriptEntry[] {
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.id !== entryId) return entry;
    changed = true;
    if (entry.kind === "message") return { ...entry, reactions: projection.reactions, myReactions: projection.myReactions };
    if (entry.kind === "send-message") return { ...entry, reactions: projection.reactions, myReactions: projection.myReactions };
    return entry;
  });
  return changed ? next : entries;
}

function clearAuthoritativeReactions(entries: readonly ConversationTranscriptEntry[]): readonly ConversationTranscriptEntry[] {
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.kind !== "message" && entry.kind !== "send-message") return entry;
    if (entry.reactions == null && entry.myReactions == null) return entry;
    changed = true;
    return { ...entry, reactions: [], myReactions: new Set<string>() };
  });
  return changed ? next : entries;
}

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4911684 (wSn subagentId/subagentType/title/status tabs)
function projectConversationOutlineSubagents(value: unknown): ConversationOutlineSubagent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate == null || Array.isArray(candidate)) return [];
    const row = candidate as Record<string, unknown>;
    if (typeof row.subagentId !== "string" || row.subagentId.length === 0 || typeof row.subagentType !== "string" || row.subagentType.length === 0 || typeof row.title !== "string") return [];
    if (row.status !== "running" && row.status !== "done" && row.status !== "error" && row.status !== "aborted") return [];
    return [{ subagentId: row.subagentId, subagentType: row.subagentType, title: row.title, status: row.status }];
  });
}

function scrollToFindMatch(match: FindInChatMatch): void {
  if (typeof document === "undefined") return;
  const row = [...document.querySelectorAll<HTMLElement>("[data-entry-id]")]
    .find((candidate) => candidate.dataset.entryId === match.entryId);
  row?.scrollIntoView({ block: "center" });
}

type SettingsComputerActionKind = "update" | "reset";

type TranscriptLoadErrorState = {
  readonly agentId: string;
  readonly accountScopeGeneration: number;
};
type SettingsComputerActionState = {
  scope: string;
  pending: SettingsComputerActionKind | null;
  isUpdateQueued: boolean;
  isBlocked: boolean;
};

function computerActionResult(value: unknown): { status: string; reason?: string } | null {
  if (typeof value !== "object" || value == null || Array.isArray(value) || !("status" in value) || typeof value.status !== "string") return null;
  return {
    status: value.status,
    ...("reason" in value && typeof value.reason === "string" ? { reason: value.reason } : {})
  };
}

const COMPUTER_UPDATE_UNTRACKABLE_COPY = "The computer update started, but Grok Bot can't track its progress. Restart Grok Bot after the computer is available again.";
const COMPUTER_RESET_UNTRACKABLE_COPY = "The computer reset started, but Grok Bot can't track its progress. Restart Grok Bot after the computer is available again.";

function optimisticAcknowledgementEntries(nonce: string, attachments: readonly { path: string; name: string }[]) {
  return [
    { id: `pending-${nonce}`, kind: "message" as const, clientNonce: nonce },
    ...attachments.map((_, index) => ({ id: `pending-${nonce}:attachment-${index}`, kind: "user-attachment" as const, clientNonce: nonce }))
  ];
}

function moveAgentsToSidebarSection(sections: readonly SidebarSection[], agentIds: readonly string[], sectionId: string): SidebarSection[] | null {
  if (!sections.some((section) => section.id === sectionId)) return null;
  const knownAgentIds = new Set(sections.flatMap((section) => section.agentIds));
  const movedAgentIds = [...new Set(agentIds.filter((agentId) => agentId.length > 0 && knownAgentIds.has(agentId)))];
  if (movedAgentIds.length === 0) return null;
  const moved = new Set(movedAgentIds);
  return sections.map((section) => ({
    ...section,
    agentIds: section.id === sectionId && section.id !== SIDEBAR_SYNTHETIC_SECTION_ID
      ? [...section.agentIds.filter((agentId) => !moved.has(agentId)), ...movedAgentIds]
      : section.agentIds.filter((agentId) => !moved.has(agentId))
  }));
}
const EMPTY_DRAFT_SNAPSHOT = { draft: null, recovery: null } as const;
const readEmptyDraftSnapshot = () => EMPTY_DRAFT_SNAPSHOT;
const emptyDraftSubscribe = () => () => {};
const readEmptyAgentSettingsSnapshot = () => null;
const emptyAgentSettingsSubscribe = () => () => {};
const OVERLAY_FRAME_STYLE = {
  background: "var(--cursor-bg-scrim)",
  display: "grid",
  inset: 0,
  padding: 16,
  placeItems: "center",
  position: "fixed",
  zIndex: 100
} as const;

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=2726844-2728320 (Nmt info-pane header)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#byteOffset=3469149-3470830 (Windows Nmt header)
const INFO_PANE_TOP_CLASS = "sand-info-pane__top sand-1n2onr6 sand-78zum5 sand-6s0dn4 sand-1qughib sand-167g77z sand-1c4vz4f sand-2lah0s sand-dl72j9 sand-lvsv26 sand-xlogw sand-14kp3v7 sand-exx8yu sand-j9b1aj sand-18d9i69 sand-f18ygs";
const INFO_PANE_ACTIONS_CLASS = "sand-info-pane__actions sand-3nfvp2 sand-6s0dn4 sand-195vfkc sand-lvsv26";

function RootInfoPaneHeader({ children, onClose, closeLabel = "Close details" }: { readonly children?: ReactNode; readonly onClose: () => void; readonly closeLabel?: string }) {
  return <header className={INFO_PANE_TOP_CLASS}>
    {children == null ? <span aria-hidden="true" /> : children}
    <span className={INFO_PANE_ACTIONS_CLASS}>
      <SandIconButton aria-label={closeLabel} icon="chevrons-right" label={closeLabel} onClick={onClose} size="md" title={closeLabel} />
    </span>
  </header>;
}
const FEEDBACK_ERRORS: Record<FeedbackCode, string> = {
  "access-denied": "Grok Bot isn't available for this account.",
  "invalid-feedback": "Write between 1 and 10,000 characters.",
  "not-signed-in": ["Sign in to ", UI_TEXT.title, " before sending feedback."].join(""),
  "rate-limited": "You've sent several reports. Try again in a few minutes.",
  "subscription-required": "Upgrade to Ultra before sending feedback.",
  unavailable: "We couldn't deliver this report. Try again."
};
const UPDATE_REQUIRED_LABELS = {
  descriptionPrefix: "This version of Grok Bot (",
  descriptionSuffix: ") is no longer supported. Update to keep using Grok Bot — your agents keep running the whole time.",
  downloading: "Downloading update…",
  error: "Couldn't download the update. Check your connection and try again.",
  preparing: "Preparing update…",
  restart: "Restart to update",
  restarting: "Restarting…",
  retry: "Try again",
  title: "Update required",
  update: "Update"
} as const;
const UPDATE_PILL_LABELS = {
  available: "A new version of the app is available",
  downloading: "Downloading update…",
  restarting: "Restarting…",
  update: "Update"
} as const;
const SETTINGS_COMMANDS: readonly { id: SettingsSectionId; label: string; keywords: readonly string[] }[] = [
  { id: "general", label: "General", keywords: ["account", "model", "notifications", "preferences", "appearance", "theme", "mode", "security", "yubikey", "webauthn"] },
  { id: "usage", label: "Usage & Billing", keywords: ["usage", "billing", "spend", "limit", "on-demand", "plan", "quota"] },
  { id: "beta", label: "Updates", keywords: ["beta", "updates", "release", "track", "danger"] }
];
const THEME_COMMANDS: readonly { preference: ThemePreference; label: string; keywords: readonly string[] }[] = [
  { preference: "system", label: "Theme: System", keywords: ["appearance", "os", "auto", "follow"] },
  { preference: "light", label: "Theme: Light", keywords: ["appearance", "day", "bright"] },
  { preference: "dark", label: "Theme: Dark", keywords: ["appearance", "night", "mode"] }
];
const EMPTY_ACCESS_ROSTER_SNAPSHOT = {
  agents: [],
  hasCompleteRoster: false,
  isShowingRestoredRoster: false,
  loadState: "loading" as const,
  failure: null,
  isFetching: false,
  confirmedFetches: 0,
  transport: "down" as const
};
const readEmptyAccessRosterSnapshot = () => EMPTY_ACCESS_ROSTER_SNAPSHOT;
const emptyAccessRosterSubscribe = () => () => {};
const EMPTY_ROUTINE_SNAPSHOT = { status: "empty" as const, value: [] as const };
const readEmptyRoutineSnapshot = () => EMPTY_ROUTINE_SNAPSHOT;
const emptyRoutineSubscribe = () => () => {};
const EMPTY_FILE_SNAPSHOT = { status: "unavailable" as const, value: [] as const };
const readEmptyFileSnapshot = () => EMPTY_FILE_SNAPSHOT;
const emptyFileSubscribe = () => () => {};
const EMPTY_MESSAGE_SNAPSHOT = { status: "unavailable" as const, value: [] as const };
const readEmptyMessageSnapshot = () => EMPTY_MESSAGE_SNAPSHOT;
const emptyMessageSubscribe = () => () => {};
const EMPTY_LINK_METADATA_SNAPSHOT = { status: "unavailable" as const, value: {} as const };
const readEmptyLinkMetadataSnapshot = () => EMPTY_LINK_METADATA_SNAPSHOT;
const emptyLinkMetadataSubscribe = () => () => {};

function createAutoReviewInstructionsResource(bridge: DesktopBridge): AutoReviewInstructionsResource {
  let snapshot: ReturnType<AutoReviewInstructionsResource["snapshots"]["get"]> = { status: "empty" };
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) listener(); };
  const previous = () => snapshot.status === "ready" ? snapshot.value : snapshot.status === "loading" || snapshot.status === "failed" ? snapshot.previous : undefined;
  return {
    snapshots: {
      get: () => snapshot,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    },
    async load() {
      const prior = previous();
      snapshot = prior == null ? { status: "loading" } : { status: "loading", previous: prior };
      notify();
      try {
        snapshot = { status: "ready", value: await bridge.autoReviewInstructions.get() };
        notify();
      } catch (failure) {
        snapshot = prior == null ? { status: "failed", failure } : { status: "failed", failure, previous: prior };
        notify();
        throw failure;
      }
    },
    async setInstructions(instructions: DesktopAutoReviewInstructions) {
      snapshot = { status: "ready", value: await bridge.autoReviewInstructions.set(instructions) };
      notify();
    }
  };
}

function listenerConnectUrl(value: unknown): { url: string } {
  if (typeof value === "object" && value != null && !Array.isArray(value) && "url" in value && typeof value.url === "string") return { url: value.url };
  throw new Error("Invalid listener connect response");
}

function accountName(status: CursorAuthStatus | null): string {
  if (status?.kind === "logged-in") return status.displayName ?? status.email ?? UI_TEXT.account;
  if (status?.kind === "logging-in") return UI_TEXT.continueInBrowser;
  return UI_TEXT.signIn;
}

function makeClientNonce(): string {
  return globalThis.crypto?.randomUUID?.() ?? `renderer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function teachRecordingStatus(value: unknown): value is TeachRecordingStatus {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.maxDurationMs !== "number" || !Number.isFinite(record.maxDurationMs)) return false;
  if (record.state === "idle") return record.agentId === null && record.startedAtMs === null;
  return record.state === "recording"
    && typeof record.agentId === "string"
    && typeof record.startedAtMs === "number"
    && Number.isFinite(record.startedAtMs);
}

function requireTeachRecordingStatus(value: unknown): TeachRecordingStatus {
  if (!teachRecordingStatus(value)) throw new TypeError();
  return value;
}

function teachRecordingFeatureGate(value: unknown): boolean {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return false;
  const featureGates = (value as Record<string, unknown>).featureGates;
  if (typeof featureGates !== "object" || featureGates == null || Array.isArray(featureGates)) return false;
  return (featureGates as Record<string, unknown>).sand_teach_by_demonstration === true;
}

function createTeachRecordingPollingPolicy({ intervalMs }: { name: string; intervalMs: number }) {
  return {
    start(callback: () => Promise<void>) {
      const timer = window.setInterval(() => { void callback(); }, intervalMs);
      return { dispose: () => window.clearInterval(timer) };
    }
  };
}

const EMPTY_TEACH_RECORDING_SNAPSHOT_STORE = {
  get: () => IDLE_TEACH_RECORDING_STATUS,
  subscribe: () => () => {}
};
const EMPTY_TEACH_RECORDING_ARM_STORE = {
  get: () => null,
  subscribe: () => () => {}
};
const EMPTY_TEACH_RECORDING_CLOCK_STORE = {
  get: () => 0,
  subscribe: () => () => {}
};
const EMPTY_TEACH_RECORDING_STORE: Pick<TeachRecordingStore, "armed" | "nowMs" | "snapshots" | "arm" | "start" | "stop"> = {
  armed: EMPTY_TEACH_RECORDING_ARM_STORE,
  nowMs: EMPTY_TEACH_RECORDING_CLOCK_STORE,
  snapshots: EMPTY_TEACH_RECORDING_SNAPSHOT_STORE,
  arm() {},
  async start() {},
  async stop() {}
};

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5057384
function conversationLinkCandidates(entries: readonly ConversationTranscriptEntry[]): string[] {
  const candidates: string[] = [];
  const markdownLinks = /\[[^\]]*\]\(\s*([^\s)]+)(?:\s+[^)]*)?\)/g;
  const rawLinks = /https?:\/\/[^\s<>"'`\])]+/gi;
  for (const entry of entries) {
    if (entry.kind !== "message") continue;
    markdownLinks.lastIndex = 0;
    rawLinks.lastIndex = 0;
    for (const match of entry.text.matchAll(markdownLinks)) candidates.push(match[1] ?? "");
    for (const match of entry.text.matchAll(rawLinks)) candidates.push(match[0]);
    candidates.push(entry.text);
  }
  return candidates;
}

function overlayFallback(label: string) {
  return <div aria-live="polite" role="status">{label}</div>;
}

type AbortSignalLike = {
  readonly aborted?: boolean;
  addEventListener?: (type: "abort", listener: () => void, options?: unknown) => void;
  removeEventListener?: (type: "abort", listener: () => void) => void;
};

function callCoordinatorWithAbort(
  client: ProductionCoordinatorClient | null,
  method: string,
  args: unknown,
  signalValue?: unknown
): Promise<unknown> {
  if (client == null) return Promise.reject(new Error(`coordinator is unavailable for ${method}`));
  const signal = signalValue as AbortSignalLike | undefined;
  if (signal?.aborted === true) return Promise.reject(new Error(`${method} was cancelled`));
  const request = client.call(method, args);
  if (signal?.addEventListener == null || signal.removeEventListener == null) return request;
  const addAbortListener = signal.addEventListener;
  const removeAbortListener = signal.removeEventListener;
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(new Error(`${method} was cancelled`));
    };
    addAbortListener("abort", onAbort, { once: true });
    request.then((value) => {
      if (settled) return;
      settled = true;
      removeAbortListener("abort", onAbort);
      resolve(value);
    }, (error: unknown) => {
      if (settled) return;
      settled = true;
      removeAbortListener("abort", onAbort);
      reject(error);
    });
  });
}

function useStrictModeSafeDisposal(resource: StrictModeDisposable | null | undefined): void {
  const guardRef = useRef<ReturnType<typeof createStrictModeDisposalGuard> | null>(null);
  if (guardRef.current == null) guardRef.current = createStrictModeDisposalGuard();
  useEffect(() => guardRef.current!.attach(resource), [resource]);
}

function SignInLanding({ account, bridge, onStatus }: { account: CursorAuthStatus; bridge: DesktopBridge; onStatus(status: CursorAuthStatus): void }) {
  if (account.kind === "logged-in") return null;
  return (
    <div aria-label="Botfly" className="sand-onboarding" role="main">
      <section className="sand-onboarding__landing">
        <h1>Botfly</h1>
        <p>Choose a model vendor, paste an API key, and start.</p>
        <VendorSetup bridge={bridge} onStatus={onStatus} />
      </section>
    </div>
  );
}

export interface ProductionRendererProps {
  bridge: DesktopBridge;
  coordinatorPort: CoordinatorPortBridge;
}

export function ProductionRenderer({ bridge, coordinatorPort }: ProductionRendererProps) {
  const [client] = useState(() => createCoordinatorClient(coordinatorPort));
  const [groupMembersRoot] = useState(() => createGroupMembersRootScope(client));
  const [sharedRoomProvider] = useState(() => client == null ? null : createSharedRoomProvider(client));
  const [conversationOutlineProvider] = useState(() => createConversationOutlineProvider({
    coordinator: {
      getConversationOutline: (args) => client == null
        ? Promise.reject(new Error("coordinator is unavailable for getConversationOutline"))
        : client.call("getConversationOutline", args)
    },
    events: {
      subscribe: (family, listener) => client == null ? (() => {}) : client.subscribe(family, listener),
      subscribeTransportState: (listener) => client == null ? (() => {}) : client.subscribeTransport((state) => listener(state === "connected" ? "connected" : "down"))
    },
    accountKey: null
  }));
  useStrictModeSafeDisposal(conversationOutlineProvider);
  const [asyncTasksProvider] = useState(() => client == null ? null : createAsyncTasksProvider({
    getAsyncTasks: (args) => client.call("getAsyncTasks", args)
  }));
  useStrictModeSafeDisposal(asyncTasksProvider);
  const groupMembersLifecycleGenerationRef = useRef(0);
  useEffect(() => {
    const generation = ++groupMembersLifecycleGenerationRef.current;
    return () => {
      queueMicrotask(() => {
        if (groupMembersLifecycleGenerationRef.current === generation) groupMembersRoot.dispose();
      });
    };
  }, [groupMembersRoot]);
  const sharedRoomLifecycleGenerationRef = useRef(0);
  useEffect(() => {
    if (sharedRoomProvider == null) return;
    const generation = ++sharedRoomLifecycleGenerationRef.current;
    return () => {
      queueMicrotask(() => {
        if (sharedRoomLifecycleGenerationRef.current === generation) sharedRoomProvider.dispose();
      });
    };
  }, [sharedRoomProvider]);
  const sharedRoomSnapshot = useSyncExternalStore(
    sharedRoomProvider?.subscribe ?? EMPTY_SHARED_ROOM_SUBSCRIBE,
    sharedRoomProvider?.getSnapshot ?? readEmptySharedRoomSnapshot,
    sharedRoomProvider?.getSnapshot ?? readEmptySharedRoomSnapshot
  );
  const [transcriptCardResolver] = useState(() => createTranscriptCardLeafResolver());
  const [transcriptCardWidgetInteractions] = useState(() => createWidgetInteractionAdapter({
    scope: { accountSlot: null, agentId: null },
    transport: createWidgetInteractionTransport({
      call: (method, args) => client == null
        ? Promise.reject(new Error(`coordinator is unavailable for ${method}`))
        : client.call(method, args)
    })
  }));
  const [transcriptCardCloudAgents] = useState(() => createCloudAgentProvider({
    scope: { accountSlot: null, agentId: null },
    source: createCloudAgentInfoSource({
      call: (method, args) => client == null
        ? Promise.reject(new Error(`coordinator is unavailable for ${method}`))
        : client.call(method, args)
    }),
    opener: { openCloudAgent: (bcId) => bridge.openCloudAgent(bcId) }
  }));
  const [transcriptCardAutoReviewInstructions] = useState(() => createAutoReviewInstructionsResource(bridge));
  const [transcriptCardListenerIntegrations] = useState(() => client == null ? null : createListenerIntegrationsProvider({
    scope: { accountSlot: null, agentId: null },
    source: {
      getListenerIntegrations: () => client.call("getListenerIntegrations"),
      getListenerConnectUrl: async (input) => listenerConnectUrl(await client.call("getListenerConnectUrl", input))
    },
    desktop: { openExternal: (url) => bridge.openExternal(url) }
  }));
  const [transcriptCardSecretRequests] = useState(() => client == null ? null : createSecretRequestActionAdapter({
    scope: { accountSlot: null, agentId: null },
    transport: createSecretRequestTransport({ call: (method, args) => client.call(method, args) })
  }));
  const [transcriptCardAttachments] = useState(() => createAttachmentCardDataAdapter({
    resolveAttachmentMedia: (url) => bridge.resolveAttachmentMedia(url)
  }));
  const [transcriptCardConnectors] = useState(() => createConnectorProvider({ bridge }));
  const [transcriptCardUrlCards] = useState(() => createUrlCardProvider({
    getLinkMetadata: (url) => bridge.getLinkMetadata(url),
    openExternal: (url) => bridge.openExternal(url)
  }));
  const transcriptCardLifecycleGenerationRef = useRef(0);
  const transcriptCardListenerSubscriptionRef = useRef<(() => void) | null>(null);
  const transcriptCardAutoReviewActionsRef = useRef(new Set<AutoReviewApprovalActions>());
  const transcriptCardAutoReviewActionScopeRef = useRef<string | null>(null);
  const [routineProvider] = useState(() => client == null ? null : createCommandPaletteRoutineProvider({
    listAllAutomations: () => client.call("listAllAutomations")
  }));
  const [routinesController] = useState(() => createRoutinesController({
    getAgentAutomations: (args) => client == null ? Promise.reject(new Error("coordinator is unavailable for getAgentAutomations")) : client.call("getAgentAutomations", args),
    createAgentAutomation: (args) => client == null ? Promise.reject(new Error("coordinator is unavailable for createAgentAutomation")) : client.call("createAgentAutomation", args),
    setAgentAutomationEnabled: (args) => client == null ? Promise.reject(new Error("coordinator is unavailable for setAgentAutomationEnabled")) : client.call("setAgentAutomationEnabled", args),
    updateAgentAutomation: (args) => client == null ? Promise.reject(new Error("coordinator is unavailable for updateAgentAutomation")) : client.call("updateAgentAutomation", args),
    deleteAgentAutomation: (args) => client == null ? Promise.reject(new Error("coordinator is unavailable for deleteAgentAutomation")) : client.call("deleteAgentAutomation", args),
    runAgentAutomationNow: (args) => client == null ? Promise.reject(new Error("coordinator is unavailable for runAgentAutomationNow")) : client.call("runAgentAutomationNow", args)
  }));
  const routineSnapshot = useSyncExternalStore(
    routineProvider?.subscribe ?? emptyRoutineSubscribe,
    routineProvider?.getSnapshot ?? readEmptyRoutineSnapshot,
    routineProvider?.getSnapshot ?? readEmptyRoutineSnapshot
  );
  const [fileProvider] = useState(() => client == null ? null : createCommandPaletteFileProvider({
    searchMedia: (input) => client.call("searchMedia", input)
  }));
  const fileSnapshot = useSyncExternalStore(
    fileProvider?.subscribe ?? emptyFileSubscribe,
    fileProvider?.getSnapshot ?? readEmptyFileSnapshot,
    fileProvider?.getSnapshot ?? readEmptyFileSnapshot
  );
  const [messageProvider] = useState(() => client == null ? null : createCommandPaletteMessageProvider({
    searchAgents: (input) => client.call("searchAgents", input)
  }));
  const messageSnapshot = useSyncExternalStore(
    messageProvider?.subscribe ?? emptyMessageSubscribe,
    messageProvider?.getSnapshot ?? readEmptyMessageSnapshot,
    messageProvider?.getSnapshot ?? readEmptyMessageSnapshot
  );
  const [linkMetadataProvider] = useState(() => createCommandPaletteLinkMetadataProvider({
    getLinkMetadata: (url) => bridge.getLinkMetadata(url)
  }));
  const linkMetadataSnapshot = useSyncExternalStore(
    linkMetadataProvider.subscribe,
    linkMetadataProvider.getSnapshot,
    linkMetadataProvider.getSnapshot
  );
  const [accessRosterStore] = useState(() => client == null ? null : createRosterSnapshotStore({ source: createRosterSnapshotSource(client, bridge.agent.clientPersistence) }));
  const [rebuildMigrationStore] = useState(() => createComputerRebuildMigrationStore({ bridge, initialState: initialComputerRebuildState(null), now: () => Date.now() }));
  const [rebuildBoxStore] = useState(() => client == null ? null : createComputerRebuildBoxStore({ boxId: "forever-box", source: createComputerRebuildBoxSource(client), initialState: initialComputerRebuildState(null), now: () => Date.now() }));
  const [rebuildTransportStore] = useState(() => client == null ? null : createComputerRebuildTransportStore({ source: createComputerRebuildTransportSource(client), initialState: initialComputerRebuildState(null), now: () => Date.now() }));
  const [selectionStore] = useState(() => createRosterSelectionStore(createRosterSelectionPersistence(bridge.agent.clientPersistence)));
  const [localToolPermissionStore] = useState(() => createLocalToolPermissionStore(bridge.localToolPermission));
  const [localToolPermissionScopeGate] = useState(() => createLocalToolPermissionScopeGate());
  const [avatarEditorAdapter] = useState(() => createAvatarEditorProductionAdapter({
    desktop: bridge,
    source: {
      setAgentAvatarBytes: (args, options) => callCoordinatorWithAbort(client, "setAgentAvatarBytes", args, options?.signal),
      updateAgent: (args) => callCoordinatorWithAbort(client, "updateAgent", args)
    }
  }));
  const [pluginAuthAdapter] = useState(() => createPluginAuthProductionAdapter({
    coordinator: {
      getPluginSyncStatus: () => client == null
        ? Promise.reject(new Error("coordinator is unavailable for getPluginSyncStatus"))
        : client.call("getPluginSyncStatus"),
      createAgent: (args) => client == null
        ? Promise.reject(new Error("coordinator is unavailable for createAgent"))
        : client.call("createAgent", args),
      sendPrompt: (args) => client == null
        ? Promise.reject(new Error("coordinator is unavailable for sendPrompt"))
        : client.call("sendPrompt", args)
    },
    selectAgent: (agentId) => { void openAgentRef.current(agentId); }
  }));
  const [composerDraftStore] = useState(() => createComposerDraftStateStore(createComposerDraftPersistence(bridge.agent.clientPersistence)));
  const [acknowledgementController] = useState(() => createTranscriptAcknowledgementController());
  const [replySelection, setReplySelection] = useState<ReplySelection | null>(null);
  const [replyThreadController] = useState(() => createReplyThreadController({
    onSelectionChange: setReplySelection,
    onNavigate: (targetId, isInScope) => {
      if (!isInScope || typeof document === "undefined") return;
      const row = [...document.querySelectorAll<HTMLElement>("[data-entry-id]")]
        .find((candidate) => candidate.dataset.entryId === targetId);
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    onRestoreFocus: () => {
      const focusComposer = () => document.querySelector<HTMLElement>(".sand-prompt-form textarea, .sand-prompt-form [contenteditable='true']")?.focus();
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(focusComposer);
      else focusComposer();
    }
  }));
  const [findInChatController] = useState(() => createFindInChatController({ onNavigate: scrollToFindMatch }));
  const findInChatLifecycleGenerationRef = useRef(0);
  useEffect(() => {
    const generation = ++findInChatLifecycleGenerationRef.current;
    return () => {
      queueMicrotask(() => {
        if (findInChatLifecycleGenerationRef.current === generation) findInChatController.dispose();
      });
    };
  }, [findInChatController]);
  const [spreadsheetViewerProvider] = useState(() => createSpreadsheetViewerProvider({
    readAttachmentBytes: (source, maxBytes) => bridge.readAttachmentBytes(source, maxBytes),
    downloadAttachment: (source, suggestedName) => bridge.downloadAttachment(source, suggestedName)
  }));
  const spreadsheetViewerLifecycleGenerationRef = useRef(0);
  useEffect(() => {
    const generation = ++spreadsheetViewerLifecycleGenerationRef.current;
    return () => {
      queueMicrotask(() => {
        if (spreadsheetViewerLifecycleGenerationRef.current === generation) spreadsheetViewerProvider.dispose();
      });
    };
  }, [spreadsheetViewerProvider]);
  const [uiLayoutStore] = useState(() => createUiLayoutStateStore(bridge.agent.clientPersistence));
  const [sidebarCollapseStore] = useState(() => createSidebarCollapseStateStore(createSidebarCollapsePersistence(bridge.agent.clientPersistence)));
  const [emojiCatalogStore] = useState(() => createEmojiCatalogStore());
  const [editorSuggestionAdapter] = useState(() => client == null ? null : createComposerEditorSuggestionAdapter({
    source: {
      listAgents: () => client.call("listAgents"),
      getAgentWorkflows: (args) => client.call("getAgentWorkflows", args),
      subscribeTransportState: (listener) => {
        const stop = client.subscribeTransport((state) => listener(state === "connected" ? "connected" : "down"));
        return { dispose: stop };
      }
    },
    catalogStore: emojiCatalogStore,
    recents: sidebarCollapseStore
  }));
  const [editorMcpReferenceProvider] = useState(() => createEditorMcpReferenceProvider({
    list: () => bridge.mcp.list(),
    catalog: () => bridge.mcp.catalog(),
    onAuthCompleted: (listener) => bridge.mcp.onAuthCompleted(listener)
  }));
  const [editorPrReferenceProvider] = useState(() => createEditorPrReferenceProvider({ cloudAgents: transcriptCardCloudAgents }));
  const [sidebarSectionsStore] = useState(() => createSidebarSectionsStateStore({
    bridge: bridge.agent,
    subscribeHostSettings: (listener) => client?.subscribe("host-settings", (value) => {
      if (typeof value !== "object" || value == null || !("fields" in value) || !Array.isArray(value.fields) || !value.fields.every((field) => typeof field === "string")) return;
      listener({ fields: value.fields });
    }) ?? (() => {})
  }));
  const [transport, setTransport] = useState<TransportState>("connecting");
  const [agents, setAgents] = useState<RendererAgent[]>([]);
  const [pinnedAgentIds, setPinnedAgentIds] = useState<string[]>([]);
  const [hasLoadedAgents, setHasLoadedAgents] = useState(false);
  const activeAgentId = useSyncExternalStore(
    selectionStore.subscribe,
    () => selectionStore.get().currentAgentId ?? "",
    () => ""
  );
  const setActiveAgentId = useCallback((next: string | ((current: string) => string)) => {
    const current = selectionStore.get().currentAgentId ?? "";
    selectionStore.select(typeof next === "function" ? next(current) : next);
  }, [selectionStore]);
  const [entriesByAgent, setEntriesByAgent] = useState<Record<string, ConversationTranscriptEntry[]>>({});
  const [transcriptLoadError, setTranscriptLoadError] = useState<TranscriptLoadErrorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [composerClearGeneration, setComposerClearGeneration] = useState(0);
  const [overlay, setOverlay] = useState<AuxiliaryOverlay>(null);
  const [workspaceRoute, setWorkspaceRoute] = useState<WorkspaceRoute>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [findInChatOpen, setFindInChatOpen] = useState(false);
  const [findInChatFocusNonce, setFindInChatFocusNonce] = useState(0);
  const [findTranscriptContainer, setFindTranscriptContainer] = useState<HTMLElement | null>(null);
  const transcriptHandleRef = useRef<FindInChatTranscriptHandle | null>(null);
  const [spreadsheetViewerMount, setSpreadsheetViewerMount] = useState<SpreadsheetViewerMount | null>(null);
  const [routinesInfoPaneOpen, setRoutinesInfoPaneOpen] = useState(false);
  const [routinesAutomationId, setRoutinesAutomationId] = useState<string | null>(null);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);
  const [groupInfoPaneOpen, setGroupInfoPaneOpen] = useState(false);
  const [manageSharedRoomId, setManageSharedRoomId] = useState<string | null>(null);
  const [channelsInfoPaneOpen, setChannelsInfoPaneOpen] = useState(false);
  const [conversationOutlineAgentId, setConversationOutlineAgentId] = useState<string | null>(null);
  const [asyncTasksAgentId, setAsyncTasksAgentId] = useState<string | null>(null);
  const [paletteMessageTarget, setPaletteMessageTarget] = useState<Pick<CommandPaletteMessage, "agentId" | "entryId"> | null>(null);
  const [deleteAgent, setDeleteAgent] = useState<AgentDeleteTarget | null>(null);
  const [deleteSection, setDeleteSection] = useState<SidebarSectionDeleteTarget | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("general");
  const [pluginQuery, setPluginQuery] = useState("");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [account, setAccount] = useState<CursorAuthStatus | null>(null);
  const [sandAccess, setSandAccess] = useState(SAND_ACCESS_UNKNOWN);
  const [accessFirstBox, setAccessFirstBox] = useState(INITIAL_FIRST_BOX_GATE);
  const [privacyBlocked, setPrivacyBlocked] = useState(false);
  const [rosterLoadFailed, setRosterLoadFailed] = useState(false);
  const [rosterFailure, setRosterFailure] = useState<ReturnType<typeof projectRosterFailure>>(null);
  const [isRosterRetrying, setIsRosterRetrying] = useState(false);
  const [deepLinkInfo, setDeepLinkInfo] = useState<DeepLinkInfo | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [windowFullscreen, setWindowFullscreen] = useState(false);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [agentNetworkEnabled, setAgentNetworkEnabled] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => bridge?.theme.initial.preference ?? "system");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => bridge?.theme.initial.resolved ?? "dark");
  const [settingsUpdateController] = useState(() => createSettingsUpdateController(bridge));
  const [settingsNoticeController] = useState(() => createSettingsNoticeController());
  const updateSnapshot = useSyncExternalStore(
    settingsUpdateController.subscribe,
    settingsUpdateController.getSnapshot,
    settingsUpdateController.getSnapshot
  );
  const updateStatus = updateSnapshot.status;
  const updateStatusLoading = updateSnapshot.isLoading;
  const settingsNoticeSnapshot = useSyncExternalStore(
    settingsNoticeController.subscribe,
    settingsNoticeController.getSnapshot,
    settingsNoticeController.getSnapshot
  );
  const [computerInfoOpen, setComputerInfoOpen] = useState(false);
  const [computerViewerRetained, setComputerViewerRetained] = useState(false);
  // Frontend 1 owns the windowControls lifecycle through WindowChrome.
  const stagedPaths = useRef(new Set<string>());
  const composerSubmissionQueueRef = useRef<ComposerSubmissionQueue | null>(null);
  const resendSubmissionNoncesRef = useRef(new Set<string>());
  const accountIdentityRef = useRef<string | null>(null);
  const accountScopeGenerationRef = useRef(0);
  const accountObservationGenerationRef = useRef(0);
  const accountRef = useRef<CursorAuthStatus | null>(account);
  const spreadsheetTriggerRef = useRef<HTMLElement | null>(null);
  const avatarEditorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const conversationOutlineReturnFocusRef = useRef<HTMLElement | null>(null);
  const asyncTasksReturnFocusRef = useRef<HTMLElement | null>(null);
  const [globalShortcutController] = useState(() => createGlobalKeyboardShortcutController([]));
  const createAgentRef = useRef<() => void | Promise<unknown>>(() => {});
  const [createBotOpen, setCreateBotOpen] = useState(false);
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("en");
  const [inferenceVendors, setInferenceVendors] = useState<readonly { id: string; label: string; modelId?: string }[]>([]);
  const [defaultInferenceVendorId, setDefaultInferenceVendorId] = useState("");
  const openAgentRef = useRef<(agentId: string) => void | Promise<unknown>>(() => {});
  const acknowledgementScopeRef = useRef<{ accountSlot: string | null; agentId: string | null }>({ accountSlot: null, agentId: null });
  const rosterAttemptRef = useRef(0);
  const hasLoadedAgentsRef = useRef(hasLoadedAgents);
  const completeRosterAgentIdsRef = useRef<readonly string[]>([]);
  const navigationHistoryRef = useRef(createRootShellNavigationState());
  const activeAgentIdRef = useRef(activeAgentId);
  const openAgentRequestGenerationRef = useRef(0);
  const transportScopeGenerationRef = useRef(0);
  const findInChatOpenRef = useRef(findInChatOpen);
  const agentsRef = useRef(agents);
  const pinnedAgentIdsRef = useRef(pinnedAgentIds);
  const pinnedStateVersionRef = useRef(0);
  const rebuildRevisionRef = useRef(0);
  const entriesByAgentRef = useRef(entriesByAgent);
  const transportRef = useRef<TransportState>(transport);
  transportRef.current = transport;
  activeAgentIdRef.current = activeAgentId;
  accountRef.current = account;
  findInChatOpenRef.current = findInChatOpen;
  agentsRef.current = agents;
  hasLoadedAgentsRef.current = hasLoadedAgents;
  pinnedAgentIdsRef.current = pinnedAgentIds;
  entriesByAgentRef.current = entriesByAgent;

  const [hiddenChatsMutationController] = useState(() => createHiddenChatsMutationController({
    call: (input) => client == null
      ? Promise.reject(new Error("coordinator is unavailable for setAgentHiddenFromSidebar"))
      : client.call("setAgentHiddenFromSidebar", input),
    readAgent: (agentId) => {
      const agent = agentsRef.current.find((candidate) => candidate.id === agentId);
      return agent == null ? null : { id: agent.id, isHidden: agent.isHidden, updatedAt: agent.updatedAt };
    },
    onOptimisticChange: (agentId, isHidden) => {
      setAgents((current) => current.map((agent) => agent.id === agentId ? { ...agent, isHidden } : agent));
    },
    onRollback: (agentId, optimisticValue, previousValue) => {
      setAgents((current) => current.map((agent) => agent.id === agentId && agent.isHidden === optimisticValue
        ? { ...agent, isHidden: previousValue }
        : agent));
    }
  }));

  useLayoutEffect(() => {
    groupMembersRoot.roster.setAgents(agents);
  }, [agents, groupMembersRoot]);

  const [transcriptPaginationController] = useState(() => createTranscriptPaginationController({
    fetchPage: async ({ id, limit, beforeSeq }) => {
      if (client == null) throw new Error("coordinator is unavailable for getAgentTranscriptTail");
      const agentName = agentsRef.current.find((agent) => agent.id === id)?.name ?? UI_TEXT.title;
      return projectTranscriptPageResult(await client.call("getAgentTranscriptTail", { id, limit, beforeSeq }), agentName, id);
    }
  }));
  useStrictModeSafeDisposal(transcriptPaginationController);
  useStrictModeSafeDisposal(localToolPermissionStore);
  useStrictModeSafeDisposal(localToolPermissionScopeGate);
  useStrictModeSafeDisposal(avatarEditorAdapter);
  useStrictModeSafeDisposal(pluginAuthAdapter);
  useStrictModeSafeDisposal(replyThreadController);
  useStrictModeSafeDisposal(hiddenChatsMutationController);

  const sendComposerPrompt = async (submission: ComposerSubmission): Promise<void> => {
    if (client == null) throw new Error("coordinator is unavailable for sendPrompt");
    const draftAttachments = submission.attachments.map((attachment) => ({ path: attachment.path, name: attachment.name }));
    const attachments = bridge == null ? draftAttachments : await commitComposerAttachments(bridge, draftAttachments);
    for (const attachment of draftAttachments) stagedPaths.current.delete(attachment.path);
    setEntriesByAgent((current) => ({
      ...current,
      [submission.agentId]: (current[submission.agentId] ?? []).map((entry) => entry.kind === "message" && entry.clientNonce === submission.nonce
        ? { ...entry, attachments, text: submission.prompt }
        : entry)
    }));
    await client.call("sendPrompt", {
      agentId: submission.agentId,
      prompt: submission.prompt,
      directAddressedAcceptance: true,
      attachmentPaths: attachments.map((attachment) => attachment.path),
      attachmentNames: attachments.map((attachment) => attachment.name),
      clientNonce: submission.nonce,
      enterEpochMs: submission.createdAtMs,
      composedAtMs: submission.createdAtMs,
      ...(submission.richText == null ? {} : { richText: submission.richText }),
      ...(submission.replyToId == null ? {} : { replyToId: submission.replyToId }),
      ...(submission.isFork === undefined ? {} : { isFork: submission.isFork })
    });
  };
  const [sendJournalApprovalLifecycle] = useState(() => createSendJournalApprovalLifecycle<
    ComposerSubmission,
    ComposerResendJournalInput,
    string,
    string,
    ComposerJournalEvent,
    void,
    import("../recovered/features/conversation/workspace/submission").ComposerSubmissionPhase,
    void,
    boolean
  >(
    {
      sendPrompt: sendComposerPrompt,
      resendFailed: async (input: ComposerResendJournalInput) => {
        const queue = composerSubmissionQueueRef.current;
        if (queue == null) throw new Error("composer submission queue is unavailable");
        resendSubmissionNoncesRef.current.add(input.submission.nonce);
        try {
          const result = queue.submit(input.submission);
          const phase = await result.completion;
          if (phase === "sent") input.onJournaled?.({ nonce: input.submission.nonce });
          return phase;
        } finally {
          resendSubmissionNoncesRef.current.delete(input.submission.nonce);
        }
      },
      deleteFailed: async (nonce: string) => { composerSubmissionQueueRef.current?.discard(nonce); },
      cancelQueued: async (nonce: string) => composerSubmissionQueueRef.current?.cancelQueued(nonce) ?? false
    },
    { clearApprovals: () => localToolPermissionStore.clearApprovals() }
  ));
  const [composerSubmissionQueue] = useState(() => {
    const queue = createComposerSubmissionQueue({
      isTransportDown: () => transportRef.current !== "connected",
      send: (submission) => resendSubmissionNoncesRef.current.has(submission.nonce)
        ? sendComposerPrompt(submission)
        : sendJournalApprovalLifecycle.sendPrompt(submission),
    onPhase: (submission) => {
      const scope = acknowledgementScopeRef.current;
      if (submission.phase === "pending") acknowledgementController.markDispatching(scope.accountSlot, submission.nonce);
      if (submission.phase === "sent") acknowledgementController.markAcceptedAwaitingEcho(scope.accountSlot, submission.nonce);
      if (submission.phase === "failed") acknowledgementController.markFailed(scope.accountSlot, submission.nonce, Date.now());
      if (submission.phase === "cancelled") acknowledgementController.removeOptimistic({ accountSlot: scope.accountSlot, nonce: submission.nonce });
      setEntriesByAgent((current) => {
        if (submission.phase === "cancelled") {
          return {
            ...current,
            [submission.agentId]: (current[submission.agentId] ?? []).filter((entry) => entry.kind !== "message" || entry.clientNonce !== submission.nonce)
          };
        }
        const delivery: "pending" | "queued" | "failed" | "sent" = submission.phase === "pending" || submission.phase === "queued" || submission.phase === "failed" || submission.phase === "sent"
          ? submission.phase
          : "pending";
        return {
          ...current,
          [submission.agentId]: (current[submission.agentId] ?? []).map((entry) => entry.kind === "message" && entry.clientNonce === submission.nonce
            ? { ...entry, delivery }
            : entry)
        };
      });
      if (submission.phase === "pending") setBusy(true);
      if (submission.phase === "queued" || submission.phase === "failed" || submission.phase === "sent" || submission.phase === "cancelled") setBusy(false);
    },
    onFailure: (submission, error) => {
      composerDraftStore.recoverDraft(submission.agentId, {
        prompt: submission.prompt,
        attachments: [...submission.attachments]
      });
      setNotice(error instanceof Error ? error.message : String(error));
      }
    });
    composerSubmissionQueueRef.current = queue;
    return queue;
  });

  useStrictModeSafeDisposal(composerSubmissionQueue);
  useStrictModeSafeDisposal(sendJournalApprovalLifecycle);
  useEffect(() => {
    if (client == null) return;
    return client.subscribeTransport((state) => {
      if (state === "connected") composerSubmissionQueue.flush();
    });
  }, [client, composerSubmissionQueue]);

  const paletteAccountIdentity = account?.kind === "logged-in"
    ? `logged-in:${account.authId ?? account.email ?? "account"}`
    : account?.kind ?? "signed-out";
  const transcriptAccountSlot = account?.kind === "logged-in"
    ? account.authId ?? account.email ?? "account"
    : null;
  localToolPermissionScopeGate.enter(transcriptAccountSlot);
  const reactionRootCallbacks = useMemo(() => ({
    onReacted: (input: import("../recovered/features/conversation/cards/transcript-card/reaction-actions").ReactToMessageInput) => {
      if (input.agentId !== activeAgentIdRef.current) return;
      setEntriesByAgent((current) => {
        const entries = current[input.agentId];
        if (entries == null) return current;
        const next = applyOptimisticReactionUpdate(entries, input);
        return next === entries ? current : { ...current, [input.agentId]: next as ConversationTranscriptEntry[] };
      });
    },
    onAuthoritativeReactions: (update: import("../recovered/features/conversation/cards/transcript-card/reaction-actions").ReactionAuthoritativeUpdate) => {
      const agentId = update.scope.agentId;
      if (agentId == null) return;
      setEntriesByAgent((current) => {
        const entries = current[agentId];
        if (entries == null) return current;
        const next = applyAuthoritativeReactionUpdate(entries, update.entryId, update.projection);
        return next === entries ? current : { ...current, [agentId]: next as ConversationTranscriptEntry[] };
      });
    },
    onAuthoritativeCleared: (scope: import("../recovered/features/conversation/cards/transcript-card/reaction-actions").ReactionActionScope) => {
      const agentId = scope.agentId;
      if (agentId == null) return;
      setEntriesByAgent((current) => {
        const entries = current[agentId];
        if (entries == null) return current;
        const next = clearAuthoritativeReactions(entries);
        return next === entries ? current : { ...current, [agentId]: next as ConversationTranscriptEntry[] };
      });
    }
  }), []);
  const [reactionRoot] = useState(() => createProductionReactionRootScope({
    source: client,
    scope: { accountSlot: null, agentId: null },
    ...reactionRootCallbacks
  }));
  const reactionScope = useMemo(() => ({
    accountSlot: transcriptAccountSlot,
    agentId: activeAgentId.length > 0 ? activeAgentId : null
  }), [activeAgentId, transcriptAccountSlot]);
  const reactionScopeGenerationRef = useRef(0);
  const reactionLifecycleGenerationRef = useRef(0);
  const resolveReactionReactorName = useCallback((reactor: string) => agentsRef.current.find((agent) => agent.id === reactor)?.name ?? "the agent", []);
  const renderReactionPills = useCallback((props: TranscriptMessageReactionPillsProps) => {
    if (reactionRoot == null || !props.isDeliveryActionable || (props.entry.kind !== "message" && props.entry.kind !== "send-message" && props.entry.kind !== "user-attachment")) return null;
    const reactions = "reactions" in props.entry && Array.isArray(props.entry.reactions) ? props.entry.reactions : [];
    return <ReactionPills
      agentId={activeAgentId.length > 0 ? activeAgentId : null}
      controller={reactionRoot.pair.controller}
      entryId={props.entry.id}
      reactions={reactions}
      resolveReactorName={resolveReactionReactorName}
    />;
  }, [activeAgentId, reactionRoot, resolveReactionReactorName]);
  const renderReactionActions = useCallback((props: TranscriptMessageReactionSlotProps) => {
    if (reactionRoot == null || props.isReadOnly || !props.isDeliveryActionable) return null;
    if (props.entry.kind !== "message" && props.entry.kind !== "send-message" && props.entry.kind !== "user-attachment") return null;
    const reactions = "reactions" in props.entry && Array.isArray(props.entry.reactions) ? props.entry.reactions : [];
    const myReactions = "myReactions" in props.entry && props.entry.myReactions != null
      ? props.entry.myReactions
      : new Set(reactions.filter((reaction) => reaction.by === "me").map((reaction) => reaction.emoji));
    return <MessageReactionAction
      agentId={activeAgentId.length > 0 ? activeAgentId : null}
      controller={reactionRoot.pair.controller}
      entryId={props.entry.id}
      myReactions={myReactions}
      onExpandPicker={() => undefined}
      onOpenChange={props.onOpenChange}
    />;
  }, [activeAgentId, reactionRoot]);
  useEffect(() => {
    if (reactionRoot == null) return;
    reactionRoot.setScope(reactionScope);
    const generation = ++reactionScopeGenerationRef.current;
    return () => {
      queueMicrotask(() => {
        if (reactionScopeGenerationRef.current === generation) reactionRoot.reset();
      });
    };
  }, [reactionRoot, reactionScope]);
  useEffect(() => {
    if (reactionRoot == null || client == null) return;
    return client.subscribeTransport((state) => {
      if (state === "connected") reactionRoot.reconnect();
      else reactionRoot.reset();
    });
  }, [client, reactionRoot]);
  useEffect(() => {
    if (reactionRoot == null) return;
    const generation = ++reactionLifecycleGenerationRef.current;
    return () => {
      queueMicrotask(() => {
        if (reactionLifecycleGenerationRef.current === generation) reactionRoot.dispose();
      });
    };
  }, [reactionRoot]);
  const openTranscriptCardPullRequest = useCallback((url: string) => {
    void bridge.openExternal(url).catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
  }, [bridge]);

  const activeAgent = agents.find((agent) => agent.id === activeAgentId);
  const conversationOutlineAgent = conversationOutlineAgentId == null
    ? null
    : agents.find((agent) => agent.id === conversationOutlineAgentId) ?? null;
  const asyncTasksAgent = asyncTasksAgentId == null
    ? null
    : agents.find((agent) => agent.id === asyncTasksAgentId) ?? null;
  const conversationOutlineSubagents = useMemo(
    () => projectConversationOutlineSubagents(conversationOutlineAgent?.raw.subagents),
    [conversationOutlineAgent?.raw]
  );
  const closeConversationOutline = useCallback(() => {
    setConversationOutlineAgentId(null);
    const target = conversationOutlineReturnFocusRef.current;
    conversationOutlineReturnFocusRef.current = null;
    if (target?.isConnected) target.focus();
  }, []);
  const openConversationOutline = useCallback((agentId: string) => {
    if (!agentsRef.current.some((agent) => agent.id === agentId)) return;
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) conversationOutlineReturnFocusRef.current = document.activeElement;
    setOverlay(null);
    setGroupInfoPaneOpen(false);
    setAgentSettingsOpen(false);
    setRoutinesInfoPaneOpen(false);
    setRoutinesAutomationId(null);
    setChannelsInfoPaneOpen(false);
    setComputerInfoOpen(false);
    setManageSharedRoomId(null);
    setConversationOutlineAgentId(agentId);
  }, []);
  const closeAsyncTasks = useCallback(() => {
    setAsyncTasksAgentId(null);
    const target = asyncTasksReturnFocusRef.current;
    asyncTasksReturnFocusRef.current = null;
    if (target?.isConnected) target.focus();
  }, []);
  const openAsyncTasks = useCallback((agentId: string) => {
    if (accountRef.current?.kind !== "logged-in" || accountRef.current.isAnysphereUser !== true) return;
    if (!agentsRef.current.some((agent) => agent.id === agentId)) return;
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) asyncTasksReturnFocusRef.current = document.activeElement;
    setOverlay(null);
    setCommandPaletteOpen(false);
    setFindInChatOpen(false);
    setGroupInfoPaneOpen(false);
    setAgentSettingsOpen(false);
    setRoutinesInfoPaneOpen(false);
    setRoutinesAutomationId(null);
    setChannelsInfoPaneOpen(false);
    setComputerInfoOpen(false);
    setManageSharedRoomId(null);
    setAsyncTasksAgentId(agentId);
  }, []);
  const sharedRoomId = activeAgent?.remoteRoom?.roomId ?? activeAgent?.sharedRoomId ?? null;
  const sharedRoomAgents = useMemo<readonly SharedRoomAgent[]>(() => agents
    .map((agent) => projectSharedRoomAgent({
      ...agent.raw,
      id: agent.id,
      name: agent.name,
      isGroup: agent.isGroup
    }))
    .filter((agent): agent is SharedRoomAgent => agent != null), [agents]);
  const sharedRoomAccountGeneration = groupMembersRoot.roster.getAccountGeneration();
  const sharedRoomContext = useMemo<SharedRoomContext | null>(() => {
    if (account?.kind !== "logged-in" || activeAgent == null || sharedRoomId == null || (activeAgent.isGroup && activeAgent.raw.isSharedRoom !== true && activeAgent.remoteRoom == null)) return null;
    return {
      roomId: sharedRoomId,
      agentId: activeAgent.id,
      accountGeneration: sharedRoomAccountGeneration,
      agents: sharedRoomAgents
    };
  }, [account?.kind, activeAgent, sharedRoomAccountGeneration, sharedRoomAgents, sharedRoomId]);
  useEffect(() => {
    sharedRoomProvider?.setContext(sharedRoomContext);
  }, [sharedRoomContext, sharedRoomProvider]);
  const agentSettingsController = useMemo(() => {
    if (activeAgent == null) return null;
    const initialAgent = projectAgentSettingsAgent({
      ...activeAgent.raw,
      id: activeAgent.id,
      name: activeAgent.name,
      description: activeAgent.description ?? "",
      isGroup: activeAgent.isGroup,
      notifyOnUpdatesEnabled: activeAgent.raw.notifyOnUpdatesEnabled === true,
      inferenceVendorId: typeof activeAgent.raw.inferenceVendorId === "string" ? activeAgent.raw.inferenceVendorId : ""
    });
    if (initialAgent == null) return null;
    return createAgentSettingsController({
      updateAgent: (args) => client == null ? Promise.reject(new Error("coordinator is unavailable for updateAgent")) : client.call("updateAgent", args),
      setAgentNotifyOnUpdates: (args) => client == null ? Promise.reject(new Error("coordinator is unavailable for setAgentNotifyOnUpdates")) : client.call("setAgentNotifyOnUpdates", args),
      subscribe: (listener) => {
        if (client == null) return { dispose() {} };
        const stopAgents = client.subscribe("agents", (value) => listener.agents?.(value));
        const stopUpsert = client.subscribe("agent-upserted", (value) => listener["agent-upserted"]?.(value));
        return { dispose() { stopAgents(); stopUpsert(); } };
      }
    }, initialAgent);
  }, [activeAgent?.id, client, paletteAccountIdentity]);
  const agentSettingsSnapshot = useSyncExternalStore(
    agentSettingsController?.subscribe ?? emptyAgentSettingsSubscribe,
    agentSettingsController?.getSnapshot ?? readEmptyAgentSettingsSnapshot,
    agentSettingsController?.getSnapshot ?? readEmptyAgentSettingsSnapshot
  );
  const agentChannelsController = useMemo(() => {
    if (activeAgent == null || activeAgent.isGroup || client == null || account?.kind !== "logged-in") return null;
    return createAgentInfoChannelsController({
      getAgentChannels: (args) => client.call("getAgentChannels", args),
      connectChannel: (args) => client.call("connectChannel", args),
      disconnectChannel: (args) => client.call("disconnectChannel", args),
      refreshChannel: (args) => client.call("refreshChannel", args)
    }, activeAgent.id);
  }, [account?.kind, activeAgent?.id, client, paletteAccountIdentity]);
  const sidebarLayout = useSyncExternalStore(uiLayoutStore.sidebarLayout.subscribe, uiLayoutStore.sidebarLayout.get, uiLayoutStore.sidebarLayout.get);
  const [sidebarResizePreview, setSidebarResizePreview] = useState<SidebarLayoutState | null>(null);
  const sidebarResizePreviewRef = useRef<SidebarLayoutState | null>(null);
  const resizeSidebar = useCallback((expandedWidth: number) => {
    const base = sidebarResizePreviewRef.current ?? uiLayoutStore.sidebarLayout.get();
    const next = {
      ...base,
      expandedWidth: Math.max(SIDEBAR_LAYOUT_BOUNDS.minExpandedWidth, Math.min(SIDEBAR_LAYOUT_BOUNDS.maxExpandedWidth, expandedWidth))
    };
    sidebarResizePreviewRef.current = next;
    setSidebarResizePreview(next);
  }, [uiLayoutStore]);
  const finishSidebarResize = useCallback(() => {
    const pending = sidebarResizePreviewRef.current;
    sidebarResizePreviewRef.current = null;
    setSidebarResizePreview(null);
    if (pending != null) uiLayoutStore.setSidebarLayout(pending);
  }, [uiLayoutStore]);
  const renderedSidebarLayout = sidebarResizePreview ?? sidebarLayout;
  const activeDraftSnapshotStore = useMemo(
    () => composerDraftStore.snapshotsFor(activeAgentId),
    [activeAgentId, composerDraftStore]
  );
  const activeDraftSnapshot = useSyncExternalStore(
    activeAgentId.length > 0 ? activeDraftSnapshotStore.subscribe : emptyDraftSubscribe,
    activeAgentId.length > 0 ? activeDraftSnapshotStore.get : readEmptyDraftSnapshot,
    activeAgentId.length > 0 ? activeDraftSnapshotStore.get : readEmptyDraftSnapshot
  );
  const transcriptPaginationSnapshot = useSyncExternalStore(
    transcriptPaginationController.subscribe,
    transcriptPaginationController.getSnapshot,
    transcriptPaginationController.getSnapshot
  );
  useEffect(() => {
    transcriptPaginationController.setScope(transcriptAccountSlot, activeAgentId.length > 0 ? activeAgentId : null);
  }, [activeAgentId, transcriptAccountSlot, transcriptPaginationController]);
  useEffect(() => {
    replyThreadController.setScope({ accountSlot: transcriptAccountSlot, agentId: activeAgentId.length > 0 ? activeAgentId : null });
  }, [activeAgentId, replyThreadController, transcriptAccountSlot]);
  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    const transcript = document.querySelector<HTMLElement>(".sand-virtual-transcript");
    transcriptPaginationController.bindViewport(transcript);
    setFindTranscriptContainer(transcript);
    return () => {
      transcriptPaginationController.bindViewport(null);
      setFindTranscriptContainer(null);
    };
  }, [activeAgentId, transcriptPaginationController]);
  useLayoutEffect(() => {
    transcriptPaginationController.onEntriesCommitted();
  }, [transcriptPaginationController, transcriptPaginationSnapshot.entries]);
  const accessRosterSnapshot = useSyncExternalStore(
    accessRosterStore?.subscribe ?? emptyAccessRosterSubscribe,
    accessRosterStore?.get ?? readEmptyAccessRosterSnapshot,
    accessRosterStore?.get ?? readEmptyAccessRosterSnapshot
  );
  const subscribeRebuildStores = useCallback((listener: () => void) => {
    const notify = () => {
      rebuildRevisionRef.current += 1;
      listener();
    };
    const stops = [rebuildMigrationStore, rebuildBoxStore, rebuildTransportStore]
      .filter((store): store is NonNullable<typeof store> => store != null)
      .map((store) => store.subscribe(notify));
    return () => { for (const stop of stops) stop(); };
  }, [rebuildBoxStore, rebuildMigrationStore, rebuildTransportStore]);
  const readRebuildRevision = useCallback(() => rebuildRevisionRef.current, []);
  const rebuildRevision = useSyncExternalStore(subscribeRebuildStores, readRebuildRevision, readRebuildRevision);
  // @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L137278
  const pluginPrivateSkillSource = useMemo(
    () => client == null ? undefined : {
      getAgentWorkflows: (id: string) => client.call("getAgentWorkflows", { id }),
      deleteAgentWorkflow: (id: string, workflowId: string) => client.call("deleteAgentWorkflow", { id, workflowId }),
      updateAgentWorkflow: (id: string, workflowId: string, spec: unknown) => client.call("updateAgentWorkflow", { id, workflowId, spec }),
      getSkillPublishTargets: () => client.call("getSkillPublishTargets"),
      publishSkill: (workflowId: string, teamId: string) => client.call("publishSkill", { workflowId, teamId }),
      resyncPublishedSkill: (workflowId: string) => client.call("resyncPublishedSkill", { workflowId }),
      unpublishSkill: (workflowId: string) => client.call("unpublishSkill", { workflowId })
    },
    [client]
  );
  const privateSkillEnableSource = useMemo(
    () => client == null ? undefined : {
      setAgentWorkflowEnabled: (id: string, workflowId: string, isEnabled: boolean) => client.call("setAgentWorkflowEnabled", { id, workflowId, isEnabled })
    },
    [client]
  );
  const visibleAgents = agents.filter((agent) => !agent.isHidden).map((agent) => ({ ...agent, isPinned: pinnedAgentIds.includes(agent.id) }));
  const pinnedAccountKey = account?.kind === "logged-in" ? account.authId ?? account.email ?? "account" : account?.kind ?? "unknown";
  const settingsNoticeSurface = overlay === "settings" || overlay === "plugins" ? overlay : "none";
  const settingsNoticeScope = `${pinnedAccountKey}:${account?.kind ?? "unknown"}:${settingsNoticeSurface}`;
  const settingsNoticeScopeRef = useRef({ scope: settingsNoticeScope, generation: 0 });
  if (settingsNoticeScopeRef.current.scope !== settingsNoticeScope) {
    settingsNoticeScopeRef.current = {
      scope: settingsNoticeScope,
      generation: settingsNoticeScopeRef.current.generation + 1
    };
  }
  const settingsNoticeGeneration = settingsNoticeScopeRef.current.generation;
  const publishSettingsNotice = useCallback((event: import("./settings-notice-controller").RootSettingsNoticeEvent) => {
    if (settingsNoticeScopeRef.current.generation !== settingsNoticeGeneration) return;
    settingsNoticeController.publish(event);
  }, [settingsNoticeController, settingsNoticeGeneration]);
  useEffect(() => {
    settingsNoticeController.reset();
  }, [settingsNoticeController, settingsNoticeScope]);
  const editorProviders = useMemo(() => {
    const providers = editorSuggestionAdapter == null ? {} : {
      ...editorSuggestionAdapter.providers,
      mention: editorSuggestionAdapter.providers.mention == null
        ? undefined
        : {
            ...editorSuggestionAdapter.providers.mention,
            getMcpReferences: () => editorMcpReferenceProvider.getRows()
          }
    };
    return {
      ...providers,
      prReference: { getCandidates: () => editorPrReferenceProvider.getCandidates() }
    };
  }, [editorMcpReferenceProvider, editorPrReferenceProvider, editorSuggestionAdapter]);
  useEffect(() => {
    if (editorSuggestionAdapter == null) return;
    const scopedAgentId = activeAgentId.length > 0 ? activeAgentId : null;
    editorSuggestionAdapter.setScope({ accountKey: transcriptAccountSlot, agentId: scopedAgentId });
    if (transport === "connected" && transcriptAccountSlot != null && scopedAgentId != null) {
      void editorSuggestionAdapter.refresh();
    }
  }, [activeAgentId, editorSuggestionAdapter, transcriptAccountSlot, transport]);
  useEffect(() => {
    const scopedAgentId = activeAgentId.length > 0 ? activeAgentId : null;
    editorMcpReferenceProvider.setScope({ accountKey: transcriptAccountSlot, agentId: scopedAgentId });
    if (transport === "connected" && transcriptAccountSlot != null && scopedAgentId != null) {
      void editorMcpReferenceProvider.refresh();
    } else if (transport !== "connected") {
      editorMcpReferenceProvider.noteReconnect();
    }
  }, [activeAgentId, editorMcpReferenceProvider, transcriptAccountSlot, transport]);
  const pluginAuthAccountSlot = account?.kind === "logged-in" ? pinnedAccountKey : null;
  const pluginAuthSnapshot = useSyncExternalStore(
    pluginAuthAdapter.subscribe,
    pluginAuthAdapter.getSnapshot,
    pluginAuthAdapter.getSnapshot
  );
  useEffect(() => {
    pluginAuthAdapter.setScope({
      accountKey: pluginAuthAccountSlot,
      agents: agents.map((agent) => ({
        id: agent.id,
        ...(typeof agent.raw.purpose === "string" ? { purpose: agent.raw.purpose } : {})
      })),
      isRosterComplete: hasLoadedAgents
    });
  }, [agents, hasLoadedAgents, pluginAuthAccountSlot, pluginAuthAdapter]);
  useEffect(() => {
    if (pluginAuthAccountSlot == null || overlay !== "plugins" || transport !== "connected") return;
    void pluginAuthAdapter.refresh().catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
  }, [overlay, pluginAuthAccountSlot, pluginAuthAdapter, transport]);
  useEffect(() => {
    if (pluginAuthAccountSlot == null) return;
    return bridge.mcp.onAuthCompleted(() => {
      void pluginAuthAdapter.refresh().catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
    });
  }, [bridge, pluginAuthAccountSlot, pluginAuthAdapter]);
  const openPluginAuthAgent = useCallback(() => {
    const controller = pluginAuthAdapter.getSnapshot().controller;
    if (controller == null) return;
    void controller.fix().catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
  }, [pluginAuthAdapter]);
  const pluginAuthBanner = pluginAuthSnapshot.status === "ready" && pluginAuthSnapshot.plugin != null && pluginAuthSnapshot.plugin.authBlocked.length > 0
    ? {
      authBlocked: pluginAuthSnapshot.plugin.authBlocked,
      isLaunching: pluginAuthSnapshot.plugin.isLaunching,
      onFix: openPluginAuthAgent
    }
    : undefined;
  const avatarEditorSnapshot = useSyncExternalStore(
    avatarEditorAdapter.subscribe,
    avatarEditorAdapter.getSnapshot,
    avatarEditorAdapter.getSnapshot
  );
  const avatarEditorReady = account?.kind === "logged-in"
    && activeAgent != null
    && !activeAgent.isGroup
    && avatarEditorSnapshot.status === "ready"
    && avatarEditorSnapshot.controller != null;
  useEffect(() => {
    avatarEditorAdapter.setScope({
      accountKey: account?.kind === "logged-in" ? pinnedAccountKey : null,
      agent: client == null || activeAgent == null ? null : {
        id: activeAgent.id,
        isGroup: activeAgent.isGroup,
        avatarDataUrl: activeAgent.avatarDataUrl,
        avatarShape: activeAgent.avatarShape,
        avatarColor: activeAgent.avatarColor
      }
    });
    setAvatarEditorOpen(false);
  }, [account?.kind, activeAgent?.avatarColor, activeAgent?.avatarDataUrl, activeAgent?.avatarShape, activeAgent?.id, activeAgent?.isGroup, avatarEditorAdapter, client, pinnedAccountKey]);
  const asyncTasksAccountSlot = account?.kind === "logged-in" ? pinnedAccountKey : null;
  useEffect(() => {
    if (asyncTasksProvider == null || client == null || asyncTasksAccountSlot == null) {
      asyncTasksProvider?.reset();
      return;
    }
    let active = true;
    let wasConnected = transport === "connected";
    asyncTasksProvider.reset();
    if (wasConnected) asyncTasksProvider.connect();
    const stopTransport = client.subscribeTransport((state) => {
      if (!active) return;
      if (state === "connected") {
        if (wasConnected) asyncTasksProvider.noteReconnect();
        else asyncTasksProvider.connect();
        wasConnected = true;
      } else {
        wasConnected = false;
        asyncTasksProvider.reset();
      }
    });
    const stopEvents = client.subscribe("async-tasks", (value) => {
      if (active) asyncTasksProvider.ingestAsyncTasksEvent(value);
    });
    return () => {
      active = false;
      stopTransport();
      stopEvents();
      asyncTasksProvider.reset();
    };
  }, [asyncTasksAccountSlot, asyncTasksProvider, client, transport]);
  useEffect(() => {
    conversationOutlineProvider.setAccount(account?.kind === "logged-in" ? pinnedAccountKey : null);
    setConversationOutlineAgentId(null);
  }, [account?.kind, conversationOutlineProvider, pinnedAccountKey]);
  useEffect(() => {
    setAsyncTasksAgentId(null);
    asyncTasksReturnFocusRef.current = null;
  }, [activeAgentId, asyncTasksAccountSlot]);
  useEffect(() => {
    if (asyncTasksAgentId == null || agents.some((agent) => agent.id === asyncTasksAgentId)) return;
    setAsyncTasksAgentId(null);
    asyncTasksReturnFocusRef.current = null;
  }, [agents, asyncTasksAgentId]);
  const hiddenChatsAccountSlot = account?.kind === "logged-in" ? pinnedAccountKey : null;
  useEffect(() => {
    hiddenChatsMutationController.setScope(hiddenChatsAccountSlot, activeAgentId.length > 0 ? activeAgentId : null);
  }, [activeAgentId, hiddenChatsAccountSlot, hiddenChatsMutationController]);
  useEffect(() => {
    hiddenChatsMutationController.ingestAgents(agents);
  }, [agents, hiddenChatsMutationController]);
  useEffect(() => {
    if (transport === "connected") hiddenChatsMutationController.noteReconnect();
  }, [hiddenChatsMutationController, transport]);
  const [teachRecordingFeatureEnabled, setTeachRecordingFeatureEnabled] = useState(
    () => teachRecordingFeatureGate(bridge.experiments.initialSnapshot)
  );
  useEffect(() => bridge.experiments.onChanged((snapshot) => setTeachRecordingFeatureEnabled(teachRecordingFeatureGate(snapshot))), [bridge]);
  const [teachRecordingStore] = useState(() => client == null ? null : createTeachRecordingStore({
    source: {
      getTeachRecordingStatus: () => client.call("getTeachRecordingStatus").then(requireTeachRecordingStatus),
      startTeachRecording: (input) => client.call("startTeachRecording", input).then(requireTeachRecordingStatus),
      stopTeachRecording: (input) => client.call("stopTeachRecording", input).then(requireTeachRecordingStatus)
    },
    clock: { now: () => Date.now() },
    pollingPolicy: createTeachRecordingPollingPolicy
  }));
  const teachRecordingAgentId = activeAgent == null || activeAgent.isGroup ? null : activeAgent.id;
  const teachRecordingAccountSlot = account?.kind === "logged-in" ? pinnedAccountKey : null;
  const teachRecordingLifecycleGenerationRef = useRef(0);
  useEffect(() => {
    if (teachRecordingStore == null) return;
    const generation = ++teachRecordingLifecycleGenerationRef.current;
    return () => {
      queueMicrotask(() => {
        if (teachRecordingLifecycleGenerationRef.current === generation) teachRecordingStore.dispose();
      });
    };
  }, [teachRecordingStore]);
  useEffect(() => {
    if (teachRecordingStore == null) return;
    teachRecordingStore.reset();
    if (teachRecordingAccountSlot != null && teachRecordingAgentId != null && transport === "connected") teachRecordingStore.connect();
  }, [teachRecordingAccountSlot, teachRecordingAgentId, teachRecordingStore, transport]);
  useEffect(() => {
    if (teachRecordingStore == null || client == null) return;
    return client.subscribeTransport((state) => {
      if (state === "connected" && teachRecordingAccountSlot != null && teachRecordingAgentId != null) teachRecordingStore.noteReconnect();
      else if (state === "down") teachRecordingStore.reset();
    });
  }, [client, teachRecordingAccountSlot, teachRecordingAgentId, teachRecordingStore]);
  const acknowledgementAccountSlot = account?.kind === "logged-in" ? pinnedAccountKey : null;
  useEffect(() => {
    acknowledgementScopeRef.current = { accountSlot: acknowledgementAccountSlot, agentId: activeAgentId.length > 0 ? activeAgentId : null };
    acknowledgementController.setScope(acknowledgementAccountSlot, activeAgentId.length > 0 ? activeAgentId : null);
  }, [acknowledgementAccountSlot, acknowledgementController, activeAgentId]);
  useEffect(() => {
    sendJournalApprovalLifecycle.reset();
  }, [acknowledgementAccountSlot, activeAgentId, sendJournalApprovalLifecycle]);
  const approvalClearSnapshot = useSyncExternalStore(
    sendJournalApprovalLifecycle.subscribe,
    sendJournalApprovalLifecycle.getApprovalClearSnapshot,
    sendJournalApprovalLifecycle.getApprovalClearSnapshot
  );
  useEffect(() => {
    if (approvalClearSnapshot.status === "failed") setNotice(String(approvalClearSnapshot.failure));
  }, [approvalClearSnapshot]);
  const sidebarSectionRecords = useSyncExternalStore(sidebarSectionsStore.subscribe, sidebarSectionsStore.get, sidebarSectionsStore.get);
  const sidebarSectionsWriteFailure = useSyncExternalStore(sidebarSectionsStore.subscribe, sidebarSectionsStore.getWriteFailure, sidebarSectionsStore.getWriteFailure);
  const collapsedSectionIds = useSyncExternalStore(sidebarCollapseStore.subscribe, sidebarCollapseStore.getCollapsedSectionIds, sidebarCollapseStore.getCollapsedSectionIds);
  const sidebarSections = useMemo(() => sidebarSectionRecords?.map((section) => ({ ...section, isCollapsed: collapsedSectionIds.includes(section.id) })) ?? null, [collapsedSectionIds, sidebarSectionRecords]);
  const projectedSidebarSections = useMemo(() => sidebarSections == null ? undefined : projectSidebarSections({ agents: visibleAgents, pinnedIds: pinnedAgentIds, sections: sidebarSections }), [pinnedAgentIds, sidebarSections, visibleAgents]);

  useEffect(() => {
    if (sidebarSectionsWriteFailure != null) setNotice(sidebarSectionsWriteFailure.code);
  }, [sidebarSectionsWriteFailure]);
  const hiddenAgents = agents.filter((agent) => agent.isHidden);
  const orgChartAgents = useMemo(() => agents.map((agent) => ({ ...agent, isRunning: agent.isRunning === true })), [agents]);
  const liveEntries = activeAgent == null ? EMPTY_ENTRIES : entriesByAgent[activeAgent.id] ?? EMPTY_ENTRIES;
  const entries = useMemo(
    () => transcriptPaginationSnapshot.agentId === activeAgentId && transcriptPaginationSnapshot.accountSlot === transcriptAccountSlot
      ? mergeOlderTranscriptEntries(liveEntries, transcriptPaginationSnapshot.entries)
      : liveEntries,
    [activeAgentId, liveEntries, transcriptAccountSlot, transcriptPaginationSnapshot.accountSlot, transcriptPaginationSnapshot.agentId, transcriptPaginationSnapshot.entries]
  );
  useEffect(() => {
    findInChatController.setScope(transcriptAccountSlot, activeAgentId.length > 0 ? activeAgentId : null);
    if (account?.kind !== "logged-in" || activeAgentId.length === 0) setFindInChatOpen(false);
  }, [account?.kind, activeAgentId, findInChatController, transcriptAccountSlot]);
  useEffect(() => {
    findInChatController.replaceEntries(entries);
  }, [entries, findInChatController]);
  useEffect(() => {
    const scopedAccountKey = account?.kind === "logged-in" && transport === "connected" ? transcriptAccountSlot : null;
    const scopedAgentId = scopedAccountKey == null || activeAgentId.length === 0 ? null : activeAgentId;
    editorPrReferenceProvider.setScope({ accountKey: scopedAccountKey, agentId: scopedAgentId });
    if (scopedAccountKey == null || scopedAgentId == null) {
      editorPrReferenceProvider.reset();
      return;
    }
    editorPrReferenceProvider.setEntries(entries);
  }, [account?.kind, activeAgentId, editorPrReferenceProvider, entries, transcriptAccountSlot, transport]);
  useEffect(() => {
    spreadsheetViewerProvider.reset();
    spreadsheetTriggerRef.current = null;
    setSpreadsheetViewerMount(null);
  }, [activeAgentId, spreadsheetViewerProvider, transcriptAccountSlot]);
  useEffect(() => {
    const transcript = findTranscriptContainer;
    if (transcript == null || account?.kind !== "logged-in" || activeAgentId.length === 0) return undefined;
    const attachmentsByPath = new Map<string, DraftAttachment>();
    for (const entry of entries) {
      for (const attachment of entry.kind === "message" ? entry.attachments ?? [] : []) attachmentsByPath.set(attachment.path, attachment);
    }
    const chips = [...transcript.querySelectorAll<HTMLElement>(".sand-file-attachment-chip")]
      .filter((chip) => chip.dataset.kind === "table");
    const cleanups = chips.map((chip) => {
      const attachment = attachmentsByPath.get(chip.title);
      const projection = attachment == null ? null : spreadsheetViewerProvider.project(attachment);
      if (attachment == null || projection == null) return () => {};
      const previousRole = chip.getAttribute("role");
      const previousTabIndex = chip.getAttribute("tabindex");
      const previousLabel = chip.getAttribute("aria-label");
      chip.setAttribute("aria-label", `Open ${projection.name}`);
      chip.setAttribute("role", "button");
      chip.tabIndex = 0;
      const open = () => {
        const mount = spreadsheetViewerProvider.mount(attachment);
        if (mount == null) return;
        spreadsheetTriggerRef.current = chip;
        setSpreadsheetViewerMount(mount);
      };
      const onClick = (event: MouseEvent) => {
        event.preventDefault();
        open();
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open();
      };
      chip.addEventListener("click", onClick);
      chip.addEventListener("keydown", onKeyDown);
      return () => {
        chip.removeEventListener("click", onClick);
        chip.removeEventListener("keydown", onKeyDown);
        if (previousRole == null) chip.removeAttribute("role"); else chip.setAttribute("role", previousRole);
        if (previousTabIndex == null) chip.removeAttribute("tabindex"); else chip.setAttribute("tabindex", previousTabIndex);
        if (previousLabel == null) chip.removeAttribute("aria-label"); else chip.setAttribute("aria-label", previousLabel);
      };
    });
    return () => { for (const cleanup of cleanups) cleanup(); };
  }, [account?.kind, activeAgentId, entries, findTranscriptContainer, spreadsheetViewerProvider]);
  const closeFindInChat = useCallback(() => {
    setFindInChatOpen(false);
    const restoreFocus = () => findTranscriptContainer?.focus();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(restoreFocus);
    else restoreFocus();
  }, [findTranscriptContainer]);
  const closeSpreadsheetViewer = useCallback(() => {
    spreadsheetViewerMount?.close();
    setSpreadsheetViewerMount(null);
    const restoreFocus = () => spreadsheetTriggerRef.current?.focus();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(restoreFocus);
    else restoreFocus();
  }, [spreadsheetViewerMount]);
  const transcriptCardScope = useMemo(() => ({
    accountSlot: client == null ? null : transcriptAccountSlot,
    agentId: client == null || activeAgentId.length === 0 ? null : activeAgentId
  }), [activeAgentId, client, transcriptAccountSlot]);
  const createTranscriptCardAutoReviewApproval = useCallback((input: AutoReviewApprovalActionInput) => {
    const actions = createAutoReviewApprovalActions(input, {
      instructions: transcriptCardAutoReviewInstructions,
      resolver: {
        async resolveAutoReviewApproval(request) {
          try {
            await client?.call("resolveAutoReviewApproval", request);
            return "resolved";
          } catch (error) {
            if (error instanceof CoordinatorCallError && error.code === "auto-review/stale") return "stale";
            if (typeof error === "object" && error != null && "code" in error && error.code === "auto-review/stale") return "stale";
            throw error;
          }
        }
      }
    });
    transcriptCardAutoReviewActionsRef.current.add(actions);
    return actions;
  }, [client, transcriptCardAutoReviewInstructions]);
  const transcriptCardContract = useMemo(() => createTranscriptCardRootMountContract({
    scope: transcriptCardScope,
    registry: transcriptCardResolver,
    widgetInteractions: transcriptCardWidgetInteractions,
    cloudAgents: transcriptCardCloudAgents,
    leafProviders: {
      autoReviewApproval: createTranscriptCardAutoReviewApproval,
      listenerIntegrations: transcriptCardListenerIntegrations,
      secretRequests: transcriptCardSecretRequests,
      attachments: transcriptCardAttachments,
      connectors: transcriptCardConnectors,
      urlCards: transcriptCardUrlCards,
      onOpenPullRequest: openTranscriptCardPullRequest
    }
  }), [createTranscriptCardAutoReviewApproval, openTranscriptCardPullRequest, transcriptCardAttachments, transcriptCardCloudAgents, transcriptCardConnectors, transcriptCardListenerIntegrations, transcriptCardResolver, transcriptCardScope, transcriptCardSecretRequests, transcriptCardUrlCards, transcriptCardWidgetInteractions]);
  const transcriptCardEntries = useMemo(
    () => transcriptCardContract.projectEntries(entries),
    [entries, transcriptCardContract]
  );
  const pendingLocalToolPermission = useMemo<LocalToolPermissionRequest | null>(() => {
    if (account?.kind !== "logged-in" || transcriptAccountSlot == null) return null;
    const entry = transcriptCardEntries.find((candidate) => candidate.kind === "send-message"
      && candidate.message.type === "local-tool-permission"
      && candidate.message.ask.status === "pending"
      && typeof candidate.permissionScope === "string"
      && candidate.permissionScopeRevision != null
      && localToolPermissionScopeGate.accepts(candidate.permissionScope, candidate.permissionScopeRevision));
    if (entry != null && entry.message.type === "local-tool-permission") {
      return { entryId: entry.id, agentId: activeAgent?.id ?? null, ask: entry.message.ask };
    }
    // projectTranscriptEntry retains this shipped event as the legacy transcript
    // kind; keep the same first-pending ordering when that projection is active.
    const legacyEntry = entries.find((candidate): candidate is Extract<(typeof entries)[number], { kind: "local-tool-permission" }> => candidate.kind === "local-tool-permission"
      && candidate.ask.status === "pending"
      && candidate.permissionScope === transcriptAccountSlot
      && candidate.permissionScopeRevision != null
      && localToolPermissionScopeGate.accepts(candidate.permissionScope, candidate.permissionScopeRevision));
    return legacyEntry == null
      ? null
      : { entryId: legacyEntry.entryId, agentId: activeAgent?.id ?? legacyEntry.agentId, ask: legacyEntry.ask };
  }, [account?.kind, activeAgent?.id, entries, localToolPermissionScopeGate, transcriptAccountSlot, transcriptCardEntries]);
  const localToolPermissionDock = <LocalToolPermissionDock
    isEscapeTarget={true}
    request={pendingLocalToolPermission}
    resolveLocalToolPermission={(input) => client == null
      ? Promise.reject(new Error("coordinator is unavailable for resolveLocalToolPermission"))
      : client.call("resolveLocalToolPermission", input)}
    store={localToolPermissionStore}
    transportState={transport === "down" ? "down" : "connected"}
  />;
  const transcriptCardSecretEntries = useMemo(
    () => transcriptCardEntries.filter((entry): entry is SecretRequestEntry => entry.message.type === "secret-request"),
    [transcriptCardEntries]
  );
  useEffect(() => {
    transcriptCardWidgetInteractions.setScope(transcriptCardScope);
    transcriptCardCloudAgents.setScope(transcriptCardScope);
    transcriptCardWidgetInteractions.replaceEntries(transcriptCardEntries);
  }, [transcriptCardCloudAgents, transcriptCardEntries, transcriptCardScope, transcriptCardWidgetInteractions]);
  useEffect(() => {
    const actionScope = `${transcriptCardScope.accountSlot ?? ""}:${transcriptCardScope.agentId ?? ""}`;
    if (transcriptCardAutoReviewActionScopeRef.current != null && transcriptCardAutoReviewActionScopeRef.current !== actionScope) {
      for (const actions of transcriptCardAutoReviewActionsRef.current) actions.dispose();
      transcriptCardAutoReviewActionsRef.current.clear();
    }
    transcriptCardAutoReviewActionScopeRef.current = actionScope;
    transcriptCardListenerIntegrations?.setScope(transcriptCardScope);
    transcriptCardSecretRequests?.setScope(transcriptCardScope);
    transcriptCardUrlCards.reset();
    transcriptCardConnectors.close();
    if (account?.kind === "logged-in" && client != null) {
      if (transcriptCardListenerSubscriptionRef.current == null && transcriptCardListenerIntegrations != null) {
        transcriptCardListenerSubscriptionRef.current = transcriptCardListenerIntegrations.snapshots.subscribe(() => {});
      }
      transcriptCardConnectors.open();
    } else {
      transcriptCardListenerSubscriptionRef.current?.();
      transcriptCardListenerSubscriptionRef.current = null;
    }
  }, [account?.kind, client, transcriptCardConnectors, transcriptCardListenerIntegrations, transcriptCardSecretRequests, transcriptCardScope, transcriptCardUrlCards]);
  useEffect(() => {
    transcriptCardSecretRequests?.replaceEntries(transcriptCardSecretEntries);
  }, [transcriptCardSecretEntries, transcriptCardSecretRequests]);
  useEffect(() => {
    const generation = ++transcriptCardLifecycleGenerationRef.current;
    return () => {
      queueMicrotask(() => {
        if (transcriptCardLifecycleGenerationRef.current !== generation) return;
        transcriptCardWidgetInteractions.dispose();
        transcriptCardCloudAgents.dispose();
        transcriptCardListenerSubscriptionRef.current?.();
        transcriptCardListenerSubscriptionRef.current = null;
        transcriptCardListenerIntegrations?.dispose();
        transcriptCardSecretRequests?.dispose();
        transcriptCardConnectors.dispose();
        transcriptCardUrlCards.dispose();
        for (const actions of transcriptCardAutoReviewActionsRef.current) actions.dispose();
        transcriptCardAutoReviewActionsRef.current.clear();
      });
    };
  }, [transcriptCardCloudAgents, transcriptCardConnectors, transcriptCardListenerIntegrations, transcriptCardSecretRequests, transcriptCardUrlCards, transcriptCardWidgetInteractions]);
  useEffect(() => {
    if (client == null) return;
    return client.subscribeTransport((state) => {
      if (state !== "connected") return;
      transcriptCardListenerIntegrations?.noteReconnect();
      transcriptCardUrlCards.noteReconnect();
    });
  }, [client, transcriptCardListenerIntegrations, transcriptCardUrlCards]);
  useEffect(() => {
    replyThreadController.replaceEntries(entries);
  }, [entries, replyThreadController]);
  const transcriptCardInteractions = useMemo<TranscriptCardInteractionContext>(() => ({
    threadRootId: null,
    isReadOnly: activeAgent == null || activeAgent.isGroup,
    onReply: (entryId) => { replyThreadController.selectReply(entryId); },
    onThread: (entryId) => { replyThreadController.navigate(entryId); },
    getThreadSummary: () => null,
    openThread: (targetId) => { replyThreadController.navigate(targetId); },
    resolveEntry: (targetId) => {
      const entry = entries.find((candidate) => candidate.id === targetId);
      return entry != null && isTranscriptCardActionEntry(entry) ? entry : null;
    },
    scrollToEntry: (targetId) => {
      if (typeof document === "undefined") return;
      const row = [...document.querySelectorAll<HTMLElement>("[data-entry-id]")]
        .find((candidate) => candidate.dataset.entryId === targetId);
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    isEntryInScope: (targetId) => replyThreadController.resolve(targetId).isInScope,
  }), [activeAgent, entries, replyThreadController]);
  const loadOlderTranscript = useCallback(() => transcriptPaginationController.loadOlder(), [transcriptPaginationController]);
  const paletteLinks = useMemo(
    () => commandPaletteLinksFromConversation(commandPaletteOpen ? conversationLinkCandidates(entries) : []),
    [commandPaletteOpen, entries]
  );
  useEffect(() => {
    void linkMetadataProvider.setUrls(paletteLinks.map((link) => link.url));
  }, [linkMetadataProvider, paletteLinks]);
  const baseDraft = activeDraftSnapshot.draft ?? activeDraftSnapshot.recovery ?? EMPTY_DRAFT;
  const draft = replyThreadController.applyReplyToDraft(baseDraft);
  const clearReplyTarget = useCallback(() => {
    replyThreadController.clearReply();
    if (activeAgentId.length > 0 && activeDraftSnapshot.draft != null) {
      composerDraftStore.setDraft(activeAgentId, replyThreadController.clearReplyFromDraft(activeDraftSnapshot.draft));
    }
  }, [activeAgentId, activeDraftSnapshot.draft, composerDraftStore, replyThreadController]);
  const replyTarget: ComposerReplyTarget | undefined = replySelection == null
    ? undefined
    : { targetId: replySelection.targetId, preview: replySelection.preview };
  const transcribeAudio = useCallback((audio: Uint8Array, mimeType: string, language?: string) => bridge.transcribeAudio(audio, mimeType, language), [bridge]);
  const resolveAttachmentMedia = useCallback((source: string) => bridge.resolveAttachmentMedia(source), [bridge]);
  const computer = useComputerExperience({ activeAgentId: activeAgent?.isGroup === true ? null : activeAgent?.id ?? null, bridge, client });
  const teachRecordingComposition = useTeachRecordingComputerComposition({
    activeAgentId: teachRecordingAgentId,
    featureEnabled: teachRecordingFeatureEnabled,
    hasHandoff: computer.view.handoff != null || computer.monitors.some((monitor) => monitor.handoff != null),
    hasLiveStage: computer.monitors.length > 0 || computer.view.vncUrl != null,
    isFullscreen: computer.isOpen,
    onMinimize: computer.close,
    onRequestComposerFocus: () => document.querySelector<HTMLElement>(".sand-prompt-form textarea, .sand-prompt-form [contenteditable='true']")?.focus(),
    openTrigger: computer.openTrigger,
    platform: bridge.platform,
    recordingAgentName: activeAgent?.name,
    subjectLabel: activeAgent?.name ?? "",
    store: teachRecordingStore ?? EMPTY_TEACH_RECORDING_STORE
  });
  const activeComputerStatusSnapshots = useMemo(
    () => activeAgent == null || activeAgent.isGroup || computer.statusStore == null ? null : computer.statusStore.statusSnapshotsFor(activeAgent.id),
    [activeAgent, computer.statusStore]
  );
  const subscribeActiveComputerStatus = useCallback(
    (listener: () => void) => activeComputerStatusSnapshots?.subscribe(listener) ?? (() => {}),
    [activeComputerStatusSnapshots]
  );
  const readActiveComputerStatus = useCallback(
    () => readComputerStatusSnapshot(activeComputerStatusSnapshots),
    [activeComputerStatusSnapshots]
  );
  const activeComputerStatus = useSyncExternalStore(subscribeActiveComputerStatus, readActiveComputerStatus, readActiveComputerStatus);
  const activeComputerImageUpdateAvailable = useMemo(
    () => activeComputerStatus.status?.imageUpdateAvailable === true
      || computer.statusStore?.getStatus(activeAgent?.id ?? null)?.imageUpdateAvailable === true,
    [activeAgent?.id, activeComputerStatus.status?.imageUpdateAvailable, computer.statusStore]
  );
  const settingsComputerScope = `${account?.kind === "logged-in" ? pinnedAccountKey : "signed-out"}:${activeAgent?.id ?? ""}`;
  const settingsComputerGenerationRef = useRef(0);
  const settingsComputerQueueDispatchRef = useRef<string | null>(null);
  const [settingsComputerActionState, setSettingsComputerActionState] = useState<SettingsComputerActionState>(() => ({
    scope: settingsComputerScope,
    pending: null,
    isUpdateQueued: false,
    isBlocked: false
  }));
  useEffect(() => {
    settingsComputerGenerationRef.current += 1;
    settingsComputerQueueDispatchRef.current = null;
    setSettingsComputerActionState({ scope: settingsComputerScope, pending: null, isUpdateQueued: false, isBlocked: false });
  }, [settingsComputerScope]);
  const scopedSettingsComputerActionState = settingsComputerActionState.scope === settingsComputerScope
    ? settingsComputerActionState
    : { scope: settingsComputerScope, pending: null, isUpdateQueued: false, isBlocked: false };
  const settingsComputerRebuildStates = useMemo(
    () => [
      rebuildMigrationStore.get(),
      ...(rebuildBoxStore == null ? [] : [rebuildBoxStore.get()]),
      ...(rebuildTransportStore == null ? [] : [rebuildTransportStore.get()])
    ],
    [rebuildBoxStore, rebuildMigrationStore, rebuildRevision, rebuildTransportStore]
  );
  const computerRebuildBannerInput = useMemo<ComputerRebuildBannerInput>(() => {
    const migrationState = rebuildMigrationStore.get();
    const boxState = rebuildBoxStore?.get() ?? null;
    const transportState = rebuildTransportStore?.get() ?? null;
    const migrationSnapshot = rebuildMigrationStore.getSnapshot();
    const boxStatus = rebuildBoxStore?.getStatus();
    const boxPull = boxStatus != null && typeof boxStatus.pull === "object" && boxStatus.pull != null && !Array.isArray(boxStatus.pull)
      ? (boxStatus.pull as Record<string, unknown>)
      : null;
    const pullPercent = typeof boxPull?.percent === "number" && Number.isFinite(boxPull.percent) ? boxPull.percent : null;
    const activeState = migrationState.kind != null
      ? migrationState
      : boxState?.kind != null
        ? boxState
        : transportState;
    const stage = activeState?.kind === "update" || activeState?.kind === "reset" || activeState?.kind === "recover"
      ? activeState.boxPhase === "pulling" ? "downloading" : activeState.boxPhase
      : activeState?.boxPhase ?? null;
    const transport = rebuildTransportStore?.getTransportState() ?? "connected";
    return {
      kind: activeState?.kind ?? (transport === "down" ? "reconnecting" : null),
      stage,
      migrationStatus: migrationSnapshot.phase,
      migrationPhases: migrationSnapshot.migrationPhases,
      pullPercent
    };
  }, [rebuildBoxStore, rebuildMigrationStore, rebuildRevision, rebuildTransportStore]);
  const computerReconnectTransport = rebuildTransportStore?.getTransportState() ?? "connected";
  const restoreComputerProgress = useCallback(() => {
    setOverlay(null);
    setCommandPaletteOpen(false);
    setManageSharedRoomId(null);
    setGroupInfoPaneOpen(false);
    setAgentSettingsOpen(false);
    setRoutinesInfoPaneOpen(false);
    setChannelsInfoPaneOpen(false);
    setComputerInfoOpen(true);
  }, []);
  const settingsComputerCanUpdateBaseline = account?.kind === "logged-in" && activeAgent != null && !activeAgent.isGroup;
  const settingsComputerWorkingAgentNames = useMemo(
    () => agents.filter((agent) => agent.isRunning).map((agent) => agent.name),
    [agents]
  );
  const settingsComputerCanUpdateBox = settingsComputerCanUpdateBaseline && settingsComputerWorkingAgentNames.length === 0;
  const runSettingsComputerAction = useCallback(async (kind: SettingsComputerActionKind, force = false): Promise<unknown> => {
    if (bridge == null || activeAgent == null || activeAgent.isGroup || !settingsComputerCanUpdateBaseline || scopedSettingsComputerActionState.isBlocked) return undefined;
    const generation = settingsComputerGenerationRef.current;
    const scope = settingsComputerScope;
    setSettingsComputerActionState((previous) => previous.scope === scope
      ? { ...previous, pending: kind, isUpdateQueued: false }
      : previous);
    try {
      const response = kind === "update"
        ? await bridge.foreverBox.update(activeAgent.id, force)
        : await bridge.foreverBox.forceRecreate();
      if (settingsComputerGenerationRef.current !== generation) return response;
      const result = computerActionResult(response);
      if (result?.status === "started-untrackable") {
        setSettingsComputerActionState((previous) => previous.scope === scope ? { ...previous, isBlocked: true } : previous);
        setNotice(kind === "update" ? COMPUTER_UPDATE_UNTRACKABLE_COPY : COMPUTER_RESET_UNTRACKABLE_COPY);
      } else if (result?.status === "rejected" && result.reason != null) {
        setNotice(result.reason);
      }
      return response;
    } catch (error) {
      if (settingsComputerGenerationRef.current === generation) setNotice(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      if (settingsComputerGenerationRef.current === generation) {
        setSettingsComputerActionState((previous) => previous.scope === scope ? { ...previous, pending: null } : previous);
      }
    }
  }, [activeAgent, bridge, scopedSettingsComputerActionState.isBlocked, settingsComputerCanUpdateBaseline, settingsComputerScope]);
  const queueSettingsComputerUpdate = useCallback(() => {
    if (!settingsComputerCanUpdateBaseline || scopedSettingsComputerActionState.pending != null || scopedSettingsComputerActionState.isBlocked) return;
    setSettingsComputerActionState((previous) => previous.scope === settingsComputerScope ? { ...previous, isUpdateQueued: true } : previous);
  }, [scopedSettingsComputerActionState.isBlocked, scopedSettingsComputerActionState.pending, settingsComputerCanUpdateBaseline, settingsComputerScope]);
  const cancelSettingsComputerUpdate = useCallback(() => {
    setSettingsComputerActionState((previous) => previous.scope === settingsComputerScope ? { ...previous, isUpdateQueued: false } : previous);
  }, [settingsComputerScope]);
  useEffect(() => {
    if (!scopedSettingsComputerActionState.isUpdateQueued || !settingsComputerCanUpdateBox || scopedSettingsComputerActionState.pending != null || scopedSettingsComputerActionState.isBlocked || activeAgent == null || activeAgent.isGroup || bridge == null) return;
    if (settingsComputerQueueDispatchRef.current === settingsComputerScope) return;
    settingsComputerQueueDispatchRef.current = settingsComputerScope;
    void runSettingsComputerAction("update", false).finally(() => {
      if (settingsComputerQueueDispatchRef.current === settingsComputerScope) settingsComputerQueueDispatchRef.current = null;
    });
  }, [activeAgent, bridge, runSettingsComputerAction, scopedSettingsComputerActionState.isBlocked, scopedSettingsComputerActionState.isUpdateQueued, scopedSettingsComputerActionState.pending, settingsComputerCanUpdateBox, settingsComputerScope]);
  const settingsComputerMount = useMemo<SettingsComputerMount>(() => ({
    state: {
      isUpdateBoxPending: scopedSettingsComputerActionState.pending === "update" || settingsComputerRebuildStates.some((state) => state.kind === "update"),
      isResetBoxPending: scopedSettingsComputerActionState.pending === "reset" || settingsComputerRebuildStates.some((state) => state.kind === "reset"),
      canUpdateBaseline: settingsComputerCanUpdateBaseline,
      canUpdateBox: settingsComputerCanUpdateBox,
      canResetBox: settingsComputerCanUpdateBaseline,
      isRebuildBlocked: scopedSettingsComputerActionState.isBlocked,
      isBoxUpToDate: !activeComputerImageUpdateAvailable && activeComputerStatus.status != null,
      isDevBuild: bridge.isDev,
      workingAgentNames: settingsComputerWorkingAgentNames,
      isUpdateQueued: scopedSettingsComputerActionState.isUpdateQueued
    },
    actions: {
      onUpdateBox: (force) => runSettingsComputerAction("update", force),
      onResetBox: () => runSettingsComputerAction("reset"),
      queueUpdateWhenIdle: queueSettingsComputerUpdate,
      cancelQueuedUpdate: cancelSettingsComputerUpdate
    }
  }), [activeComputerImageUpdateAvailable, activeComputerStatus.status, bridge.isDev, cancelSettingsComputerUpdate, queueSettingsComputerUpdate, runSettingsComputerAction, scopedSettingsComputerActionState.isBlocked, scopedSettingsComputerActionState.isUpdateQueued, scopedSettingsComputerActionState.pending, settingsComputerCanUpdateBaseline, settingsComputerCanUpdateBox, settingsComputerRebuildStates, settingsComputerWorkingAgentNames]);
  const computerUpdateAction = useMemo<CommandPaletteComputerUpdateAction | null>(() => {
    if (account?.kind !== "logged-in" || activeAgent == null || activeAgent.isGroup) return null;
    if (!activeComputerImageUpdateAvailable) return null;
    if (scopedSettingsComputerActionState.pending != null || scopedSettingsComputerActionState.isBlocked || scopedSettingsComputerActionState.isUpdateQueued) return null;
    if (!settingsComputerCanUpdateBaseline) return null;
    return settingsComputerWorkingAgentNames.length === 0 ? "ready" : "busy-override";
  }, [account?.kind, activeAgent, activeComputerImageUpdateAvailable, scopedSettingsComputerActionState.isBlocked, scopedSettingsComputerActionState.isUpdateQueued, scopedSettingsComputerActionState.pending, settingsComputerCanUpdateBaseline, settingsComputerWorkingAgentNames]);
  const computerUpdateConfirmationController = useMemo(() => createComputerUpdateConfirmationController({
    context: {
      scope: {
        accountSlot: account?.kind === "logged-in" ? pinnedAccountKey : null,
        agentId: activeAgent?.id ?? null,
        boxId: "forever-box"
      },
      action: computerUpdateAction,
      imageUpdateAvailable: activeComputerImageUpdateAvailable,
      guard: {
        canUpdate: settingsComputerCanUpdateBaseline,
        isPending: scopedSettingsComputerActionState.pending != null,
        isBlocked: scopedSettingsComputerActionState.isBlocked
      }
    },
    transport: { update: (agentId, force) => bridge.foreverBox.update(agentId, force) }
  }), [bridge]);
  useStrictModeSafeDisposal(computerUpdateConfirmationController);
  useEffect(() => {
    computerUpdateConfirmationController.setContext({
      scope: {
        accountSlot: account?.kind === "logged-in" ? pinnedAccountKey : null,
        agentId: activeAgent?.id ?? null,
        boxId: "forever-box"
      },
      action: computerUpdateAction,
      imageUpdateAvailable: activeComputerImageUpdateAvailable,
      guard: {
        canUpdate: settingsComputerCanUpdateBaseline,
        isPending: scopedSettingsComputerActionState.pending != null,
        isBlocked: scopedSettingsComputerActionState.isBlocked
      }
    });
  }, [account?.kind, activeAgent?.id, activeComputerImageUpdateAvailable, computerUpdateAction, computerUpdateConfirmationController, pinnedAccountKey, scopedSettingsComputerActionState.isBlocked, scopedSettingsComputerActionState.pending, settingsComputerCanUpdateBaseline]);
  const onboardingComputerStatus = useMemo(
    () => createOnboardingComputerStatusSource(computer.statusStore),
    [computer.statusStore]
  );
  const isAccountOnboarded = useCallback(
    () => isOnboardingAccountOnboarded({
      readSeen: () => bridge.onboarding.getSeen(),
      countAgents: () => client?.call("countAgents") ?? Promise.resolve(null),
    }),
    [bridge, client]
  );
  const resolveOnboarding = useCallback(async (status: CursorAuthStatus, hasSeenOnboarding: boolean): Promise<void> => {
    const accountScopeGeneration = accountScopeGenerationRef.current;
    if (status.kind !== "logged-in") {
      setOnboardingOpen(false);
      return;
    }
    let agentCount: number | null = null;
    if (!hasSeenOnboarding && client != null) {
      try {
        const result = await client.call("countAgents");
        if (accountScopeGenerationRef.current !== accountScopeGeneration) return;
        agentCount = typeof result === "number" && Number.isFinite(result) && result >= 0 ? result : null;
      } catch {
        // The shipped gate fails open to onboarding when the roster probe is unavailable.
      }
    }
    const route = resolveOnboardingRoute({ isSignedIn: true, hasSeenOnboarding, agentCount });
    if (route === "shell" && !hasSeenOnboarding && agentCount != null && agentCount > 0) {
      await bridge.onboarding.setSeen(true).catch(() => {});
    }
    if (accountScopeGenerationRef.current !== accountScopeGeneration) return;
    setOnboardingOpen(route === "onboarding");
  }, [bridge, client]);

  useEffect(() => {
    if (computer.isOpen) setComputerViewerRetained(true);
    else if (!computerInfoOpen) setComputerViewerRetained(false);
  }, [computer.isOpen, computerInfoOpen]);

  const refreshRoster = useCallback(async () => {
    if (client == null) return;
    const accountScopeGeneration = accountScopeGenerationRef.current;
    const transportScopeGeneration = transportScopeGenerationRef.current;
    const attempt = ++rosterAttemptRef.current;
    const isCurrent = () => rosterAttemptRef.current === attempt
      && accountScopeGenerationRef.current === accountScopeGeneration
      && transportScopeGenerationRef.current === transportScopeGeneration
      && accountRef.current?.kind === "logged-in";
    setIsRosterRetrying(true);
    try {
      const projected = projectRendererAgents(await client.call("listAgents"));
      if (!isCurrent()) return;
      setPrivacyBlocked(false);
      setRosterLoadFailed(false);
      setRosterFailure(null);
      setAgents(projected);
      completeRosterAgentIdsRef.current = projected.map((agent) => agent.id);
      selectionStore.reconcile({ agentIds: projected.map((agent) => agent.id), isRosterComplete: true });
      setHasLoadedAgents(true);
    } catch (error) {
      if (!isCurrent()) return;
      if (isRosterPrivacyBlockFailure(error)) {
        setPrivacyBlocked(true);
        setRosterLoadFailed(false);
      } else setRosterLoadFailed(true);
      setRosterFailure(projectRosterFailure(error));
      throw error;
    } finally {
      if (isCurrent()) setIsRosterRetrying(false);
    }
  }, [client, selectionStore]);

  const [connectionController] = useState(() => client == null
    ? null
    : createCoordinatorConnectionController(createCoordinatorConnectionSource(client, bridge, refreshRoster)));
  const connectionLifecycleGenerationRef = useRef(0);
  const clientLifecycleGenerationRef = useRef(0);
  useEffect(() => {
    if (connectionController == null) return;
    const generation = ++connectionLifecycleGenerationRef.current;
    connectionController.start();
    return () => {
      queueMicrotask(() => {
        if (connectionLifecycleGenerationRef.current === generation) connectionController.dispose();
      });
    };
  }, [connectionController, connectionLifecycleGenerationRef]);
  useEffect(() => {
    if (connectionController == null || account == null) return;
    connectionController.ingestAccount(account);
  }, [account, connectionController]);

  const refreshAgentNetworkAvailability = useCallback(async () => {
    if (client == null) return setAgentNetworkEnabled(false);
    const accountScopeGeneration = accountScopeGenerationRef.current;
    const transportScopeGeneration = transportScopeGenerationRef.current;
    try {
      const enabled = await client.call("isAgentNetworkEnabled") === true;
      if (accountScopeGenerationRef.current === accountScopeGeneration
        && transportScopeGenerationRef.current === transportScopeGeneration
        && accountRef.current?.kind === "logged-in") setAgentNetworkEnabled(enabled);
    } catch {
      if (accountScopeGenerationRef.current === accountScopeGeneration
        && transportScopeGenerationRef.current === transportScopeGeneration
        && accountRef.current?.kind === "logged-in") setAgentNetworkEnabled(false);
    }
  }, [client]);

  const openAgent = useCallback(async (agentId: string) => {
    const accountScopeGeneration = accountScopeGenerationRef.current;
    const transportScopeGeneration = transportScopeGenerationRef.current;
    const requestGeneration = ++openAgentRequestGenerationRef.current;
    if (accountRef.current?.kind !== "logged-in") return;
    setTranscriptLoadError((current) => current?.agentId === agentId ? null : current);
    const hasLoadedEntries = entriesByAgentRef.current[agentId] != null;
    transcriptPaginationController.setScope(transcriptAccountSlot, agentId);
    const shouldOpen = selectionStore.select(agentId);
    setOverlay(null);
    setWorkspaceRoute(null);
    setCommandPaletteOpen(false);
    if (hasLoadedEntries) selectionStore.settle(agentId);
    if (!shouldOpen || hasLoadedEntries || client == null) {
      if (client == null) selectionStore.settle(agentId);
      return;
    }
    const agentName = agentsRef.current.find((agent) => agent.id === agentId)?.name ?? UI_TEXT.title;
    try {
      const page = await client.call("openAgentTail", { id: agentId, limit: 200 });
      if (accountScopeGenerationRef.current !== accountScopeGeneration
        || openAgentRequestGenerationRef.current !== requestGeneration
        || transportScopeGenerationRef.current !== transportScopeGeneration
        || accountRef.current?.kind !== "logged-in") return;
      const projectedPage = projectTranscriptPageResult(page, agentName, agentId);
      setEntriesByAgent((current) => ({ ...current, [agentId]: projectedPage.entries }));
      transcriptPaginationController.installInitialPage(projectedPage);
      selectionStore.settle(agentId);
      selectionStore.reconcile({ agentIds: completeRosterAgentIdsRef.current, isRosterComplete: hasLoadedAgentsRef.current });
      setTranscriptLoadError((current) => current?.agentId === agentId ? null : current);
    } catch {
      if (accountScopeGenerationRef.current !== accountScopeGeneration
        || openAgentRequestGenerationRef.current !== requestGeneration
        || transportScopeGenerationRef.current !== transportScopeGeneration
        || accountRef.current?.kind !== "logged-in") return;
      selectionStore.settle(agentId);
      selectionStore.reconcile({ agentIds: completeRosterAgentIdsRef.current, isRosterComplete: hasLoadedAgentsRef.current });
      setTranscriptLoadError({ agentId, accountScopeGeneration });
    }
  }, [client, selectionStore, transcriptAccountSlot, transcriptPaginationController]);

  const openGroupMemberChat = useCallback((agentId: string) => {
    setGroupInfoPaneOpen(false);
    void openAgent(agentId);
  }, [openAgent]);

  const openSidebarSearch = useCallback(() => {
    if (accountRef.current?.kind !== "logged-in") return;
    setCommandPaletteOpen(true);
  }, []);
  const sidebarSearchTrigger = useMemo(() => createSidebarSearchTrigger({ openSearch: openSidebarSearch }), [openSidebarSearch]);
  const openSidebarProfile = useCallback((agentId: string) => {
    if (bridge == null || accountRef.current?.kind !== "logged-in") return;
    const target = agentsRef.current.find((agent) => agent.id === agentId);
    if (target == null || target.isGroup) return;
    setOverlay(null);
    setCommandPaletteOpen(false);
    setManageSharedRoomId(null);
    setRoutinesInfoPaneOpen(false);
    setChannelsInfoPaneOpen(false);
    setComputerInfoOpen(false);
    if (activeAgentIdRef.current === agentId) {
      setAgentSettingsOpen(true);
      return;
    }
    const accountAtOpen = accountRef.current;
    void openAgent(agentId).then(() => {
      if (accountRef.current !== accountAtOpen || activeAgentIdRef.current !== agentId) return;
      setAgentSettingsOpen(true);
    });
  }, [bridge, openAgent]);
  const sidebarProfileAction = useMemo(() => createSidebarProfileAction({ openProfile: openSidebarProfile }), [openSidebarProfile]);

  useEffect(() => {
    if (client == null) return;
    const lifecycleGeneration = ++clientLifecycleGenerationRef.current;
    const accountScopeGeneration = accountScopeGenerationRef.current;
    let active = true;
    const isCurrent = () => active
      && clientLifecycleGenerationRef.current === lifecycleGeneration
      && accountScopeGenerationRef.current === accountScopeGeneration;
    client.ready.then(() => {
      if (!isCurrent() || accountRef.current?.kind !== "logged-in") return;
      transportScopeGenerationRef.current += 1;
      setTransport("connected");
      void refreshRoster().catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
      void refreshAgentNetworkAvailability();
    }, () => {
      if (!isCurrent() || accountRef.current?.kind !== "logged-in") return;
      transportScopeGenerationRef.current += 1;
      setTransport("down");
      setRosterLoadFailed(true);
    });
    const stopTransport = client.subscribeTransport((state) => {
      if (!isCurrent()) return;
      transportScopeGenerationRef.current += 1;
      setTransport(state === "connected" ? "connected" : "down");
      if (state === "down") {
        setRosterLoadFailed(true);
        setIsRosterRetrying(false);
      }
      if (state === "connected" && accountRef.current?.kind === "logged-in") {
        if (connectionController?.get().isRetrying !== true) {
          void refreshRoster().catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
        }
        void refreshAgentNetworkAvailability();
      }
    });
    const stopAgents = client.subscribe("agents", (value) => {
      if (!isCurrent() || accountRef.current?.kind !== "logged-in") return;
      const projected = projectRendererAgents(value);
      setPrivacyBlocked(false);
      setRosterLoadFailed(false);
      setRosterFailure(null);
      setAgents(projected);
      completeRosterAgentIdsRef.current = projected.map((agent) => agent.id);
      selectionStore.reconcile({ agentIds: projected.map((agent) => agent.id), isRosterComplete: true });
      setHasLoadedAgents(true);
    });
    const stopUpsert = client.subscribe("agent-upserted", (value) => {
      if (!isCurrent() || accountRef.current?.kind !== "logged-in") return;
      const projected = projectRendererAgent(value);
      if (projected != null) setAgents((current) => [projected, ...current.filter((agent) => agent.id !== projected.id)].sort((a, b) => b.updatedAt - a.updatedAt));
    });
    const stopTranscript = reactionRoot?.feed.observeEntriesFeed({
      onBaseline: ({ agentId: ownerId, entries: rawEntries }) => {
        if (!isCurrent() || accountRef.current?.kind !== "logged-in") return;
        const owner = agentsRef.current.find((agent) => agent.id === ownerId);
        const projectedEntries = projectTranscriptFeedEntries(rawEntries, owner?.name ?? UI_TEXT.title, ownerId);
        for (const entry of projectedEntries) {
          if (entry.kind !== "message" || entry.clientNonce == null) continue;
          acknowledgementController.ingestTranscriptEvent({
            accountSlot: acknowledgementScopeRef.current.accountSlot,
            agentId: ownerId,
            entry: {
              id: entry.id,
              kind: "sourceKind" in entry && entry.sourceKind === "user-attachment" ? "user-attachment" : "message",
              clientNonce: entry.clientNonce,
            },
          });
        }
        setEntriesByAgent((current) => ({ ...current, [ownerId]: projectedEntries }));
      },
      onUpdated: ({ agentId: ownerId, after: event }) => {
        if (!isCurrent() || accountRef.current?.kind !== "logged-in") return;
        const owner = agentsRef.current.find((agent) => agent.id === ownerId);
        const projected = projectTranscriptEntry(event, entriesByAgentRef.current[ownerId]?.length ?? 0, owner?.name ?? UI_TEXT.title, ownerId);
        if (projected == null || !ownerId) return;
        setEntriesByAgent((current) => {
          const existing = current[ownerId] ?? [];
          if (!existing.some((entry) => entry.id === projected.id)) return current;
          return { ...current, [ownerId]: existing.map((entry) => entry.id === projected.id ? projected : entry) };
        });
      },
      onCleared: (ownerId) => {
        if (!isCurrent() || accountRef.current?.kind !== "logged-in") return;
        setEntriesByAgent((current) => {
          if (!(ownerId in current)) return current;
          const next = { ...current };
          delete next[ownerId];
          return next;
        });
        if (activeAgentIdRef.current !== ownerId) return;
        acknowledgementController.reset();
        transcriptPaginationController.reset();
      },
      onAppended: ({ agentId: ownerId, entry: event }) => {
      if (!isCurrent() || accountRef.current?.kind !== "logged-in") return;
      const owner = agentsRef.current.find((agent) => agent.id === ownerId);
      const projected = projectTranscriptEntry(event, entriesByAgentRef.current[ownerId]?.length ?? 0, owner?.name ?? UI_TEXT.title, ownerId);
      if (projected == null || !ownerId) return;
      const clientNonce = event && typeof event === "object" && "clientNonce" in event && typeof event.clientNonce === "string" ? event.clientNonce : null;
      const acknowledgementBefore = clientNonce == null ? null : acknowledgementController.getSnapshot().records.find((record) => record.nonce === clientNonce || record.priorNonces.includes(clientNonce));
      const resolvedNonce = acknowledgementBefore?.nonce ?? clientNonce;
      const acknowledgementEntryKind = event && typeof event === "object" && "kind" in event && event.kind === "user-attachment" ? "user-attachment" as const : "message" as const;
      if (clientNonce != null) acknowledgementController.ingestTranscriptEvent({ accountSlot: acknowledgementScopeRef.current.accountSlot, agentId: ownerId, entry: { id: projected.id, kind: acknowledgementEntryKind, clientNonce } });
      const projectedMessage = projected.kind === "message" ? projected : null;
      const projectedAttachments = projectedMessage?.attachments ?? [];
      setEntriesByAgent((current) => {
        const existing = current[ownerId] ?? [];
        if (existing.some((entry) => entry.kind === "message" && entry.id === projected.id)) return current;
        const pendingId = resolvedNonce == null ? null : `pending-${resolvedNonce}`;
        const pending = pendingId == null ? null : existing.find((entry): entry is TranscriptMessage => entry.kind === "message" && entry.id === pendingId);
        if (pending != null && projectedMessage != null && projectedAttachments.length > 0 && projectedMessage.text.length === 0) {
          const mergedAttachments = [...(pending.attachments ?? [])];
          for (const attachment of projectedAttachments) {
            const index = mergedAttachments.findIndex((candidate) => candidate.path === attachment.path);
            if (index < 0) mergedAttachments.push(attachment);
            else mergedAttachments[index] = { ...mergedAttachments[index], ...attachment };
          }
          const hasAcknowledgement = resolvedNonce != null && acknowledgementController.getSnapshot().records.some((record) => record.nonce === resolvedNonce);
          const merged = { ...pending, attachments: mergedAttachments, ...(hasAcknowledgement ? {} : { id: projected.id, delivery: "sent" as const }) };
          return { ...current, [ownerId]: existing.map((entry) => entry.kind === "message" && entry.id === pendingId ? merged : entry) };
        }
        return { ...current, [ownerId]: pendingId != null && pending != null
          ? existing.map((entry) => entry.kind === "message" && entry.id === pendingId ? projected : entry)
          : [...existing, projected] };
      });
      }
    }) ?? null;
    return () => {
      active = false;
      stopTransport();
      stopAgents();
      stopUpsert();
      if (typeof stopTranscript === "function") stopTranscript();
      else stopTranscript?.dispose();
      queueMicrotask(() => {
        if (clientLifecycleGenerationRef.current === lifecycleGeneration) client.dispose();
      });
    };
  }, [account?.kind, client, clientLifecycleGenerationRef, connectionController, pinnedAccountKey, reactionRoot, refreshAgentNetworkAvailability, refreshRoster, selectionStore, transcriptAccountSlot]);

  useEffect(() => {
    if (bridge == null || account?.kind !== "logged-in") {
      pinnedStateVersionRef.current += 1;
      pinnedAgentIdsRef.current = [];
      setPinnedAgentIds([]);
      return;
    }
    let active = true;
    const version = pinnedStateVersionRef.current;
    void bridge.agent.getPinnedAgents().then((value) => {
      if (!active || version !== pinnedStateVersionRef.current || !Array.isArray(value)) return;
      pinnedAgentIdsRef.current = value;
      setPinnedAgentIds(value);
    }).catch(() => {});
    return () => { active = false; };
  }, [bridge, pinnedAccountKey]);

  useEffect(() => {
    let active = true;
    const accountSlot = account?.kind === "logged-in" ? pinnedAccountKey : null;
    void selectionStore.restore(accountSlot).then(() => {
      if (!active || accountSlot == null) return;
      selectionStore.reconcile({
        agentIds: agentsRef.current.map((agent) => agent.id),
        isRosterComplete: hasLoadedAgentsRef.current
      });
    });
    return () => { active = false; };
  }, [account?.kind, pinnedAccountKey, selectionStore]);

  useEffect(() => {
    const accountSlot = account?.kind === "logged-in" ? pinnedAccountKey : null;
    void composerDraftStore.restore(accountSlot);
  }, [account?.kind, composerDraftStore, pinnedAccountKey]);

  useEffect(() => {
    void uiLayoutStore.restore();
  }, [uiLayoutStore]);

  useEffect(() => {
    const accountSlot = account?.kind === "logged-in" ? pinnedAccountKey : null;
    setAccessFirstBox(resetFirstBoxGate());
    if (accessRosterStore == null) return;
    void accessRosterStore.connect(accountSlot);
    return () => accessRosterStore.reset();
  }, [accessRosterStore, account?.kind, pinnedAccountKey]);

  useEffect(() => {
    if (account?.kind !== "logged-in") {
      setSandAccess(SAND_ACCESS_UNKNOWN);
      return;
    }
    let active = true;
    setSandAccess(SAND_ACCESS_CHECKING);
    void readFreshSandAccess(bridge.cursorAccount).then((next) => {
      if (active) setSandAccess(next);
    }, () => {
      if (active) setSandAccess(SAND_ACCESS_UNKNOWN);
    });
    return () => { active = false; };
  }, [account?.kind, pinnedAccountKey, bridge]);

  useEffect(() => {
    if (client == null || account?.kind !== "logged-in" || rebuildBoxStore == null || rebuildTransportStore == null) {
      rebuildMigrationStore.reset();
      rebuildBoxStore?.reset();
      rebuildTransportStore?.reset();
      return;
    }
    let active = true;
    const reconnect = (state: "connected" | "down") => {
      if (!active || state !== "connected") return;
      void rebuildMigrationStore.noteReconnect();
      void rebuildBoxStore.noteReconnect();
      void rebuildTransportStore.connect();
    };
    const stopTransport = client.subscribeTransport(reconnect);
    void Promise.all([
      rebuildMigrationStore.connect(),
      rebuildBoxStore.connect(),
      rebuildTransportStore.connect()
    ]);
    return () => {
      active = false;
      stopTransport();
      rebuildMigrationStore.reset();
      rebuildBoxStore.reset();
      rebuildTransportStore.reset();
    };
  }, [account?.kind, client, pinnedAccountKey, rebuildBoxStore, rebuildMigrationStore, rebuildTransportStore]);

  useStrictModeSafeDisposal(accessRosterStore);
  useStrictModeSafeDisposal(rebuildMigrationStore);
  useStrictModeSafeDisposal(rebuildBoxStore);
  useStrictModeSafeDisposal(rebuildTransportStore);

  useEffect(() => {
    setAccessFirstBox((previous) => projectFirstBoxGate(previous, {
      loadState: accessRosterSnapshot.loadState,
      isShowingRestoredRoster: accessRosterSnapshot.isShowingRestoredRoster,
      failureCode: accessRosterSnapshot.failure?.code ?? null,
      failureTransportKind: accessRosterSnapshot.failure?.transportKind ?? null
    }));
  }, [accessRosterSnapshot.failure?.code, accessRosterSnapshot.failure?.transportKind, accessRosterSnapshot.isShowingRestoredRoster, accessRosterSnapshot.loadState]);

  useEffect(() => {
    const accountSlot = account?.kind === "logged-in" ? pinnedAccountKey : null;
    setDeleteSection(null);
    sidebarCollapseStore.reset();
    sidebarSectionsStore.reset();
    if (accountSlot == null) {
      return;
    }
    let active = true;
    void Promise.all([
      sidebarCollapseStore.restore(accountSlot),
      sidebarSectionsStore.restore(accountSlot)
    ]).then(() => {
      if (active) void sidebarSectionsStore.loadFromBridge();
    });
    return () => { active = false; };
  }, [account?.kind, pinnedAccountKey, sidebarCollapseStore, sidebarSectionsStore]);

  useStrictModeSafeDisposal(selectionStore);
  useStrictModeSafeDisposal(composerDraftStore);
  useStrictModeSafeDisposal(acknowledgementController);
  useStrictModeSafeDisposal(uiLayoutStore);
  useStrictModeSafeDisposal(sidebarCollapseStore);
  useStrictModeSafeDisposal(emojiCatalogStore);
  useStrictModeSafeDisposal(editorSuggestionAdapter);
  useStrictModeSafeDisposal(editorMcpReferenceProvider);
  useStrictModeSafeDisposal(editorPrReferenceProvider);
  useStrictModeSafeDisposal(sidebarSectionsStore);
  useStrictModeSafeDisposal(settingsUpdateController);
  useStrictModeSafeDisposal(settingsNoticeController);

  useEffect(() => {
    if (client == null || account?.kind !== "logged-in") return;
    let active = true;
    const loadSections = () => { if (active) void sidebarSectionsStore.loadFromBridge(); };
    const stopTransport = client.subscribeTransport((state) => { if (state === "connected") loadSections(); });
    void client.ready.then(loadSections, () => {});
    return () => { active = false; stopTransport(); };
  }, [account?.kind, client, sidebarSectionsStore]);

  useEffect(() => {
    if (activeAgentId && entriesByAgent[activeAgentId] == null) void openAgent(activeAgentId);
  }, [activeAgentId, entriesByAgent, openAgent]);

  useEffect(() => {
    setAgentSettingsOpen(false);
    setChannelsInfoPaneOpen(false);
    setRoutinesAutomationId(null);
    setManageSharedRoomId(null);
  }, [activeAgentId]);

  useEffect(() => {
    if (paletteMessageTarget == null || activeAgentId !== paletteMessageTarget.agentId || entriesByAgent[paletteMessageTarget.agentId] == null) return;
    const row = [...document.querySelectorAll<HTMLElement>("[data-entry-id]")].find((candidate) => candidate.dataset.entryId === paletteMessageTarget.entryId);
    if (row == null) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    setPaletteMessageTarget(null);
  }, [activeAgentId, entriesByAgent, paletteMessageTarget]);

  // @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L523
  useEffect(() => {
    if (routineProvider == null) return;
    routineProvider.reset();
    if (client == null || account?.kind !== "logged-in") return () => routineProvider.cancel();
    let active = true;
    const refresh = () => { if (active) void routineProvider.refresh(); };
    const stopTransport = client.subscribeTransport((state) => { if (state === "connected") refresh(); });
    void client.ready.then(refresh, () => {});
    return () => { active = false; stopTransport(); routineProvider.cancel(); };
  }, [account?.kind, client, paletteAccountIdentity, routineProvider]);

  useStrictModeSafeDisposal(routineProvider);

  useEffect(() => {
    routinesController.reset();
    if (client == null || account?.kind !== "logged-in") return () => {};
    const stopAutomations = client.subscribe("automations", (value) => {
      if (typeof value !== "object" || value == null || Array.isArray(value)) return;
      const event = value as { agentId?: unknown; automations?: unknown };
      if (typeof event.agentId !== "string" || !Array.isArray(event.automations)) return;
      routinesController.ingest({ agentId: event.agentId, automations: event.automations });
    });
    return () => { stopAutomations(); routinesController.reset(); };
  }, [account?.kind, client, paletteAccountIdentity, routinesController]);

  useStrictModeSafeDisposal(routinesController);
  useStrictModeSafeDisposal(agentSettingsController);
  useStrictModeSafeDisposal(agentChannelsController);

  // @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5508686
  useEffect(() => {
    if (fileProvider == null) return;
    fileProvider.reset();
    fileProvider.setAvailable(false);
    if (client == null || account?.kind !== "logged-in") return () => fileProvider.cancel();
    let active = true;
    const refreshAvailability = async () => {
      try {
        const enabled = await client.call("isGlobalSearchEnabled") === true;
        if (!active) return;
        fileProvider.setAvailable(enabled);
        if (enabled) void fileProvider.setQuery("");
      } catch {
        if (active) fileProvider.setAvailable(false);
      }
    };
    const stopTransport = client.subscribeTransport((state) => { if (state === "connected") void refreshAvailability(); });
    void client.ready.then(refreshAvailability, () => {});
    return () => { active = false; stopTransport(); fileProvider.cancel(); };
  }, [account?.kind, client, fileProvider, paletteAccountIdentity]);

  useStrictModeSafeDisposal(fileProvider);

  // @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5507848
  useEffect(() => {
    if (messageProvider == null) return;
    messageProvider.reset();
    messageProvider.setAvailable(false);
    if (client == null || account?.kind !== "logged-in") return () => messageProvider.cancel();
    let active = true;
    const refreshAvailability = async () => {
      try {
        const enabled = await client.call("isGlobalSearchEnabled") === true;
        if (active) messageProvider.setAvailable(enabled);
      } catch {
        if (active) messageProvider.setAvailable(false);
      }
    };
    const stopTransport = client.subscribeTransport((state) => { if (state === "connected") void refreshAvailability(); });
    void client.ready.then(refreshAvailability, () => {});
    return () => { active = false; stopTransport(); messageProvider.cancel(); };
  }, [account?.kind, client, messageProvider, paletteAccountIdentity]);

  useStrictModeSafeDisposal(messageProvider);

  // @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5058114
  useEffect(() => {
    linkMetadataProvider.reset();
    linkMetadataProvider.setAvailable(false);
    if (client == null || account?.kind !== "logged-in") return () => linkMetadataProvider.cancel();
    let active = true;
    const refreshAvailability = async () => {
      try {
        const enabled = await client.call("isGlobalSearchEnabled") === true;
        if (active) linkMetadataProvider.setAvailable(enabled);
      } catch {
        if (active) linkMetadataProvider.setAvailable(false);
      }
    };
    const stopTransport = client.subscribeTransport((state) => { if (state === "connected") void refreshAvailability(); });
    void client.ready.then(refreshAvailability, () => {});
    return () => { active = false; stopTransport(); linkMetadataProvider.cancel(); };
  }, [account?.kind, client, linkMetadataProvider, paletteAccountIdentity]);

  useStrictModeSafeDisposal(linkMetadataProvider);

  useEffect(() => {
    if (bridge == null) return;
    let active = true;
    const observeAccount = (status: CursorAuthStatus) => {
      accountObservationGenerationRef.current += 1;
      const identity = status.kind === "logged-in" ? `logged-in:${status.authId ?? status.email ?? "account"}` : status.kind;
      const identityChanged = accountIdentityRef.current != null && accountIdentityRef.current !== identity;
      if (accountIdentityRef.current !== identity) {
        accountScopeGenerationRef.current += 1;
        localToolPermissionScopeGate.reset();
        groupMembersRoot.reset();
        sharedRoomProvider?.reset();
        setGroupInfoPaneOpen(false);
        setManageSharedRoomId(null);
      }
      if (accountIdentityRef.current != null && accountIdentityRef.current !== identity) {
        selectionStore.reset();
        acknowledgementController.reset();
        completeRosterAgentIdsRef.current = [];
        setAgents([]); setHasLoadedAgents(false); setActiveAgentId(""); setEntriesByAgent({});
        setPrivacyBlocked(false);
        setRosterLoadFailed(false);
        setRosterFailure(null);
        rosterAttemptRef.current += 1;
        setIsRosterRetrying(false);
        pinnedStateVersionRef.current += 1; pinnedAgentIdsRef.current = []; setPinnedAgentIds([]);
        navigationHistoryRef.current = createRootShellNavigationState();
        setPaletteMessageTarget(null);
        setRoutinesInfoPaneOpen(false);
        setRoutinesAutomationId(null);
        setAgentSettingsOpen(false);
        setManageSharedRoomId(null);
        setChannelsInfoPaneOpen(false);
        setAsyncTasksAgentId(null);
        asyncTasksReturnFocusRef.current = null;
        setWorkspaceRoute(null); setCommandPaletteOpen(false);
        setTransport(client == null ? "browser" : "connecting");
        openAgentRequestGenerationRef.current += 1;
      }
      accountIdentityRef.current = identity;
      if (status.kind !== "logged-in") {
        localToolPermissionScopeGate.reset();
        selectionStore.reset();
        acknowledgementController.reset();
        sharedRoomProvider?.reset();
        setPrivacyBlocked(false);
        setRosterLoadFailed(false);
        setRosterFailure(null);
        rosterAttemptRef.current += 1;
        setIsRosterRetrying(false);
        setPaletteMessageTarget(null);
        setRoutinesInfoPaneOpen(false);
        setRoutinesAutomationId(null);
        setAgentSettingsOpen(false);
        setManageSharedRoomId(null);
        setChannelsInfoPaneOpen(false);
        setAsyncTasksAgentId(null);
        asyncTasksReturnFocusRef.current = null;
      }
      setAccount(status);
      if (identityChanged) void bridge.onboarding.getSeen().then((seen) => resolveOnboarding(status, seen)).catch(() => {});
    };
    const initialAccountObservationGeneration = accountObservationGenerationRef.current;
    void Promise.all([bridge.cursorAccount.getStatus(), bridge.onboarding.getSeen(), bridge.getWindowState()]).then(([status, seen, windowState]) => {
      if (!active || accountObservationGenerationRef.current !== initialAccountObservationGeneration) return;
      observeAccount(status);
      void resolveOnboarding(status, seen);
      setWindowFullscreen(windowState.isFullscreen);
      setWindowMaximized(windowState.isMaximized);
    }).catch((error: unknown) => active && setNotice(error instanceof Error ? error.message : String(error)));
    const stopAccount = bridge.cursorAccount.onStatusChanged(observeAccount);
    const themeInstaller = typeof document === "undefined" ? null : createRuntimeThemeInstaller(document as unknown as ThemeDocument, bridge.theme.initial.resolved);
    const stopTheme = bridge.theme.onChanged((theme) => { setThemePreference(theme.preference); setResolvedTheme(theme.resolved); themeInstaller?.update(theme.resolved); applyRootShellTheme(theme.resolved); });
    const stopWindow = bridge.onWindowStateEvent((state) => {
      setWindowFullscreen(state.isFullscreen);
      setWindowMaximized(state.isMaximized);
    });
    const stopFocus = bridge.onFocusAgent((value) => {
      const intent = parseDesktopIntent(value, "focus");
      if (intent?.kind === "focus-agent") void openAgent(intent.agentId);
    });
    const stopDeepLink = bridge.onDeepLink((value) => {
      const intent = parseDesktopIntent(value, "deep-link");
      if (intent?.kind === "plugin-add") { setPluginQuery(intent.pluginId); setOverlay("plugins"); }
      else if (intent?.kind === "deep-link-info") setDeepLinkInfo(intent.link);
    });
    const stopOnboarding = bridge.onForceOnboarding(() => setOnboardingOpen(true));
    const stopSkip = bridge.onboarding.onSkip(() => setOnboardingOpen(false));
    const stopFeedback = bridge.onOpenFeedback(() => setOverlay("feedback"));
    const stopAbout = bridge.onOpenAbout(() => setOverlay("about"));
    setResolvedTheme(bridge.theme.initial.resolved);
    applyRootShellTheme(bridge.theme.initial.resolved);
    void bridge.deepLinksReady().catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
    return () => { active = false; stopAccount(); stopTheme(); themeInstaller?.dispose(); stopWindow(); stopFocus(); stopDeepLink(); stopOnboarding(); stopSkip(); stopFeedback(); stopAbout(); };
  }, [bridge, client, groupMembersRoot, localToolPermissionScopeGate, openAgent, resolveOnboarding, selectionStore, sharedRoomProvider]);

  // @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L537
  useEffect(() => {
    applyRootShellZoomFactor(bridge.getZoomFactor());
    return bridge.onZoomFactorEvent((factor) => {
      if (Number.isFinite(factor)) applyRootShellZoomFactor(factor);
    });
  }, [bridge]);

  useEffect(() => () => {
    if (bridge != null) for (const path of stagedPaths.current) void bridge.discardStagedAttachment(path).catch(() => {});
  }, [bridge]);

  useEffect(() => {
    if (activeAgentId) navigationHistoryRef.current = recordRootShellAgentSelection(navigationHistoryRef.current, activeAgentId);
  }, [activeAgentId]);

  // @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L129272-L129323
  useEffect(() => {
    if (client == null) return;
    let active = true;
    const onFocus = () => {
      if (!active || !shouldRefreshRootShellOnFocus(transport, document.visibilityState)) return;
      void refreshRoster().catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
    };
    window.addEventListener("focus", onFocus);
    return () => { active = false; window.removeEventListener("focus", onFocus); };
  }, [client, refreshRoster, transport]);

  useEffect(() => {
    void bridge?.agent.getUiLanguage?.().then((value: { language?: string }) => setUiLanguage(parseUiLanguage(value?.language))).catch(() => undefined);
    void bridge?.agent.getInferenceVendors?.().then((listed) => {
      setInferenceVendors(listed?.vendors ?? []);
      setDefaultInferenceVendorId(listed?.defaultVendorId ?? "");
    }).catch(() => undefined);
  }, [bridge, createBotOpen]);

  const createAgent = async () => {
    setCreateBotOpen(true);
  };

  const submitCreateBot = async (draft: { name: string; avatarColor: string; avatarShape: string; inferenceVendorId?: string }) => {
    if (client == null) return;
    setCreateBotOpen(false);
    setBusy(true);
    try {
      const result = await client.call("createAgent", { name: draft.name, description: "", origin: "user", avatarColor: draft.avatarColor, avatarShape: draft.avatarShape, ...(draft.inferenceVendorId ? { inferenceVendorId: draft.inferenceVendorId } : {}), isKickstartRequested: true, clientNonce: makeClientNonce() });
      const created = result && typeof result === "object" && "agent" in result ? (result as { agent: unknown }).agent : result;
      const projected = projectRendererAgent(created);
      await refreshRoster();
      if (projected != null) await openAgent(projected.id);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  createAgentRef.current = createAgent;
  openAgentRef.current = openAgent;

  const globalShortcutActions = useMemo(() => createRootShellShortcutActions({
    toggleCommandPalette: () => setCommandPaletteOpen((open) => !open),
    openSearch: () => setCommandPaletteOpen(true),
    findInChat: () => {
      if (accountRef.current?.kind !== "logged-in" || activeAgentIdRef.current.length === 0) return;
      setCommandPaletteOpen(false);
      setOverlay(null);
      setFindInChatOpen(true);
      setFindInChatFocusNonce((nonce) => nonce + 1);
    },
    newAgent: () => { void createAgentRef.current(); },
    openSettings: () => {
      setSettingsSection("general");
      setManageSharedRoomId(null);
      setOverlay("settings");
    },
    openTools: () => {
      setPluginQuery("");
      setOverlay("plugins");
    },
    focusPrompt: () => document.querySelector<HTMLElement>(".sand-prompt-form textarea, .sand-prompt-form [contenteditable='true']")?.focus(),
    previousAgent: () => {
      const agentIds = agentsRef.current.filter((agent) => !agent.isHidden).map((agent) => agent.id);
      const agentId = resolveAdjacentAgentId(agentIds, activeAgentIdRef.current, "previous");
      if (agentId != null) void openAgentRef.current(agentId);
    },
    nextAgent: () => {
      const agentIds = agentsRef.current.filter((agent) => !agent.isHidden).map((agent) => agent.id);
      const agentId = resolveAdjacentAgentId(agentIds, activeAgentIdRef.current, "next");
      if (agentId != null) void openAgentRef.current(agentId);
    },
    navigateBack: () => {
      const availableAgentIds = new Set(agentsRef.current.filter((agent) => !agent.isHidden).map((agent) => agent.id));
      const navigation = resolveRootShellNavigation(navigationHistoryRef.current, availableAgentIds, "back");
      if (navigation != null) {
        navigationHistoryRef.current = navigation.state;
        void openAgentRef.current(navigation.targetId);
      }
    },
    navigateForward: () => {
      const availableAgentIds = new Set(agentsRef.current.filter((agent) => !agent.isHidden).map((agent) => agent.id));
      const navigation = resolveRootShellNavigation(navigationHistoryRef.current, availableAgentIds, "forward");
      if (navigation != null) {
        navigationHistoryRef.current = navigation.state;
        void openAgentRef.current(navigation.targetId);
      }
    },
    focusAgent: (index) => {
      const sidebarAgents = agentsRef.current
        .filter((agent) => !agent.isHidden)
        .map((agent) => ({ ...agent, isPinned: pinnedAgentIdsRef.current.includes(agent.id) }));
      const { pinned, unpinned } = partitionSidebarAgents(sidebarAgents, pinnedAgentIdsRef.current);
      const agentId = resolveIndexedAgentId([...pinned, ...unpinned].map((agent) => agent.id), index - 1);
      if (agentId != null) void openAgentRef.current(agentId);
    },
    // @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5504264-5504409
    toggleSidebar: () => {
      const current = uiLayoutStore.sidebarLayout.get();
      uiLayoutStore.setSidebarLayout({ ...current, isCollapsed: !current.isCollapsed });
    }
  }), []);

  useEffect(() => {
    globalShortcutController.setActions(globalShortcutActions);
  }, [globalShortcutActions, globalShortcutController]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    return globalShortcutController.subscribe(document);
  }, [globalShortcutController]);
  useEffect(() => {
    globalShortcutController.acceptOverlayState({
      isArmed: account?.kind === "logged-in" && (findInChatOpen || commandPaletteOpen || overlay != null || asyncTasksAgentId != null),
      isOverlayStacked: commandPaletteOpen && overlay != null,
      close: () => {
        if (findInChatOpenRef.current) {
          findInChatController.close();
          closeFindInChat();
        } else if (commandPaletteOpen) setCommandPaletteOpen(false);
        else if (overlay != null) setOverlay(null);
        else if (asyncTasksAgentId != null) closeAsyncTasks();
      }
    });
  }, [account?.kind, asyncTasksAgentId, closeAsyncTasks, closeFindInChat, commandPaletteOpen, findInChatController, findInChatOpen, globalShortcutController, overlay]);

  const stageFiles = async (files: File[]) => {
    if (activeAgent == null || bridge == null) return;
    const stagingAgentId = activeAgent.id;
    const stagingAccountSlot = acknowledgementScopeRef.current.accountSlot;
    setBusy(true);
    try {
      const result = await stageComposerFiles(bridge, files);
      if (activeAgentIdRef.current !== stagingAgentId || acknowledgementScopeRef.current.accountSlot !== stagingAccountSlot) {
        await Promise.all(result.attachments.map(({ path }) => bridge.discardStagedAttachment(path).catch(() => {})));
        return;
      }
      for (const attachment of result.attachments) stagedPaths.current.add(attachment.path);
      const currentSnapshot = activeDraftSnapshotStore.get();
      const currentBaseDraft = currentSnapshot.draft ?? currentSnapshot.recovery ?? EMPTY_DRAFT;
      composerDraftStore.setDraft(stagingAgentId, { ...currentBaseDraft, attachments: [...currentBaseDraft.attachments, ...result.attachments] });
      setNotice(result.notice);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const removeAttachment = async (attachment: DraftAttachment) => {
    if (bridge != null && stagedPaths.current.delete(attachment.path)) {
      try { await bridge.discardStagedAttachment(attachment.path); }
      catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    }
  };

  const submit = () => {
    if (activeAgent == null || client == null) return;
    const liveDraftSnapshot = activeDraftSnapshotStore.get();
    const liveBaseDraft = liveDraftSnapshot.draft ?? liveDraftSnapshot.recovery ?? EMPTY_DRAFT;
    const liveDraft = replyThreadController.applyReplyToDraft(liveBaseDraft);
    const clientNonce = makeClientNonce();
    const enteredAt = Date.now();
    const prompt = liveDraft.prompt.trim();
    const attachments = liveDraft.attachments.map(({ path, name }) => ({ path, name }));
    if (prompt.length === 0 && attachments.length === 0) return;
    const submission = replyThreadController.projectSubmission({
      nonce: clientNonce,
      agentId: activeAgent.id,
      prompt,
      ...(liveDraft.richText == null ? {} : { richText: liveDraft.richText }),
      attachments,
      createdAtMs: enteredAt,
      ...(liveDraft.isFork === undefined ? {} : { isFork: liveDraft.isFork })
    });
    const submissionAccountSlot = acknowledgementScopeRef.current.accountSlot;
    const draftIdentity = composerDraftStore.identifyDraft({ agentId: activeAgent.id, draft: liveBaseDraft });
    replyThreadController.clearReply();
    acknowledgementController.insertOptimistic({
      accountSlot: acknowledgementScopeRef.current.accountSlot,
      agentId: activeAgent.id,
      nonce: clientNonce,
      entries: optimisticAcknowledgementEntries(clientNonce, attachments),
      phase: transportRef.current === "connected" ? "pending" : "queued"
    });
    setEntriesByAgent((current) => ({ ...current, [activeAgent.id]: [...(current[activeAgent.id] ?? []), {
      kind: "message", id: `pending-${clientNonce}`, role: "user", author: "You", text: prompt, timestampMs: enteredAt, attachments, delivery: "pending", clientNonce,
      ...(submission.replyToId == null ? {} : { replyToId: submission.replyToId })
    }] }));
    const queuedSubmission = composerSubmissionQueue.submit(submission);
    void queuedSubmission.completion.then((phase) => {
      if (phase !== "sent") return;
      if (activeAgentIdRef.current !== submission.agentId || acknowledgementScopeRef.current.accountSlot !== submissionAccountSlot) return;
      const cleared = draftIdentity == null
        ? composerDraftStore.clearDraftIfMatches({ agentId: submission.agentId, draft: liveBaseDraft })
        : composerDraftStore.clearDraftIfCurrent(draftIdentity)
          || composerDraftStore.clearDraftIfMatches({ agentId: submission.agentId, draft: liveBaseDraft });
      if (!cleared) return;
      composerDraftStore.clearRecovery(submission.agentId);
      setComposerClearGeneration((current) => current + 1);
    });
    setNotice(null);
  };

  const removeTranscriptMessage = useCallback((entry: TranscriptMessage) => {
    const agentId = activeAgentIdRef.current;
    if (!agentId) return;
    if (entry.clientNonce != null) acknowledgementController.removeOptimistic({ accountSlot: acknowledgementScopeRef.current.accountSlot, nonce: entry.clientNonce });
    setEntriesByAgent((current) => ({
      ...current,
      [agentId]: (current[agentId] ?? []).filter((candidate) => candidate.kind !== "message" || candidate.id !== entry.id)
    }));
  }, [acknowledgementController]);

  const resendFailedSend = useCallback(async (entry: TranscriptMessage) => {
    const agentId = activeAgentIdRef.current;
    if (client == null || !agentId) return;
    const clientNonce = makeClientNonce();
    const pendingId = `pending-${clientNonce}`;
    const enteredAt = Date.now();
    composerSubmissionQueue.discard(entry.clientNonce ?? "");
    const retryAttachments = (entry.attachments ?? []).map(({ path, name }) => ({ path, name }));
    const retried = entry.clientNonce != null && acknowledgementController.retryFailed({
      accountSlot: acknowledgementScopeRef.current.accountSlot,
      agentId,
      nonce: entry.clientNonce,
      freshNonce: clientNonce,
      entries: optimisticAcknowledgementEntries(clientNonce, retryAttachments)
    });
    if (!retried) acknowledgementController.insertOptimistic({
      accountSlot: acknowledgementScopeRef.current.accountSlot,
      agentId,
      nonce: clientNonce,
      entries: optimisticAcknowledgementEntries(clientNonce, retryAttachments),
      phase: "pending"
    });
    setEntriesByAgent((current) => ({
      ...current,
      [agentId]: (current[agentId] ?? []).map((candidate) => candidate.kind === "message" && candidate.id === entry.id
        ? { ...candidate, id: pendingId, clientNonce, delivery: "pending", composedAtMs: undefined }
        : candidate)
    }));
    const retrySubmission = {
      nonce: clientNonce,
      agentId,
      prompt: entry.text.trim(),
      attachments: retryAttachments,
      createdAtMs: enteredAt
    };
    const retryAccountSlot = acknowledgementScopeRef.current.accountSlot;
    const journaledRetry = sendJournalApprovalLifecycle.resendFailed({ submission: retrySubmission, onJournaled: () => {} });
    void journaledRetry.then((phase) => {
      if (phase !== "sent") return;
      if (activeAgentIdRef.current !== retrySubmission.agentId || acknowledgementScopeRef.current.accountSlot !== retryAccountSlot) return;
      composerDraftStore.clearRecovery(retrySubmission.agentId);
    });
  }, [client, composerDraftStore, composerSubmissionQueue, sendJournalApprovalLifecycle]);

  const cancelQueuedSend = useCallback((entry: TranscriptMessage) => {
    if (entry.clientNonce != null && composerSubmissionQueue.cancelQueued(entry.clientNonce)) {
      const agentId = activeAgentIdRef.current;
      acknowledgementController.removeOptimistic({ accountSlot: acknowledgementScopeRef.current.accountSlot, nonce: entry.clientNonce });
      if (agentId.length > 0) composerDraftStore.recoverDraft(agentId, {
        prompt: entry.text.trim(),
        attachments: (entry.attachments ?? []).map(({ path, name }) => ({ path, name }))
      });
      return;
    }
    removeTranscriptMessage(entry);
  }, [acknowledgementController, composerDraftStore, composerSubmissionQueue, removeTranscriptMessage]);

  const setAgentHiddenFromSidebar = useCallback((agentId: string, isHidden: boolean) => {
    void hiddenChatsMutationController.setAgentHiddenFromSidebar(agentId, isHidden).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : String(error));
    });
  }, [hiddenChatsMutationController]);

  const unhide = useCallback((agentId: string) => {
    setAgentHiddenFromSidebar(agentId, false);
  }, [setAgentHiddenFromSidebar]);

  const hideAgent = useCallback((agentId: string) => {
    setAgentHiddenFromSidebar(agentId, true);
  }, [setAgentHiddenFromSidebar]);

  const renameAgent = async (agentId: string, name: string) => {
    if (client == null) return;
    const current = agentsRef.current.find((agent) => agent.id === agentId);
    if (current == null) return;
    const previousName = current.name;
    const description = current.description ?? (typeof current.raw.description === "string" ? current.raw.description : "");
    setAgents((agents) => agents.map((agent) => agent.id === agentId ? { ...agent, name } : agent));
    try {
      await client.call("updateAgent", { id: agentId, profile: { name, description } });
    } catch (error) {
      setAgents((agents) => agents.map((agent) => agent.id === agentId && agent.name === name ? { ...agent, name: previousName } : agent));
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const copyAgentId = (agentId: string) => {
    void navigator.clipboard.writeText(agentId);
  };

  const persistPinnedAgentIds = (next: readonly string[]) => {
    if (bridge == null) return;
    const nextIds = [...next];
    const version = ++pinnedStateVersionRef.current;
    pinnedAgentIdsRef.current = nextIds;
    setPinnedAgentIds(nextIds);
    void bridge.agent.setPinnedAgents(nextIds).then((value) => {
      if (version !== pinnedStateVersionRef.current || !Array.isArray(value)) return;
      pinnedAgentIdsRef.current = value;
      setPinnedAgentIds(value);
    }).catch(() => {});
  };

  // @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L138405
  const toggleAgentPin = (agentId: string, isPinned: boolean) => {
    const current = pinnedAgentIdsRef.current;
    persistPinnedAgentIds(isPinned ? [...current, ...(current.includes(agentId) ? [] : [agentId])] : current.filter((id) => id !== agentId));
  };

  // @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L49795
  const reorderPinnedAgents = (movedId: string, targetId: string, position: "before" | "after") => {
    persistPinnedAgentIds(movePinnedAgent(pinnedAgentIdsRef.current, movedId, targetId, position));
  };

  const setAgentUnread = async (agentId: string, isUnread: boolean) => {
    if (client == null) return;
    try {
      await client.call("setAgentUnread", { id: agentId, isUnread });
      setAgents((current) => current.map((agent) => agent.id === agentId ? { ...agent, ...(isUnread ? { hasUnread: true } : { hasUnread: undefined }) } : agent));
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };

  const duplicateAgent = async (agentId: string) => {
    if (client == null) return;
    setBusy(true);
    try {
      const result = await client.call("duplicateAgent", { id: agentId });
      const created = result && typeof result === "object" && "agent" in result ? (result as { agent: unknown }).agent : result;
      const projected = projectRendererAgent(created);
      await refreshRoster();
      if (projected != null) await openAgent(projected.id);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const deleteAgentById = async (agentId: string) => {
    if (client == null) throw new Error("Coordinator unavailable");
    await client.call("deleteAgents", { ids: [agentId] });
    const remaining = agentsRef.current.filter((agent) => agent.id !== agentId);
    setAgents(remaining);
    completeRosterAgentIdsRef.current = remaining.map((agent) => agent.id);
    selectionStore.reconcile({ agentIds: remaining.map((agent) => agent.id), isRosterComplete: true });
  };

  // @evidence src/app/dist/renderer/assets/index-UbX-y3il.js bytes 5502990-5504050
  // sFn: mounted section rename, move, delete-confirmation callbacks use the coordinator-backed edit surface.
  const renameSection = useCallback((sectionId: string, name: string) => {
    sidebarSectionsStore.commands.rename(sectionId, name);
  }, [sidebarSectionsStore]);
  const moveSection = useCallback((sectionId: string, targetId: string, position: "before" | "after") => {
    sidebarSectionsStore.commands.move(sectionId, targetId, position);
  }, [sidebarSectionsStore]);
  const moveAgentsToSection = useCallback((agentIds: readonly string[], sectionId: string) => {
    const current = sidebarSectionsStore.get();
    if (current == null) return;
    const next = moveAgentsToSidebarSection(current, agentIds, sectionId);
    if (next == null) return;
    sidebarSectionsStore.setSections(next);
  }, [sidebarSectionsStore]);
  const moveAgentsToNewSection = useCallback((agentIds: readonly string[]) => {
    return sidebarSectionsStore.commands.create(agentIds);
  }, [sidebarSectionsStore]);
  const requestDeleteSection = useCallback((section: { id: string; name: string }, confirmation: SidebarSectionDeleteTarget["confirmation"]) => {
    setDeleteSection({ id: section.id, name: section.name, confirmation });
  }, []);
  const deleteSectionById = useCallback(async (sectionId: string): Promise<void> => {
    sidebarSectionsStore.commands.remove(sectionId);
  }, [sidebarSectionsStore]);

  const finishOnboarding = async (agentId: string | null) => {
    setOnboardingOpen(false);
    await refreshRoster();
    if (agentId != null) await openAgent(agentId);
  };

  const orgChartIsAvailable = orgChartAvailability({
    gates: new Set(agentNetworkEnabled ? [ORG_CHART_GATE] : []),
    hasAgents: agents.length > 0
  }).kind === "available";
  const agentNetworkTrigger = useMemo(() => createAgentNetworkTrigger({
    isAvailable: orgChartIsAvailable,
    closeChooser: () => setOverlay(null),
    openOrgChart: () => setWorkspaceRoute("org-chart"),
  }), [orgChartIsAvailable]);
  const openPaletteFile = useCallback((file: { agentId: string }) => {
    void openAgent(file.agentId);
  }, [openAgent]);
  const openPaletteMessage = useCallback((message: CommandPaletteMessage) => {
    setPaletteMessageTarget({ agentId: message.agentId, entryId: message.entryId });
    void openAgent(message.agentId);
  }, [openAgent]);
  const openPaletteRoutine = useCallback((agentId: string) => {
    setAgentSettingsOpen(false);
    setChannelsInfoPaneOpen(false);
    setManageSharedRoomId(null);
    setRoutinesAutomationId(null);
    setRoutinesInfoPaneOpen(true);
    void openAgent(agentId);
  }, [openAgent]);
  const openTimelineAutomation = useCallback((automationId: string) => {
    if (automationId.trim().length === 0 || bridge == null || activeAgent == null || activeAgent.isGroup) return;
    setAgentSettingsOpen(false);
    setChannelsInfoPaneOpen(false);
    setComputerInfoOpen(false);
    setManageSharedRoomId(null);
    setRoutinesAutomationId(automationId);
    setRoutinesInfoPaneOpen(true);
  }, [activeAgent, bridge]);
  const openPaletteLink = useCallback((url: string) => {
    void bridge.openExternal(url).catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
  }, [bridge]);
  useEffect(() => {
    settingsUpdateController.reset();
    if (account?.kind !== "logged-in") return () => settingsUpdateController.reset();
    void settingsUpdateController.connect();
    return () => settingsUpdateController.reset();
  }, [account?.kind, pinnedAccountKey, settingsUpdateController]);
  const openUpdateSettings = useCallback(() => {
    setSettingsSection("beta");
    setManageSharedRoomId(null);
    setOverlay("settings");
  }, []);
  const openUpdateRestartConfirm = useCallback(() => {
    const readyVersion = updateStatus?.state.type === "ready" ? updateStatus.state.version : null;
    if (readyVersion == null) return;
    void groupMembersRoot.alert.alert({
      title: "Update ready",
      description: `Restart to finish installing Grok Bot ${readyVersion}. Your agents and work will be right where you left them.`,
      confirmLabel: "Restart to update",
      confirmLeadingIcon: "cloud-download",
      pendingLabel: "Restarting…",
      cancelLabel: "Not now",
      perform: async () => {
        const current = await settingsUpdateController.refresh();
        const currentVersion = current?.state.type === "ready" ? current.state.version : null;
        if (currentVersion !== readyVersion) return `Grok Bot ${readyVersion} is no longer staged. Grok Bot will offer the next build when it is ready.`;
        await settingsUpdateController.install();
        return null;
      }
    });
  }, [groupMembersRoot, settingsUpdateController, updateStatus]);
  const openCommandPaletteInfo = useCallback((section: CommandPaletteInfoSection) => {
    if (account?.kind !== "logged-in" || activeAgent == null) return;
    setCommandPaletteOpen(false);
    setOverlay(null);
    setGroupInfoPaneOpen(false);
    setAgentSettingsOpen(false);
    setRoutinesInfoPaneOpen(false);
    setRoutinesAutomationId(null);
    setChannelsInfoPaneOpen(false);
    setComputerInfoOpen(false);
    setManageSharedRoomId(null);
    if (section === "channels") {
      if (agentChannelsController == null) return;
      setChannelsInfoPaneOpen(true);
      return;
    }
    if (section === "members") {
      if (!activeAgent.isGroup || activeAgent.raw.isSharedRoom === true) return;
      setGroupInfoPaneOpen(true);
      return;
    }
    if (activeAgent.isGroup) {
      if (activeAgent.raw.isSharedRoom === true) return;
      setGroupInfoPaneOpen(true);
      return;
    }
    setAgentSettingsOpen(true);
  }, [account?.kind, activeAgent, agentChannelsController]);
  const openComputerUpdateConfirm = useCallback((action: CommandPaletteComputerUpdateAction) => {
    const content = projectComputerUpdateConfirmationContent(action, settingsComputerWorkingAgentNames);
    if (content == null || computerUpdateAction !== action) return;
    const forcePerform = async (): Promise<string | null> => {
      const result = await computerUpdateConfirmationController.confirm();
      if (result.kind === "failed" || result.kind === "blocked") return computerUpdateConfirmationController.getSnapshot().message;
      return null;
    };
    const perform = action === "busy-override"
      ? async (): Promise<string | null> => {
        queueSettingsComputerUpdate();
        return null;
      }
      : forcePerform;
    void groupMembersRoot.alert.alert({
      title: content.title,
      description: content.description,
      confirmLabel: content.confirmLabel,
      cancelLabel: content.cancelLabel,
      width: content.width,
      ...(content.secondary == null ? {} : {
        secondary: {
          label: content.secondary.label,
          destructive: content.secondary.destructive,
          perform: forcePerform
        }
      }),
      perform
    });
  }, [computerUpdateAction, computerUpdateConfirmationController, groupMembersRoot, queueSettingsComputerUpdate, settingsComputerWorkingAgentNames]);
  const updatePaletteCommand = useMemo(() => commandPaletteUpdateCommand({
    status: updateStatus,
    isStatusLoading: updateStatusLoading,
    actions: {
      check: () => settingsUpdateController.check(),
      openSettings: openUpdateSettings,
      openRestartConfirm: openUpdateRestartConfirm
    }
  }), [openUpdateRestartConfirm, openUpdateSettings, settingsUpdateController, updateStatus, updateStatusLoading]);
  const updatePaletteSearchQuery = useCallback((query: string) => {
    if (fileProvider != null) void fileProvider.setQuery(query);
    if (messageProvider != null) void messageProvider.setQuery(query);
  }, [fileProvider, messageProvider]);
  const paletteCommands = useMemo<CommandPaletteCommand[]>(() => {
    const commands: CommandPaletteCommand[] = [];
    const rootCommands = commandPaletteRootCommands({
      activeAgent: activeAgent ?? null,
      hasChannels: agentChannelsController != null,
      openInfoSection: openCommandPaletteInfo,
      computerUpdateAction,
      openComputerUpdateConfirm
    });
    if (orgChartIsAvailable) commands.push({
      id: "view:org-chart", label: "Org Chart", keywords: ["open", "organization", "network", "graph"], detail: "Views",
      run: () => { setOverlay(null); setWorkspaceRoute("org-chart"); }
    });
    if (hiddenAgents.length > 0) commands.push({
      id: "open-hidden-chats", label: "Open Hidden Bots", keywords: ["hidden", "unhide", "hide", "sidebar", "bots"], detail: "Sidebar",
      run: () => setOverlay("hidden-chats")
    });
    commands.push(...rootCommands.filter((command) => command.id !== "update:computer"));
    if (bridge != null) {
      for (const section of SETTINGS_COMMANDS) commands.push({
        id: `settings:${section.id}`, label: `Settings: ${section.label}`, keywords: section.keywords, detail: "Settings",
        run: () => { setSettingsSection(section.id); setManageSharedRoomId(null); setOverlay("settings"); }
      });
      commands.push({
        id: "overlay:plugins", label: "Plugins", keywords: ["plugins", "marketplace", "tools", "skills", "mcp", "connectors", "customize"],
        run: () => { setPluginQuery(""); setOverlay("plugins"); }
      });
      for (const theme of THEME_COMMANDS) commands.push({
        id: `theme:${theme.preference}`, label: theme.label, keywords: theme.keywords, detail: "Settings · Appearance", isActive: themePreference === theme.preference,
        run: () => { void bridge.theme.set(theme.preference).then((state) => {
          setThemePreference(state.preference);
          setResolvedTheme(state.resolved);
          applyRootShellTheme(state.resolved);
        }).catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error))); }
      });
    }
    const computerUpdateCommand = rootCommands.find((command) => command.id === "update:computer");
    if (computerUpdateCommand != null) commands.push(computerUpdateCommand);
    if (updatePaletteCommand != null) commands.push(updatePaletteCommand);
    return commands;
  }, [activeAgent, agentChannelsController, bridge, computerUpdateAction, hiddenAgents.length, openCommandPaletteInfo, openComputerUpdateConfirm, orgChartIsAvailable, themePreference, updatePaletteCommand]);

  const showSignIn = bridge != null && account != null && account.kind !== "logged-in";
  const showRootLoading = bridge != null && account?.kind === "logged-in" && activeAgent == null && transport === "connecting" && !onboardingOpen;
  const showRootEmptyWorkspace = bridge != null && account?.kind === "logged-in" && transport === "connected" && hasLoadedAgents && agents.length === 0 && activeAgent == null && workspaceRoute == null && !onboardingOpen;
  const accessCoverComposition = useMemo(() => projectAccessCoverComposition({
    access: sandAccess,
    roster: accessRosterSnapshot,
    firstBox: accessFirstBox,
    rebuildStates: [
      rebuildMigrationStore.get(),
      ...(rebuildBoxStore == null ? [] : [rebuildBoxStore.get()]),
      ...(rebuildTransportStore == null ? [] : [rebuildTransportStore.get()])
    ]
  }), [accessFirstBox, accessRosterSnapshot, rebuildBoxStore, rebuildMigrationStore, rebuildRevision, rebuildTransportStore, sandAccess]);
  const rosterAccessReadiness = selectRosterAccessReadiness({
    accountKey: account?.kind === "logged-in" ? pinnedAccountKey : null,
    agentIds: agents.map((agent) => agent.id),
    failure: rosterFailure,
    hasLoadedAgents,
    isPrivacyBlocked: privacyBlocked,
    isShowingRestoredRoster: false,
    loadState: rosterFailure != null || rosterLoadFailed ? "error" : transport === "connecting" ? "loading" : "ready",
    selectedAgentId: activeAgentId || null,
    transport
  });
  useEffect(() => {
    connectionController?.setReadiness({
      hasReachedBox: rosterAccessReadiness.hasReachedBox,
      isPrivacyBlocked: rosterAccessReadiness.isPrivacyBlocked,
      failureCode: rosterAccessReadiness.rosterFailureCode
    });
  }, [connectionController, rosterAccessReadiness.hasReachedBox, rosterAccessReadiness.isPrivacyBlocked, rosterAccessReadiness.rosterFailureCode]);
  const rosterListStatus = rosterAccessReadiness.isLoaded
    ? agents.length === 0
      ? <RosterStatus kind="empty" />
      : visibleAgents.length === 0
        ? <RosterStatus kind="all-hidden" onShowHiddenBots={() => setOverlay("hidden-chats")} />
        : null
    : null;
  const groupInfoPaneRoute = projectGroupInfoPaneRoute({
    agent: activeAgent ?? null,
    accountKey: account?.kind === "logged-in" ? pinnedAccountKey : null,
    accountGeneration: groupMembersRoot.roster.getAccountGeneration(),
    onOpenAgentChat: openGroupMemberChat
  });
  const groupMemberAgent = groupInfoPaneRoute == null || activeAgent == null
    ? null
    : projectGroupMemberAgent({
        ...activeAgent.raw,
        id: activeAgent.id,
        name: activeAgent.name,
        isGroup: activeAgent.isGroup,
        memberIds: activeAgent.memberIds
      });
  const sharedRoomTrigger = useMemo<SharedRoomHeaderTriggerProps | undefined>(() => {
    if (sharedRoomContext == null || sharedRoomId == null || sharedRoomProvider == null) return undefined;
    return {
      roomId: sharedRoomId,
      pendingJoinRequests: sharedRoomSnapshot.state?.pendingJoinRequests ?? [],
      isEnabled: sharedRoomSnapshot.state?.isEnabled === true,
      disabled: sharedRoomSnapshot.isLoading || sharedRoomSnapshot.transport === "down",
      onOpen: () => {
        setGroupInfoPaneOpen(false);
        setAgentSettingsOpen(false);
        setRoutinesInfoPaneOpen(false);
        setChannelsInfoPaneOpen(false);
        setComputerInfoOpen(false);
        setManageSharedRoomId(sharedRoomId);
      }
    };
  }, [sharedRoomContext, sharedRoomId, sharedRoomProvider, sharedRoomSnapshot.isLoading, sharedRoomSnapshot.state, sharedRoomSnapshot.transport]);
  const sharedRoomDialogOpen = manageSharedRoomId != null && sharedRoomContext?.roomId === manageSharedRoomId;
  const showTranscriptLoadError = activeAgent != null
    && transcriptLoadError?.agentId === activeAgent.id
    && transcriptLoadError.accountScopeGeneration === accountScopeGenerationRef.current;

  // @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L132101-L132102
  return (
    <div className="sand-shell" data-empty={activeAgent == null ? true : undefined} data-loading={showRootLoading || undefined} data-runtime={bridge == null ? "browser" : "electron"} data-theme={RUNTIME_THEME_CLASS[resolvedTheme]} style={{ height: "100%", position: "relative", width: "100%" }}>
      <WorkspaceIndicator isFullscreen={windowFullscreen} label={workspaceRoute == null ? activeAgent?.name ?? null : null} />
      {bridge == null ? null : <WindowStatusBadge isFullscreen={windowFullscreen} transport={transport} />}
      <RootShellNotificationHost bridge={bridge} client={client} />
      <SettingsNoticeView
        notice={settingsNoticeSnapshot == null ? null : { kind: settingsNoticeSnapshot.kind, text: settingsNoticeSnapshot.message }}
        onDismiss={() => settingsNoticeController.reset()}
      />
      <AppAlertHost controller={groupMembersRoot.alert} />
      {account?.kind === "logged-in" && !computerInfoOpen && !computer.isOpen && computerRebuildBannerInput.kind === "reconnecting" ? <ComputerReconnectBanner
        input={{
          kind: computerRebuildBannerInput.kind,
          stage: computerRebuildBannerInput.stage,
          transport: computerReconnectTransport
        }}
      /> : null}
      {account?.kind === "logged-in" && !computerInfoOpen && !computer.isOpen && computerRebuildBannerInput.kind !== "reconnecting" ? <ComputerRebuildProgressBanner input={computerRebuildBannerInput} onRestore={restoreComputerProgress} /> : null}
      {bridge == null ? null : <WindowChrome bridge={bridge} isFullscreen={windowFullscreen} isMaximized={windowMaximized} />}
      <RootShellLoading isVisible={showRootLoading} />
      <div style={{ display: "grid", gridTemplateColumns: `${renderedSidebarLayout.isCollapsed ? SIDEBAR_LAYOUT_BOUNDS.collapsedWidth : renderedSidebarLayout.expandedWidth}px minmax(0, 1fr)`, height: "100%", minHeight: 0, width: "100%" }}>
        <div style={{ display: "grid", gridTemplateRows: "minmax(0, 1fr) auto auto auto", minHeight: 0 }}>
          <div style={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", minHeight: 0 }}>
            {connectionController == null ? null : <CoordinatorConnectionHost controller={connectionController} />}
            <ConversationSidebar activeAgentId={activeAgentId} agents={visibleAgents} isHostReachable={transport === "connected"} sections={projectedSidebarSections} sidebarLayout={renderedSidebarLayout} onResize={resizeSidebar} onResizeEnd={finishSidebarResize} onToggleSectionCollapsed={(sectionId, collapsed) => sidebarCollapseStore.setSectionCollapsed(sectionId, collapsed)} listStatus={rosterListStatus} pinnedAgentIds={pinnedAgentIds} onCopyAgentId={copyAgentId} onDuplicateAgent={(agentId) => void duplicateAgent(agentId)} onHideAgent={(agentId) => void hideAgent(agentId)} onNewChat={() => void createAgent()} onOpenAgent={(agentId) => void openAgent(agentId)} onOpenNetwork={agentNetworkTrigger} onOpenProfile={sidebarProfileAction.onSelect} onShowAsyncTasks={account?.kind === "logged-in" && account.isAnysphereUser === true ? openAsyncTasks : undefined} onShowFullConversation={openConversationOutline} onOpenSearch={sidebarSearchTrigger} onRenameAgent={(agentId, name) => void renameAgent(agentId, name)} onReorderPinnedAgents={reorderPinnedAgents} onRequestDeleteAgent={(agent) => setDeleteAgent({ id: agent.id, name: agent.name, isGroup: agent.isGroup })} onRenameSection={renameSection} onRequestDeleteSection={requestDeleteSection} onMoveSection={moveSection} onMoveAgentToSection={moveAgentsToSection} onMoveAgentToNewSection={moveAgentsToNewSection} onSetAgentUnread={(agentId, isUnread) => void setAgentUnread(agentId, isUnread)} onTogglePin={toggleAgentPin} />
          </div>
          {hiddenAgents.length > 0 && visibleAgents.length > 0 ? <SandButton aria-haspopup="dialog" onClick={() => setOverlay("hidden-chats")} size="sm" variant="secondary"><span>{UI_TEXT.hiddenBots}</span><SandBadge aria-label={`${hiddenAgents.length} hidden bots`}>{hiddenAgents.length}</SandBadge></SandButton> : null}
          {/* @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=2602084 (s0n Plugins footer button/icon/text composition) */}
          <div className="sand-agents-sidebar__plugins-entry"><SandButton className="sand-agents-sidebar__plugins" leadingIcon="plug" onClick={() => { setPluginQuery(""); setOverlay("plugins"); }} shape="pill" size="md" variant="secondary">{UI_TEXT.plugins}</SandButton></div>
          <AccountMenu
            account={account}
            accountLabel={UI_TEXT.account}
            bridge={bridge}
            displayName={accountName(account)}
            experimentsSnapshot={bridge.experiments.initialSnapshot}
            isOpen={accountMenuOpen}
            labels={{ about: UI_TEXT.about, changeLimit: "Change limit", helpCenter: UI_TEXT.helpCenter, included: "Included", ios: "Get Grok Bot for iOS", logOut: UI_TEXT.logOut, onDemand: "On-demand", sendFeedback: UI_TEXT.sendFeedback, settings: UI_TEXT.settings, signIn: UI_TEXT.signIn, spendThisCycle: "Spend this cycle", weeklyUsage: "Weekly usage" }}
            onError={setNotice}
            onOpenAbout={() => setOverlay("about")}
            onOpenChange={setAccountMenuOpen}
            onOpenFeedback={() => setOverlay("feedback")}
            onOpenHelp={() => void bridge.openExternal("https://cursor.com/help")}
            onOpenIos={() => void bridge.openExternal("https://apps.apple.com/us/app/grok-bot/id6794501026")}
            onOpenSettings={() => { setSettingsSection("general"); setManageSharedRoomId(null); setOverlay("settings"); }}
            onOpenUsage={() => void bridge.openExternal("https://cursor.com/dashboard/spending")}
            onRequestLogout={() => { setOverlay("confirm-logout"); setAccountMenuOpen(false); }}
            onStatus={setAccount}
            updatePill={<UpdatePill bridge={bridge} labels={UPDATE_PILL_LABELS} />}
          />
        </div>
        {workspaceRoute === "org-chart" ? <main className="sand-chat-stage"><Suspense fallback={null}><OrgChartWorkspaceView
          agents={orgChartAgents}
          onClose={() => setWorkspaceRoute(null)}
          onOpenAgent={(agentId) => void openAgent(agentId)}
          params={{}}
        /></Suspense></main> : showRootEmptyWorkspace ? <RootShellEmptyWorkspace isVisible /> : activeAgent == null ? null : <div style={{ display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, width: "100%" }}>
          <main className="sand-chat-stage">
          <ConversationAgentHeader
            agent={activeAgent}
            isComputerActive={computer.isComputerUseActive}
            isInfoOpen={activeAgent.isGroup ? groupInfoPaneOpen : computerInfoOpen}
            onToggleInfo={() => { setGroupInfoPaneOpen(false); setAgentSettingsOpen(false); setRoutinesInfoPaneOpen(false); setChannelsInfoPaneOpen(false); setManageSharedRoomId(null); setComputerInfoOpen((open) => !open); }}
            sharedRoomTrigger={sharedRoomTrigger}
            onToggleSettings={activeAgent.isGroup
              ? groupInfoPaneRoute == null ? undefined : () => { setAgentSettingsOpen(false); setRoutinesInfoPaneOpen(false); setChannelsInfoPaneOpen(false); setComputerInfoOpen(false); setManageSharedRoomId(null); setGroupInfoPaneOpen((open) => !open); }
              : bridge == null ? undefined : () => { setGroupInfoPaneOpen(false); setRoutinesInfoPaneOpen(false); setChannelsInfoPaneOpen(false); setComputerInfoOpen(false); setManageSharedRoomId(null); setAgentSettingsOpen(true); }}
            trailing={activeAgent.isGroup || bridge == null || agentChannelsController == null ? null : <SandButton aria-controls="sand-conversation-details" aria-expanded={channelsInfoPaneOpen} aria-label="Channels" data-info-row="channels" onClick={() => { setGroupInfoPaneOpen(false); setAgentSettingsOpen(false); setRoutinesInfoPaneOpen(false); setComputerInfoOpen(false); setManageSharedRoomId(null); setChannelsInfoPaneOpen((open) => !open); }} size="sm" variant="secondary"><SandIcon name="chat-bubbles" size="sm" />Channels</SandButton>}
          />
          {findInChatOpen ? <FindInChatBar controller={findInChatController} focusNonce={findInChatFocusNonce} onClose={closeFindInChat} transcriptContainer={findTranscriptContainer} transcriptHandleRef={transcriptHandleRef} /> : null}
          {showTranscriptLoadError
            ? <TranscriptLoadErrorSurface onRetry={() => void openAgent(activeAgent.id)} />
            : <ConversationTranscript
                entries={entries}
                hasOlder={transcriptPaginationSnapshot.hasOlder}
                isLoadingOlder={transcriptPaginationSnapshot.isLoadingOlder}
                isAgentRunning={activeAgent.isRunning}
                isTransportDown={transport === "down"}
                loadOlder={loadOlderTranscript}
                onCancelQueuedSend={cancelQueuedSend}
                onDeleteFailedSend={removeTranscriptMessage}
                onOpenReply={(targetId) => replyThreadController.navigate(targetId)}
                onReply={(entry) => { replyThreadController.selectReply(entry.id); }}
                onStartThread={(entry) => { replyThreadController.navigate(entry.id); }}
                onResendFailedSend={(entry) => void resendFailedSend(entry)}
                renderMessageReactionActions={renderReactionActions}
                renderComputerHandoff={(entry) => renderComputerHandoffEntry(entry, computer)}
                renderMessageReactionPills={renderReactionPills}
                resolveAttachmentMedia={resolveAttachmentMedia}
                readAttachmentBytes={(path, maxBytes) => bridge.readAttachmentBytes(path, maxBytes)}
                downloadAttachment={(path, suggestedName) => bridge.downloadAttachment(path, suggestedName)}
                resolveReplyPreview={(targetId) => {
                  const resolution = replyThreadController.resolve(targetId);
                  return resolution.status === "resolved" ? resolution.preview : null;
                }}
                isReplyTargetInScope={(targetId) => replyThreadController.resolve(targetId).isInScope}
                onOpenAutomation={openTimelineAutomation}
                resolveTranscriptCardInteractions={transcriptCardInteractions}
                transcriptCards={transcriptCardContract}
                transcriptHandleRef={transcriptHandleRef}
              />}
          </main>
          <div className="sand-chat-input-dock">
            {localToolPermissionDock}
            <ConversationComposer acceptedSendGeneration={composerClearGeneration} disabled={busy || client == null} draft={draft} editorProviders={editorProviders} notice={notice} onChange={(value) => composerDraftStore.setDraft(activeAgent.id, value)} onClearReplyTarget={clearReplyTarget} onRemoveAttachment={removeAttachment} onStageFiles={stageFiles} onSubmit={submit} placeholder={`Message ${activeAgent.name}`} replyTarget={replyTarget} scopeKey={`${transcriptAccountSlot ?? "signed-out"}:${activeAgent.id}`} transcribeAudio={transcribeAudio} />
          </div>
        </div>}
      </div>

      {conversationOutlineAgent == null ? null : <ConversationOutlinePanel
        agentId={conversationOutlineAgent.id}
        agentName={conversationOutlineAgent.name}
        onClose={closeConversationOutline}
        provider={conversationOutlineProvider}
        subagents={conversationOutlineSubagents}
      />}
      {asyncTasksAgent == null || asyncTasksProvider == null ? null : <AsyncTasksPanel
        agentId={asyncTasksAgent.id}
        agentName={asyncTasksAgent.name}
        onClose={closeAsyncTasks}
        provider={asyncTasksProvider}
      />}

      {/* @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=2772350 */}
      {/* @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=2727500 */}
      {bridge == null || activeAgent == null || activeAgent.isGroup || !agentSettingsOpen || agentSettingsController == null || agentSettingsSnapshot == null ? null : <aside
        aria-label="Conversation details"
        className="sand-info-pane"
        data-open="true"
      >
        <RootInfoPaneHeader onClose={() => setAgentSettingsOpen(false)} />
        <AgentSettingsPanel controller={agentSettingsController} language={uiLanguage} vendors={inferenceVendors} />
        {/* @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=2750022 (Edit agent avatar trigger/editor region) */}
        {avatarEditorReady ? <SandButton
          aria-expanded={avatarEditorOpen}
          aria-label="Edit agent avatar"
          onClick={() => setAvatarEditorOpen((open) => !open)}
          ref={avatarEditorTriggerRef}
          size="sm"
          variant="secondary"
        >Edit agent avatar</SandButton> : null}
        {avatarEditorOpen && avatarEditorSnapshot.status === "ready" && avatarEditorSnapshot.controller != null ? <AvatarEditorView
          agentIsGroup={activeAgent.isGroup}
          controller={avatarEditorSnapshot.controller}
          onClose={() => {
            setAvatarEditorOpen(false);
            queueMicrotask(() => avatarEditorTriggerRef.current?.focus());
          }}
          triggerRef={avatarEditorTriggerRef}
        /> : null}
      </aside>}
      {groupInfoPaneRoute == null || groupMemberAgent == null || !groupInfoPaneOpen ? null : <aside
        aria-label={GROUP_INFO_PANE_HEADER.ariaLabel}
        className="sand-info-pane"
        data-open="true"
        id="sand-conversation-details"
      >
        <RootInfoPaneHeader closeLabel={GROUP_INFO_PANE_HEADER.closeLabel} onClose={() => setGroupInfoPaneOpen(false)} />
        <GroupMembersPane
          alert={groupMembersRoot.alert}
          accountGeneration={groupInfoPaneRoute.accountGeneration}
          agent={groupMemberAgent}
          onOpenAgentChat={groupInfoPaneRoute.onOpenAgentChat}
          provider={groupMembersRoot.provider}
        />
      </aside>}
      {bridge == null || activeAgent == null || activeAgent.isGroup || agentSettingsOpen || !routinesInfoPaneOpen ? null : <aside
        aria-label="Conversation details"
        className="sand-info-pane"
        data-open="true"
      >{mountRoutinesInfoPane({
        agentId: activeAgent.id,
        automationId: routinesAutomationId,
        controller: routinesController,
        reconnectKey: `${paletteAccountIdentity}:${transport}`,
        onBack: () => { setRoutinesAutomationId(null); setRoutinesInfoPaneOpen(false); },
        onClose: () => { setRoutinesAutomationId(null); setRoutinesInfoPaneOpen(false); },
        disposeOnUnmount: false
      })}</aside>}
      {bridge == null || activeAgent == null || activeAgent.isGroup || agentSettingsController == null || agentChannelsController == null || !channelsInfoPaneOpen ? null : <aside
        aria-label="Conversation details"
        className="sand-info-pane"
        data-open="true"
        id="sand-conversation-details"
      >
        <RootInfoPaneHeader onClose={() => setChannelsInfoPaneOpen(false)}><h2>Channels</h2></RootInfoPaneHeader>
        {mountAgentInfoChannels({ agentId: activeAgent.id, labelledBy: "sand-conversation-heading", controller: agentChannelsController })}
      </aside>}
      {sharedRoomDialogOpen && sharedRoomProvider != null && sharedRoomContext != null ? <SharedRoomDialog
        accountGeneration={sharedRoomContext.accountGeneration}
        agentId={sharedRoomContext.agentId}
        agents={sharedRoomContext.agents}
        isOpen
        onClose={() => setManageSharedRoomId(null)}
        provider={sharedRoomProvider}
        roomId={sharedRoomContext.roomId}
      /> : null}
      {bridge == null || activeAgent == null || activeAgent.isGroup || routinesInfoPaneOpen || agentSettingsOpen || channelsInfoPaneOpen ? null : <ComputerInfoPane bridge={bridge} experience={computer} isOpen={computerInfoOpen} onClose={() => setComputerInfoOpen(false)} subjectLabel={activeAgent.name} teachRecording={teachRecordingComposition.preview} />}
      {activeAgent == null || activeAgent.isGroup || !(computer.isOpen || computerInfoOpen && computerViewerRetained) ? null : <ComputerFullscreen
        bridge={bridge}
        experience={computer}
        onRequestComposerFocus={() => document.querySelector<HTMLElement>(".sand-prompt-form textarea, .sand-prompt-form [contenteditable='true']")?.focus()}
        subjectLabel={activeAgent.name}
        teachRecording={teachRecordingComposition}
      />}

      {overlay === "hidden-chats" ? <div style={OVERLAY_FRAME_STYLE}><Suspense fallback={null}><HiddenChatsDialog hiddenAgents={hiddenAgents} isOpen onClose={() => setOverlay(null)} onOpenAgent={(id) => void openAgent(id)} onUnhide={(id) => void unhide(id)} /></Suspense></div> : null}
      {overlay === "settings" && bridge != null ? <div style={OVERLAY_FRAME_STYLE}><Suspense fallback={overlayFallback(UI_TEXT.settings)}><SettingsOverlayErrorBoundary onClose={() => setOverlay(null)}><SettingsDesktopSurface bridge={bridge} computer={settingsComputerMount} coordinatorClient={client} initialSection={settingsSection} isOpen onClose={() => setOverlay(null)} onNotice={publishSettingsNotice} /></SettingsOverlayErrorBoundary></Suspense></div> : null}
      {overlay === "plugins" && bridge != null ? <div style={OVERLAY_FRAME_STYLE}><Suspense fallback={overlayFallback(UI_TEXT.plugins)}><PluginsDesktopSurface activeAgentId={activeAgent?.id ?? null} bridge={bridge} githubAuth={pluginAuthBanner} initialQuery={pluginQuery} isOpen key={pluginQuery} onClose={() => setOverlay(null)} onNotice={publishSettingsNotice} privateSkillEnableSource={privateSkillEnableSource} privateSkillSource={pluginPrivateSkillSource} /></Suspense></div> : null}
      {overlay === "about" && bridge != null ? <div style={OVERLAY_FRAME_STYLE}><RecoveredAboutDialog
        bridge={bridge}
        labels={{ copied: UI_TEXT.copied, copyVersionInfo: UI_TEXT.copyVersionInfo, copyright: UI_TEXT.copyright, title: UI_TEXT.title }}
        onClose={() => setOverlay(null)}
      /></div> : null}
      {deepLinkInfo != null ? <div style={OVERLAY_FRAME_STYLE}><DeepLinkInfoDialog link={deepLinkInfo} onClose={() => setDeepLinkInfo(null)} /></div> : null}
      {overlay === "feedback" && bridge != null ? <div style={OVERLAY_FRAME_STYLE}><FeedbackDialog
        bridge={bridge}
        conversationId={activeAgent?.id ?? null}
        errorMessages={FEEDBACK_ERRORS}
        labels={{
          cancel: UI_TEXT.cancel,
          done: "Done",
          includeConversationId: UI_TEXT.includeConversationId,
          introduction: UI_TEXT.feedbackIntroduction,
          placeholder: UI_TEXT.feedbackPlaceholder,
          send: UI_TEXT.sendFeedback,
          sending: "Sending…",
          sent: "Sent. Thank you!",
          title: UI_TEXT.sendFeedback
        }}
        onClose={() => setOverlay(null)}
      /></div> : null}
      {overlay === "confirm-logout" && bridge != null ? <div style={OVERLAY_FRAME_STYLE}><SignOutDialog
        bridge={bridge}
        cancelLabel={UI_TEXT.cancel}
        confirmLabel={UI_TEXT.signOut}
        description={UI_TEXT.signOutDescription}
        onClose={() => setOverlay(null)}
        onStatus={setAccount}
        title={UI_TEXT.signOutTitle}
      /></div> : null}
      {privacyBlocked && bridge != null && account?.kind === "logged-in" ? <div style={OVERLAY_FRAME_STYLE}><PrivacyBlockedDialog
        bridge={bridge}
        onStatus={(status) => {
          setAccount(status);
          if (status.kind !== "logged-in") {
            setPrivacyBlocked(false);
            setRosterLoadFailed(false);
            setRosterFailure(null);
            rosterAttemptRef.current += 1;
            setIsRosterRetrying(false);
          }
        }}
      /></div> : null}
      <UpdateRequired bridge={bridge} labels={UPDATE_REQUIRED_LABELS} />
      {bridge != null && account?.kind === "logged-in" ? <AccessCover
        access={accessCoverComposition.access}
        bridge={bridge}
        isVisible={accessCoverComposition.isVisible}
      /> : null}
      {showSignIn && bridge != null && account != null ? <SignInLanding account={account} bridge={bridge} onStatus={setAccount} /> : null}
      {createBotOpen ? <CreateBotSheet defaultVendorId={defaultInferenceVendorId} language={uiLanguage} vendors={inferenceVendors} onCancel={() => setCreateBotOpen(false)} onCreate={(draft) => void submitCreateBot(draft)} /> : null}
      {onboardingOpen && account?.kind === "logged-in" && bridge != null ? <SignedInOnboarding
        accountSlot={account.authId ?? account.email ?? "account"}
        bridge={bridge}
        client={client}
        computerStatus={onboardingComputerStatus}
        isAccountOnboarded={isAccountOnboarded}
        onComplete={(agentId) => void finishOnboarding(agentId)}
      /> : null}
      {spreadsheetViewerMount == null ? null : <SpreadsheetViewer
        isOpen={spreadsheetViewerMount.isOpen()}
        name={spreadsheetViewerMount.entry.name}
        onClose={closeSpreadsheetViewer}
        onDownload={spreadsheetViewerMount.onDownload}
        readAttachmentBytes={spreadsheetViewerMount.readAttachmentBytes}
        source={spreadsheetViewerMount.entry.source}
      />}
      {/* The shipped palette activation was the direct openAgent callback; the
          controller-backed callback below preserves that navigation target while
          opening the selected agent's routines pane. */}
      {/* onOpenRoutine={(agentId) => void openAgent(agentId)} */}
      <CommandPalette
        agents={agents}
        commands={paletteCommands}
        routines={routineSnapshot.value}
        routineStatus={routineSnapshot.status}
        files={fileSnapshot.value}
        fileStatus={fileSnapshot.status}
        isFileSearchEnabled={fileSnapshot.status !== "unavailable"}
        messages={messageSnapshot.value}
        messageStatus={messageSnapshot.status}
        isMessageSearchEnabled={messageSnapshot.status !== "unavailable"}
        links={paletteLinks}
        linkMetadata={linkMetadataSnapshot.value}
        linkStatus={linkMetadataSnapshot.status}
        isLinkSearchEnabled={linkMetadataSnapshot.status !== "unavailable"}
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onOpenAgent={(agentId) => void openAgent(agentId)}
        onOpenRoutine={openPaletteRoutine}
        onOpenFile={openPaletteFile}
        onOpenMessage={openPaletteMessage}
        onOpenLink={openPaletteLink}
        onSearchQueryChange={updatePaletteSearchQuery}
      />
      <AgentDeleteConfirmation agent={deleteAgent} onClose={() => setDeleteAgent(null)} onConfirm={deleteAgentById} />
      <SidebarSectionDeleteConfirmation section={deleteSection} onClose={() => setDeleteSection(null)} onConfirm={deleteSectionById} />
      <Suspense fallback={null}><ComputerOverlayRouteView params={{}} /></Suspense>
    </div>
  );
}
