import type { ForeverBoxDesktopBridge } from "../../../contracts/desktop-bridge";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4843638 (K1t)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4843900 (FAe)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4844194 (Y1t)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=4845957 (S2e)
// The shared confirmation shell is intentionally not reproduced here: the
// immutable branch delegates its Root/Action surface to the shipped Base UI.

export const FOREVER_BOX_ID = "forever-box" as const;

export type ComputerUpdateAction = "ready" | "busy-override";
export type ComputerUpdatePhase = "idle" | "pending" | "settled" | "blocked" | "failed" | "cancelled";

export interface ComputerUpdateConfirmationContent {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly width: "wide";
  readonly secondary?: { readonly label: string; readonly destructive: true };
}

export interface ComputerUpdateScope {
  readonly accountSlot: string | null;
  readonly agentId: string | null;
  readonly boxId: typeof FOREVER_BOX_ID;
}

export interface ComputerUpdateGuardSnapshot {
  readonly canUpdate: boolean;
  readonly isPending: boolean;
  readonly isBlocked: boolean;
}

export interface ComputerUpdateConfirmationContext {
  readonly scope: ComputerUpdateScope;
  readonly action: ComputerUpdateAction | null;
  readonly imageUpdateAvailable: boolean;
  readonly guard: ComputerUpdateGuardSnapshot;
}

export interface ComputerUpdateConfirmationInput {
  readonly context: ComputerUpdateConfirmationContext;
  readonly transport: Pick<ForeverBoxDesktopBridge, "update">;
}

export interface ComputerUpdateConfirmationSnapshot {
  readonly phase: ComputerUpdatePhase;
  readonly context: ComputerUpdateConfirmationContext;
  readonly message: string | null;
}

export type ComputerUpdateConfirmationResult =
  | { readonly kind: "started"; readonly response: unknown }
  | { readonly kind: "blocked"; readonly response: unknown }
  | { readonly kind: "failed"; readonly error: unknown }
  | { readonly kind: "unavailable" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "stale" };

const UPDATE_UNTRACKABLE_COPY = "The computer update started, but BeeBot can't track its progress. Restart BeeBot after the computer is available again.";

function formatOtherAgents(count: number): string {
  return `${count} other ${count === 1 ? "agent" : "agents"}`;
}

function formatWorkingAgents(names: readonly string[]): string {
  const cleaned = names.map((name) => name.trim()).filter((name) => name.length > 0);
  const [first, second] = cleaned;
  if (first == null) return `${names.length} agents`;
  const remaining = names.length - (second == null ? 1 : 2);
  if (second == null) return `${first} and ${formatOtherAgents(remaining)}`;
  if (remaining === 0) return `${first} and ${second}`;
  return `${first}, ${second}, and ${formatOtherAgents(remaining)}`;
}

function workingDescription(names: readonly string[]): string {
  if (names.length > 1) {
    return `${formatWorkingAgents(names)} are working on BeeBot's computer right now. Updating recreates the computer and interrupts their current turns. Files and logins are kept.`;
  }
  const name = (names[0] ?? "").trim();
  return `${name.length > 0 ? `${name} is` : "An agent is"} working right now. Waiting lets its current turn finish. Updating now recreates the computer and interrupts it. Files and logins are kept either way.`;
}

/** Exact K1t/FAe content projection; null means HOn omits the command. */
export function projectComputerUpdateConfirmationContent(
  action: ComputerUpdateAction | null,
  workingAgentNames: readonly string[] = []
): ComputerUpdateConfirmationContent | null {
  if (action == null) return null;
  if (action === "ready") {
    return {
      title: "Update BeeBot's Computer?",
      description: "This updates the shared computer all your agents run on to the latest version. Their files and logins are kept.",
      confirmLabel: "Update BeeBot's Computer",
      cancelLabel: "Not now",
      width: "wide"
    };
  }
  return {
    title: namesForWorkingTitle(workingAgentNames),
    description: workingDescription(workingAgentNames),
    confirmLabel: workingAgentNames.length > 1 ? "Update when agents are done" : "Update when done",
    secondary: { label: "Update anyway", destructive: true },
    cancelLabel: "Cancel",
    width: "wide"
  };
}

