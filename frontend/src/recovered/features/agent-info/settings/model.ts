import type { CoordinatorSourceEventListener, RawPortCoordinatorSource } from "../../../runtime/coordinator-source";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=2291210 (title availability)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=2766045 (Agent Settings fields and notification toggle)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=2766182 (setAgentNotifyOnUpdates)

export interface AgentSettingsAgent {
  readonly id: string;
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inferenceVendorId?: string;
  readonly isGroup: boolean;
  readonly notifyOnUpdatesEnabled: boolean;
  readonly [key: string]: unknown;
}

export interface AgentSettingsProfile {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inferenceVendorId?: string;
}

export interface AgentSettingsSource {
  updateAgent(args: { readonly id: string; readonly profile: AgentSettingsProfile }): Promise<unknown>;
  setAgentNotifyOnUpdates(args: { readonly id: string; readonly isEnabled: boolean }): Promise<unknown>;
  subscribe?(listener: CoordinatorSourceEventListener): { dispose(): void };
}

export interface AgentSettingsSnapshot {
  readonly agent: AgentSettingsAgent;
  readonly pending: "profile" | "notifications" | null;
  readonly error: unknown | null;
  readonly generation: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** Projects listAgents/agent-upserted records into the exact settings fields. */
export function projectAgentSettingsAgent(value: unknown): AgentSettingsAgent | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  const title = stringValue(value.title);
  const inferenceVendorId = stringValue(value.inferenceVendorId);
  return {
    ...value,
    id: value.id,
    name: value.name,
    ...(title === undefined ? {} : { title }),
    description: stringValue(value.description) ?? "",
    ...(inferenceVendorId === undefined ? {} : { inferenceVendorId }),
    isGroup: value.isGroup === true,
    notifyOnUpdatesEnabled: booleanValue(value.notifyOnUpdatesEnabled) ?? false
  };
}

export function profileFromAgent(agent: AgentSettingsAgent): AgentSettingsProfile {
  return {
    name: agent.name,
    ...(agent.title === undefined ? {} : { title: agent.title }),
    description: agent.description,
    ...(agent.inferenceVendorId === undefined ? {} : { inferenceVendorId: agent.inferenceVendorId })
  };
}

function profileChanged(current: AgentSettingsProfile, next: AgentSettingsProfile): boolean {
  return current.name !== next.name || current.title !== next.title || current.description !== next.description || current.inferenceVendorId !== next.inferenceVendorId;
}

function eventAgent(value: unknown): AgentSettingsAgent | null {
  const direct = projectAgentSettingsAgent(value);
  if (direct != null) return direct;
  if (!isRecord(value)) return null;
  return projectAgentSettingsAgent(value.agent);
}

/**
 * Controller for the shipped Agent Settings section. It consumes authoritative
 * roster events and fences late mutation replies after selection/disposal.
 */
export function createAgentSettingsController(source: AgentSettingsSource, initialAgent: AgentSettingsAgent) {
  let current = initialAgent;
  let generation = 0;
  let pending: AgentSettingsSnapshot["pending"] = null;
  let error: unknown | null = null;
  let disposed = false;
  let snapshot: AgentSettingsSnapshot = { agent: current, pending, error, generation };
  const listeners = new Set<() => void>();
  const subscription = source.subscribe?.({
    agents: (value) => {
      if (!Array.isArray(value)) return;
      const next = value.map(projectAgentSettingsAgent).find((agent): agent is AgentSettingsAgent => agent?.id === current.id);
      if (next != null) applyAuthoritative(next);
    },
    "agent-upserted": (value) => {
      const next = eventAgent(value);
      if (next?.id === current.id) applyAuthoritative(next);
    }
  });

  const emit = () => {
    if (disposed) return;
    snapshot = { agent: current, pending, error, generation };
    for (const listener of [...listeners]) listener();
  };
  function applyAuthoritative(next: AgentSettingsAgent): void {
    if (disposed || next.id !== current.id) return;
    current = next;
    error = null;
    emit();
  }

  return {
    subscribe(listener: () => void): () => void {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot(): AgentSettingsSnapshot { return snapshot; },
    setAgent(next: AgentSettingsAgent): void {
      if (disposed || next.id === current.id && next === current) return;
      generation += 1;
      pending = null;
      error = null;
      current = next;
      emit();
    },
    async updateProfile(next: AgentSettingsProfile): Promise<boolean> {
      if (disposed || pending != null) return false;
      const normalized: AgentSettingsProfile = {
        name: next.name.trim(),
        ...(next.title === undefined ? {} : { title: next.title.trim() }),
        description: next.description.trim(),
        ...(next.inferenceVendorId === undefined ? {} : { inferenceVendorId: next.inferenceVendorId.trim() })
      };
      if (normalized.name.length === 0) return false;
      const before = profileFromAgent(current);
      if (!profileChanged(before, normalized)) return false;
      const requestGeneration = generation;
      pending = "profile";
      error = null;
      emit();
      try {
        const result = await source.updateAgent({ id: current.id, profile: normalized });
        if (disposed || requestGeneration !== generation) return false;
        const authoritative = projectAgentSettingsAgent(result);
        if (authoritative != null && authoritative.id === current.id) applyAuthoritative(authoritative);
        return true;
      } catch (cause) {
        if (!disposed && requestGeneration === generation) { error = cause; emit(); }
        throw cause;
      } finally {
        if (!disposed && requestGeneration === generation) { pending = null; emit(); }
      }
    },
    async setNotifications(isEnabled: boolean): Promise<boolean> {
      if (disposed || pending != null || current.isGroup || current.notifyOnUpdatesEnabled === isEnabled) return false;
      const requestGeneration = generation;
      pending = "notifications";
      error = null;
      emit();
      try {
        await source.setAgentNotifyOnUpdates({ id: current.id, isEnabled });
        if (disposed || requestGeneration !== generation) return false;
        current = { ...current, notifyOnUpdatesEnabled: isEnabled };
        emit();
        return true;
      } catch (cause) {
        if (!disposed && requestGeneration === generation) { error = cause; emit(); }
        throw cause;
      } finally {
        if (!disposed && requestGeneration === generation) { pending = null; emit(); }
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      generation += 1;
      pending = null;
      subscription?.dispose();
      listeners.clear();
    }
  };
}

export type AgentSettingsController = ReturnType<typeof createAgentSettingsController>;

export function coordinatorAgentSettingsSource(source: RawPortCoordinatorSource): AgentSettingsSource {
  return {
    updateAgent: (args) => source.updateAgent(args),
    setAgentNotifyOnUpdates: (args) => source.setAgentNotifyOnUpdates(args),
    subscribe: (listener) => source.subscribe(listener)
  };
}
