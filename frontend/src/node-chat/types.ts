export interface NodeChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number | string;
  goalId?: string;
  status?: string;
  version?: number;
  error?: string;
}

export interface NodeChatSnapshot {
  active: boolean;
  connectionId: string;
  bot: { id: string; name: string; avatarColor?: string; avatarShape?: string };
  server: { name: string; baseUrl: string; status: string };
  messages: readonly NodeChatMessage[];
  draft: string;
  busy: boolean;
  error: string | null;
  loading: boolean;
  runningGoal: { id: string; status: string } | null;
  uncertainGoal: { id: string; version: number; error?: string } | null;
}

/** The controller owns connections and requests. This view never accesses the local Host. */
export interface NodeChatStore {
  getSnapshot(): NodeChatSnapshot;
  subscribe(listener: () => void): () => void;
  setDraft(text: string): void;
  send(text: string): void | Promise<unknown>;
  stop(goalId: string): void | Promise<unknown>;
  accept(goalId: string, version: number): void | Promise<unknown>;
  reconcile(goalId: string, version: number, note: string): void | Promise<unknown>;
  reconnect(): void | Promise<unknown>;
  close(): void;
}
