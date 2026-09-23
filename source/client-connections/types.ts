import type { BotAvatar } from "../shared/agents/bot-avatar.js";

/** Renderer-visible data. Credentials never appear in this contract. */
export interface NodeProfile {
  id: string;
  nodeId: string;
  name: string;
  baseUrl: string;
  status: "signed-out" | "connecting" | "online" | "reconnecting";
  error?: string;
}

export interface NodeSnapshot {
  node: { id: string; name: string };
  bots: Array<{ id: string; name: string; description?: string; securityFrozen?: boolean } & BotAvatar>;
  goals: NodeGoal[];
  cursor: number;
}

export interface CreateNodeBotInput extends BotAvatar {
  name: string;
  description: string;
}

export interface NodeGoal {
  id: string;
  botId: string;
  prompt: string;
  status: string;
  version: number;
  result?: unknown;
  error?: string;
  createdAt: number | string;
  updatedAt: number | string;
}

export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface StoredConnection {
  profile: NodeProfile;
  refreshToken?: string;
  /** Only in the main process; encrypted by ConnectionPersistence. */
  deviceKeyPem?: string;
}

export interface ConnectionPersistence {
  load(): Promise<StoredConnection[]>;
  save(connections: StoredConnection[]): Promise<void>;
}
