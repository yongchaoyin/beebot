import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { LocalToolPermissionSnapshot, LocalToolPermissionCeilingSnapshot, LocalToolPermissionStore } from "./store";
import "./view.css";

// Immutable renderer root: ef4e9831b65d39633f09c9ad0c083b98b7ebf52e3bb558182aee5bde31f876fa
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#L129653-L129754 (LLn/BLn prompt and dock)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#L21081-L21095 (ceiling snapshot hook)
// @evidence recovered/frontend/app/assets/index-UbX-y3il.js#L21237-L21248 (permission snapshot and approval hooks)

export type LocalToolPermissionAskStatus = "pending" | "always" | "never" | "denied" | "expired" | "allow-once";
export type LocalToolPermissionResolution = "always" | "allow-once" | "never" | "deny";

export interface LocalToolPermissionAsk {
  requestId: string;
  status: LocalToolPermissionAskStatus;
  action: unknown;
  target: unknown;
}

export interface LocalToolPermissionRequest {
  entryId: string;
  agentId: string | null;
  ask: LocalToolPermissionAsk;
}

export interface ResolveLocalToolPermissionInput {
  entryId: string;
  requestId: string;
  resolution: LocalToolPermissionResolution;
  agentId: string;
}

export interface LocalToolPermissionPromptProps {
  entryId: string;
  ask: LocalToolPermissionAsk;
  agentId: string | null;
  store: LocalToolPermissionStore;
  resolveLocalToolPermission(input: ResolveLocalToolPermissionInput): Promise<unknown>;
  isEscapeTarget?: boolean;
  transportState?: "connected" | "down";
}

function usePermissionSnapshots(store: LocalToolPermissionStore): { permission: LocalToolPermissionSnapshot; ceiling: LocalToolPermissionCeilingSnapshot } {
  const subscribePermission = useMemo(() => (listener: () => void) => {
    void store.load();
    return store.snapshots.subscribe(listener);
  }, [store]);
  const subscribeCeiling = useMemo(() => (listener: () => void) => {
    void store.loadCeiling();
    return store.ceilingSnapshots.subscribe(listener);
  }, [store]);
  const permission = useSyncExternalStore(subscribePermission, store.snapshots.get, store.snapshots.get);
  const ceiling = useSyncExternalStore(subscribeCeiling, store.ceilingSnapshots.get, store.ceilingSnapshots.get);
  return { permission, ceiling };
}

function permissionRank(permission: "always" | "ask" | "never"): number {
  return permission === "never" ? 0 : permission === "ask" ? 1 : 2;
}

function ceilingBlocksAlways(ceiling: LocalToolPermissionCeilingSnapshot): boolean {
  return ceiling.status !== "ready" || (ceiling.value != null && permissionRank("always") > permissionRank(ceiling.value));
}

function outcomeText(status: LocalToolPermissionAskStatus): string {
  if (status === "always") return "BeeBot can run commands on your computer.";
  if (status === "never") return "BeeBot cannot run commands on your computer.";
  if (status === "denied" || status === "expired") return "BeeBot was not allowed to run commands on your computer.";
  return "BeeBot can run commands on your computer this time.";
}

function isFormTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function hasVisibleBlockingSurface(): boolean {
  if (typeof document === "undefined") return false;
  const selectors = '[data-dune-surface="overlay"], [role="dialog"], [role="alertdialog"], .sand-command-palette, .sand-computer-fullscreen';
  for (const element of document.querySelectorAll(selectors)) {
    if (!(element instanceof HTMLElement)) continue;
    if (element.checkVisibility?.({ visibilityProperty: true }) ?? true) return true;
  }
  return false;
}

export async function resolveLocalToolPermissionAction(input: {
  store: LocalToolPermissionStore;
  request: LocalToolPermissionRequest;
  resolution: LocalToolPermissionResolution;
  resolveLocalToolPermission(input: ResolveLocalToolPermissionInput): Promise<unknown>;
}): Promise<void> {
  let resolution = input.resolution;
  if (resolution === "always" || resolution === "never") {
    try {
      const stored = await input.store.setPermission(resolution);
      if (stored !== resolution) resolution = resolution === "always" ? "allow-once" : "deny";
    } catch {
      resolution = resolution === "always" ? "allow-once" : "deny";
    }
  }
  if (resolution === "allow-once") {
    await input.store.recordApproval(input.request.ask.requestId, input.request.ask.action, input.request.ask.target);
  }
  if (input.request.agentId == null) return;
  await input.resolveLocalToolPermission({
    entryId: input.request.entryId,
    requestId: input.request.ask.requestId,
    resolution,
    agentId: input.request.agentId
  });
}

