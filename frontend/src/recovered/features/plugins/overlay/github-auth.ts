import type { RawPortCoordinatorSource } from "../../../runtime/coordinator-source";

// @evidence src/app/dist/renderer/assets/view-B5Ug8wEm.js#byteOffset=24286 (plugin-auth purpose and exact setup prompt)
// @evidence recovered/frontend/app/assets/view-B5Ug8wEm.js#byteOffset=30233 (Windows plugin-auth purpose and exact setup prompt)

export const PLUGIN_AUTH_AGENT_NAME = "Plugin Setup";
export const PLUGIN_AUTH_AGENT_DESCRIPTION = "Sets up git credentials on BeeBot's computer so installed plugins can be fetched.";
export const PLUGIN_AUTH_AGENT_PURPOSE = "plugin-auth" as const;
export const PLUGIN_AUTH_PROMPT = [
  "Some of my installed plugins can't be fetched.",
  "Their content lives in a private git repository, and your computer — the machine Shell and Read act on, not mine — has no credentials to read it.",
  "Set that up on your computer: run `gh auth login` there, then `gh auth setup-git` so git itself uses the credential.",
  "When a step needs me (a device code, a password, 2FA, an OAuth approval), hand your computer over with request_box_help instead of guessing.",
  "Then verify with a read-only `git ls-remote` against one of those plugin repositories and tell me whether it worked. Don't change my repositories or any other credentials."
].join(" ");

export interface PluginAuthBlock {
  readonly pluginId: string;
  readonly pluginName: string;
  readonly marketplaceName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePluginAuthBlock(value: unknown): PluginAuthBlock | null {
  if (!isRecord(value) || typeof value.pluginId !== "string" || value.pluginId.length === 0 || typeof value.pluginName !== "string" || value.pluginName.length === 0) return null;
  return {
    pluginId: value.pluginId,
    pluginName: value.pluginName,
    ...(typeof value.marketplaceName === "string" && value.marketplaceName.length > 0 ? { marketplaceName: value.marketplaceName } : {})
  };
}

// @evidence src/app/dist/renderer/assets/view-B5Ug8wEm.js#byteOffset=40337 (authBlocked provider projection)
export function pluginAuthBlocksFromSyncStatus(value: unknown): PluginAuthBlock[] {
  if (!isRecord(value) || !Array.isArray(value.authBlocked)) return [];
  return value.authBlocked.flatMap((candidate) => {
    const block = parsePluginAuthBlock(candidate);
    return block == null ? [] : [block];
  });
}

// @evidence src/app/dist/renderer/assets/view-B5Ug8wEm.js#byteOffset=24286 (ni)
// @evidence recovered/frontend/app/assets/view-B5Ug8wEm.js#byteOffset=30233 (Windows ni)
export function pluginAuthBlockedDetail(blocks: readonly PluginAuthBlock[]): string {
  const names = blocks.map((block) => block.pluginName).filter((name) => name.length > 0);
  if (names.length === 0 || names.length > 3) {
    const count = blocks.length;
    return `${count} installed ${count === 1 ? "plugin" : "plugins"} can't be fetched until BeeBot's computer can read their source repository.`;
  }
  return `${names.join(", ")} ${names.length === 1 ? "is" : "are"} installed, but their content can't be fetched until BeeBot's computer can read the source repository.`;
}

export interface PluginAuthRosterAgent {
  readonly id: string;
  readonly purpose?: string;
}

export interface PluginAuthRosterSnapshot {
  readonly agents: readonly PluginAuthRosterAgent[];
  readonly isRosterComplete: boolean;
}

export interface PluginAuthAgentCreationResult {
  readonly agent: { readonly id: string };
}

export interface PluginAuthSource {
  readonly coordinator: Pick<RawPortCoordinatorSource, "getPluginSyncStatus" | "createAgent" | "sendPrompt">;
  readonly roster: {
    getSnapshot(): PluginAuthRosterSnapshot;
    selectAgent(agentId: string): void;
  };
}

export type PluginAuthStatus = "idle" | "loading" | "ready" | "failed";

export interface PluginAuthSnapshot {
  readonly status: PluginAuthStatus;
  readonly authBlocked: readonly PluginAuthBlock[];
  readonly isLaunching: boolean;
  readonly failure: unknown | null;
}

export interface PluginAuthController {
  getSnapshot(): PluginAuthSnapshot;
  subscribe(listener: () => void): () => void;
  open(): void;
  refresh(): Promise<void>;
  fix(): Promise<boolean>;
  reset(): void;
  dispose(): void;
}

function createdAgentId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const candidate = isRecord(value.agent) ? value.agent : value;
  return typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : null;
}

