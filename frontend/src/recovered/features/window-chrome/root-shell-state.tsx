import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorBoundarySurface } from "../error-boundary/view";
import "./root-shell-state.css";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L131944
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5492557 (agent switching actions)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L132101-L132102
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L132985
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L130476-L130478
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L132095-L132097
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#L131933

const SETUP_LABEL = "Setting up BeeBot's computer";
const EMPTY_WORKSPACE_LABEL = "New chat";
const EMPTY_WORKSPACE_COPY = "No chats yet";
const ROOT_ERROR_TITLE = "Something went wrong";
const ROOT_ERROR_DETAIL = "BeeBot hit an unexpected error while rendering. Reloading usually fixes it.";
const ROOT_ERROR_RELOAD = "Reload";
const ROOT_ERROR_COPY = "Copy error";
const ROOT_ERROR_COPIED = "Copied";
const ROOT_ERROR_SURFACE_CLASS = "sand-error-boundary--app";

export type RootShellShortcut = "new-agent" | "command-palette" | "focus-search" | "focus-prompt" | "open-settings" | "open-tools" | "navigate-back" | "navigate-forward" | "previous-agent" | "next-agent" | `focus-agent-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

export interface RootShellShortcutEvent {
  defaultPrevented: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  key: string;
}

export function resolveRootShellShortcut(event: RootShellShortcutEvent): RootShellShortcut | null {
  if (event.defaultPrevented) return null;
  if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
    if (event.key === "ArrowUp") return "previous-agent";
    if (event.key === "ArrowDown") return "next-agent";
  }
  if (event.altKey || !(event.metaKey || event.ctrlKey)) return null;
  const key = event.key.toLowerCase();
  if (!event.shiftKey && /^[1-9]$/.test(key)) return `focus-agent-${key}` as RootShellShortcut;
  if (key === "n" && !event.shiftKey) return "new-agent";
  if (key === "k" && !event.shiftKey) return "command-palette";
  if (key === "f" && event.shiftKey) return "focus-search";
  if (key === "," && !event.shiftKey) return "open-settings";
  if (key === "m" && event.shiftKey) return "open-tools";
  if (key === "[" && !event.shiftKey) return "navigate-back";
  if (key === "]" && !event.shiftKey) return "navigate-forward";
  if ((key === "i" || key === "l") && !event.shiftKey) return "focus-prompt";
  return null;
}

export function resolveIndexedAgentId(agentIds: readonly string[], index: number): string | null {
  if (!Number.isInteger(index) || index < 0) return null;
  return agentIds[index] ?? null;
}

export interface RootShellNavigationState {
  entries: readonly string[];
  cursor: number;
  pendingTarget: string | null;
  appliedAgentId: string | null;
}

export function createRootShellNavigationState(): RootShellNavigationState {
  return { entries: [], cursor: -1, pendingTarget: null, appliedAgentId: null };
}

export function recordRootShellAgentSelection(state: RootShellNavigationState, agentId: string): RootShellNavigationState {
  if (agentId === state.appliedAgentId) return state;
  if (agentId === state.pendingTarget) return { ...state, pendingTarget: null, appliedAgentId: agentId };
  const entries = [...state.entries.slice(0, state.cursor + 1), agentId];
  return { entries, cursor: entries.length - 1, pendingTarget: null, appliedAgentId: agentId };
}

export function resolveRootShellNavigation(
  state: RootShellNavigationState,
  availableAgentIds: ReadonlySet<string>,
  direction: "back" | "forward"
): { state: RootShellNavigationState; targetId: string } | null {
  const step = direction === "back" ? -1 : 1;
  const current = state.cursor >= 0 ? state.entries[state.cursor] ?? null : null;
  for (let index = state.cursor + step; index >= 0 && index < state.entries.length; index += step) {
    const targetId = state.entries[index];
    if (targetId != null && availableAgentIds.has(targetId) && targetId !== current) {
      return { state: { ...state, cursor: index, pendingTarget: targetId }, targetId };
    }
  }
  return null;
}

export function resolveAdjacentAgentId(
  agentIds: readonly string[],
  activeAgentId: string,
  direction: "previous" | "next"
): string | null {
  const activeIndex = agentIds.indexOf(activeAgentId);
  if (activeIndex < 0) return null;
  const nextIndex = direction === "previous" ? activeIndex - 1 : activeIndex + 1;
  return agentIds[nextIndex] ?? null;
}

export interface RootShellLoadingProps {
  isVisible: boolean;
}

export function RootShellLoading({ isVisible }: RootShellLoadingProps) {
  if (!isVisible) return null;
  return <div aria-label={SETUP_LABEL} className="sand-loading" role="status">
    <div className="sand-loading__content">
      <span aria-hidden="true" className="sand-loading__mark" />
      <span aria-hidden="true" className="sand-loading__heading">{SETUP_LABEL}</span>
    </div>
  </div>;
}

export interface RootShellEmptyWorkspaceProps {
  isVisible: boolean;
}

export function RootShellEmptyWorkspace({ isVisible }: RootShellEmptyWorkspaceProps) {
  if (!isVisible) return null;
  return <main aria-label={EMPTY_WORKSPACE_LABEL} className="sand-chat" data-empty="true" style={{ display: "grid", height: "100%", placeItems: "center" }}>
    <p>{EMPTY_WORKSPACE_COPY}</p>
  </main>;
}

export interface RootShellFatalErrorProps {
  error: Error;
  componentStack?: string | null;
}

export function RootShellFatalError({ error, componentStack }: RootShellFatalErrorProps) {
  void ROOT_ERROR_SURFACE_CLASS;
  return <ErrorBoundarySurface
    componentStack={componentStack}
    error={error}
    labels={{ copied: ROOT_ERROR_COPIED, copyError: ROOT_ERROR_COPY, detail: ROOT_ERROR_DETAIL, reload: ROOT_ERROR_RELOAD, title: ROOT_ERROR_TITLE }}
  />;
}

interface RootShellErrorBoundaryProps {
  children: ReactNode;
}

interface RootShellErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

export class RootShellErrorBoundary extends Component<RootShellErrorBoundaryProps, RootShellErrorBoundaryState> {
  state: RootShellErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): RootShellErrorBoundaryState {
    return { error, componentStack: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[renderer-root-error]", error, info.componentStack ?? "");
    this.setState({ error, componentStack: info.componentStack ?? null });
  }

  render() {
    return this.state.error == null
      ? this.props.children
      : <RootShellFatalError componentStack={this.state.componentStack} error={this.state.error} />;
  }
}