export function LocalToolPermissionPrompt({ entryId, ask, agentId, store, resolveLocalToolPermission, isEscapeTarget = false, transportState }: LocalToolPermissionPromptProps) {
  const promptRef = useRef<HTMLDivElement>(null);
  const request = useMemo(() => ({ entryId, agentId, ask }), [agentId, ask, entryId]);
  const { permission: _permissionSnapshot, ceiling } = usePermissionSnapshots(store);
  const [actionState, setActionState] = useState<"idle" | "submitting" | "failed">("idle");
  const pending = ask.status === "pending";
  const canAct = pending && actionState !== "submitting" && agentId != null;
  const alwaysBlocked = ceilingBlocksAlways(ceiling);
  const submit = (resolution: LocalToolPermissionResolution) => {
    if (!canAct || resolution === "always" && alwaysBlocked) return;
    setActionState("submitting");
    void resolveLocalToolPermissionAction({ store, request, resolution, resolveLocalToolPermission }).then(
      () => setActionState("idle"),
      () => setActionState("failed")
    );
  };

  useEffect(() => {
    if (transportState === "connected") store.noteReconnect();
  }, [store, transportState]);

  useEffect(() => {
    if (!isEscapeTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.repeat || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isFormTarget(event.target) || hasVisibleBlockingSurface()) return;
      const prompt = promptRef.current;
      if (prompt == null || !(prompt.checkVisibility?.({ visibilityProperty: true }) ?? true)) return;
      event.preventDefault();
      event.stopPropagation();
      submit("deny");
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [isEscapeTarget, canAct, alwaysBlocked, request, resolveLocalToolPermission, store]);

  if (!pending) return <div className="sand-local-tool-permission-outcome" title={outcomeText(ask.status)}>{outcomeText(ask.status)}</div>;
  const alwaysTooltip = alwaysBlocked
    ? ceiling.status === "ready" ? "Always allow is disabled by team policy" : "Always allow is disabled while team policy loads"
    : undefined;
  const disabled = !canAct;
  return (
    <div aria-label="Local tool permission" className="sand-78zum5 sand-167g77z sand-h8yej3 sand-euugli" data-state={actionState} ref={promptRef} style={{ maxWidth: 560, gap: 8, padding: "14px 16px", color: "var(--cursor-text-primary, #ececec)", background: "var(--cursor-bg-elevated, #202020)", border: "1px solid var(--cursor-border-secondary, #414141)", borderRadius: 10, boxShadow: "0 12px 28px rgba(0, 0, 0, .25)", font: "13px/1.4 Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <strong>Allow BeeBot and all agents to run commands on your local computer?</strong>
      <span>This applies to BeeBot and every agent. It can always be changed in Settings.</span>
      {actionState === "failed" ? <span style={{ color: "#f87171" }}>Your answer didn&apos;t go through. Check your connection and try again.</span> : null}
      <div role="group" style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <button disabled={disabled || alwaysBlocked} onClick={() => submit("always")} style={{ padding: "6px 9px", color: "#161616", background: "#c5f467", border: "1px solid #c5f467", borderRadius: 6, font: "inherit", cursor: disabled || alwaysBlocked ? "default" : "pointer", opacity: disabled || alwaysBlocked ? .5 : 1 }} title={alwaysTooltip} type="button">Always allow</button>
        <button disabled={disabled} onClick={() => submit("allow-once")} style={{ padding: "6px 9px", color: "inherit", background: "#353535", border: "1px solid #494949", borderRadius: 6, font: "inherit", cursor: disabled ? "default" : "pointer", opacity: disabled ? .5 : 1 }} type="button">Allow once</button>
        <button disabled={disabled} onClick={() => submit("never")} style={{ padding: "6px 9px", color: "inherit", background: "#353535", border: "1px solid #494949", borderRadius: 6, font: "inherit", cursor: disabled ? "default" : "pointer", opacity: disabled ? .5 : 1 }} type="button">Never</button>
        <button aria-label="Deny once (Esc)" disabled={disabled} onClick={() => submit("deny")} style={{ padding: "6px 9px", color: "inherit", background: "#353535", border: "1px solid #494949", borderRadius: 6, font: "inherit", cursor: disabled ? "default" : "pointer", opacity: disabled ? .5 : 1 }} title="Deny once (Esc)" type="button">Deny once</button>
      </div>
    </div>
  );
}

export function LocalToolPermissionDock({ request, ...props }: { request: LocalToolPermissionRequest | null } & Omit<LocalToolPermissionPromptProps, "entryId" | "ask" | "agentId">) {
  if (request == null) return null;
  return <div aria-label="Local tool permissions" className="sand-local-tool-permission-dock sand-78zum5 sand-dt5ytf sand-167g77z sand-h8yej3 sand-euugli" role="region"><LocalToolPermissionPrompt {...props} {...request} /></div>;
}