function namesForWorkingTitle(names: readonly string[]): string {
  return names.length > 1 ? "Update while agents are working?" : "An agent is working";
}

function hasBlockedUpdate(context: ComputerUpdateConfirmationContext): boolean {
  return context.action == null
    || context.scope.accountSlot == null
    || context.scope.agentId == null
    || context.scope.boxId !== FOREVER_BOX_ID
    || !context.imageUpdateAvailable
    || !context.guard.canUpdate
    || context.guard.isPending
    || context.guard.isBlocked;
}

function responseStatus(value: unknown): { status: string; reason?: string } | null {
  if (typeof value !== "object" || value == null || Array.isArray(value) || !("status" in value) || typeof value.status !== "string") return null;
  const record = value as Record<string, unknown>;
  return { status: value.status, ...(typeof record.reason === "string" ? { reason: record.reason } : {}) };
}

export interface ComputerUpdateConfirmationController {
  getSnapshot(): ComputerUpdateConfirmationSnapshot;
  subscribe(listener: () => void): () => void;
  setContext(context: ComputerUpdateConfirmationContext): void;
  confirm(): Promise<ComputerUpdateConfirmationResult>;
  retry(): Promise<ComputerUpdateConfirmationResult>;
  cancel(): ComputerUpdateConfirmationResult;
  dispose(): void;
}

/**
 * Unmounted action owner for the palette confirmation. It owns no dialog DOM
 * and no status subscription; callers inject the current typed guard snapshot.
 */
export function createComputerUpdateConfirmationController(
  input: ComputerUpdateConfirmationInput
): ComputerUpdateConfirmationController {
  let context = input.context;
  let phase: ComputerUpdatePhase = "idle";
  let message: string | null = null;
  let disposed = false;
  let generation = 0;
  let pending = false;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) listener(); };
  const snapshot = (): ComputerUpdateConfirmationSnapshot => ({ phase, context, message });
  const resetForContext = (next: ComputerUpdateConfirmationContext) => {
    if (disposed) return;
    generation += 1;
    context = next;
    pending = false;
    phase = "idle";
    message = null;
    notify();
  };
  const confirm = async (): Promise<ComputerUpdateConfirmationResult> => {
    if (disposed || hasBlockedUpdate(context) || pending) {
      phase = "idle";
      message = null;
      notify();
      return { kind: "unavailable" };
    }
    const attempt = ++generation;
    const scope = context.scope;
    const force = context.action === "busy-override";
    pending = true;
    phase = "pending";
    message = null;
    notify();
    try {
      const response = await input.transport.update(scope.agentId as string, force);
      if (disposed || attempt !== generation) return { kind: "stale" };
      const status = responseStatus(response);
      if (status?.status === "started-untrackable") {
        phase = "blocked";
        message = UPDATE_UNTRACKABLE_COPY;
        notify();
        return { kind: "blocked", response };
      }
      phase = "settled";
      message = status?.status === "rejected" ? status.reason ?? null : null;
      notify();
      return { kind: "started", response };
    } catch (error) {
      if (disposed || attempt !== generation) return { kind: "stale" };
      phase = "failed";
      message = error instanceof Error ? error.message : String(error);
      notify();
      return { kind: "failed", error };
    } finally {
      if (attempt === generation) pending = false;
    }
  };
  return {
    getSnapshot: snapshot,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setContext: resetForContext,
    confirm,
    retry: () => phase === "failed" ? confirm() : Promise.resolve({ kind: "unavailable" as const }),
    cancel() {
      if (disposed || pending) return { kind: "unavailable" };
      generation += 1;
      phase = "cancelled";
      message = null;
      notify();
      return { kind: "cancelled" };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      pending = false;
      listeners.clear();
    }
  };
}