function currentPluginAuthAgent(roster: PluginAuthRosterSnapshot): string | null {
  return roster.agents.find((agent) => agent.purpose === PLUGIN_AUTH_AGENT_PURPOSE)?.id ?? null;
}

export function createPluginAuthController(source: PluginAuthSource): PluginAuthController {
  let snapshot: PluginAuthSnapshot = { status: "idle", authBlocked: [], isLaunching: false, failure: null };
  let disposed = false;
  let scopeGeneration = 0;
  let requestGeneration = 0;
  const listeners = new Set<() => void>();

  const emit = (): void => {
    if (disposed) return;
    for (const listener of [...listeners]) listener();
  };
  const publish = (next: PluginAuthSnapshot): void => {
    if (disposed) return;
    snapshot = next;
    emit();
  };
  const isCurrent = (scope: number, request: number): boolean => !disposed && scope === scopeGeneration && request === requestGeneration;

  const refresh = async (): Promise<void> => {
    if (disposed) return;
    const scope = scopeGeneration;
    const request = ++requestGeneration;
    publish({ ...snapshot, status: "loading", failure: null });
    try {
      const authBlocked = pluginAuthBlocksFromSyncStatus(await source.coordinator.getPluginSyncStatus());
      if (isCurrent(scope, request)) publish({ ...snapshot, status: "ready", authBlocked, failure: null });
    } catch (error) {
      if (isCurrent(scope, request)) publish({ ...snapshot, status: "failed", failure: error });
    }
  };

  const fix = async (): Promise<boolean> => {
    if (disposed || snapshot.isLaunching || snapshot.authBlocked.length === 0) return false;
    const scope = scopeGeneration;
    const request = ++requestGeneration;
    const roster = source.roster.getSnapshot();
    const existingId = currentPluginAuthAgent(roster);
    if (existingId != null) {
      source.roster.selectAgent(existingId);
      return true;
    }
    if (!roster.isRosterComplete) return false;
    publish({ ...snapshot, isLaunching: true, failure: null });
    try {
      const result = await source.coordinator.createAgent({
        name: PLUGIN_AUTH_AGENT_NAME,
        description: PLUGIN_AUTH_AGENT_DESCRIPTION,
        purpose: PLUGIN_AUTH_AGENT_PURPOSE,
        isIntroductionSuppressed: true
      });
      const agentId = createdAgentId(result);
      if (agentId == null) throw new Error("Plugin auth agent creation returned a malformed agent reply");
      if (!isCurrent(scope, request)) return false;
      source.roster.selectAgent(agentId);
      await source.coordinator.sendPrompt({ agentId, prompt: PLUGIN_AUTH_PROMPT });
      if (!isCurrent(scope, request)) return false;
      publish({ ...snapshot, isLaunching: false });
      return true;
    } catch (error) {
      if (isCurrent(scope, request)) publish({ ...snapshot, isLaunching: false, failure: error });
      return false;
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open() { void refresh(); },
    refresh,
    fix,
    reset() {
      if (disposed) return;
      scopeGeneration += 1;
      requestGeneration += 1;
      publish({ status: "idle", authBlocked: [], isLaunching: false, failure: null });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scopeGeneration += 1;
      requestGeneration += 1;
      listeners.clear();
    }
  };
}
