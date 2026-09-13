import type { AgentDesktopBridge } from "../../../contracts/desktop-bridge";

export type HttpRouterProviderId = "openrouter" | "openai" | "deepseek" | "custom";
export type RouterProviderId = "cursor" | "claude-code" | "codex" | HttpRouterProviderId;

export interface RouterProvider {
  readonly id: RouterProviderId;
  readonly label: string;
  readonly description: string;
  readonly usageDescription: string;
  readonly usageSource: "cursor" | "external";
  readonly kind: "account" | "local" | "http";
  readonly secretKey?: string;
  readonly defaultBaseUrl?: string;
  readonly defaultModelId?: string;
}

export interface HttpRouterProvider extends RouterProvider {
  readonly id: HttpRouterProviderId;
  readonly kind: "http";
  readonly secretKey: string;
  readonly defaultBaseUrl: string;
  readonly defaultModelId: string;
}

export const DEFAULT_ROUTER_PROVIDER: RouterProviderId = "openrouter";
export const ROUTER_PROVIDER_PERSISTENCE_KEY = "settings.router-provider.v1";

export const HTTP_ROUTER_PROVIDERS: readonly HttpRouterProvider[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "Route through your OpenRouter account and selected model.",
    usageDescription: "OpenRouter usage and spend are managed in your OpenRouter account.",
    usageSource: "external",
    kind: "http",
    secretKey: "OPENROUTER_API_KEY",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModelId: "openai/gpt-4.1-mini"
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "Use the OpenAI API with your own key.",
    usageDescription: "OpenAI usage is billed to the API key you save.",
    usageSource: "external",
    kind: "http",
    secretKey: "OPENAI_API_KEY",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModelId: "gpt-4.1-mini"
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "Use DeepSeek's OpenAI-compatible API.",
    usageDescription: "DeepSeek usage is billed to the API key you save.",
    usageSource: "external",
    kind: "http",
    secretKey: "DEEPSEEK_API_KEY",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModelId: "deepseek-chat"
  },
  {
    id: "custom",
    label: "Custom",
    description: "Any OpenAI-compatible endpoint: base URL, API key, and model ID.",
    usageDescription: "Usage is billed by the provider behind the Base URL you save.",
    usageSource: "external",
    kind: "http",
    secretKey: "CUSTOM_API_KEY",
    defaultBaseUrl: "",
    defaultModelId: ""
  }
];

export const ROUTER_PROVIDERS: readonly RouterProvider[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    description: "Use Anthropic's Claude Code provider for agent requests.",
    usageDescription: "Claude Code usage is managed by your Anthropic account and is not exposed as an in-app meter.",
    usageSource: "external",
    kind: "local"
  },
  {
    id: "codex",
    label: "Codex",
    description: "Use OpenAI's Codex provider for agent requests.",
    usageDescription: "Codex usage is managed by your OpenAI account and is not exposed as an in-app meter.",
    usageSource: "external",
    kind: "local"
  },
  ...HTTP_ROUTER_PROVIDERS
];

const ROUTER_PROVIDER_IDS = new Set<RouterProviderId>(ROUTER_PROVIDERS.map((provider) => provider.id));

export function isRouterProviderId(value: unknown): value is RouterProviderId {
  return typeof value === "string" && ROUTER_PROVIDER_IDS.has(value as RouterProviderId);
}

export function routerProviderById(id: RouterProviderId): RouterProvider {
  return ROUTER_PROVIDERS.find((provider) => provider.id === id) ?? ROUTER_PROVIDERS[0]!;
}

export function httpRouterProviderById(id: HttpRouterProviderId): HttpRouterProvider {
  return HTTP_ROUTER_PROVIDERS.find((provider) => provider.id === id) ?? HTTP_ROUTER_PROVIDERS[0]!;
}

export function parseRouterProviderPreference(raw: string | null): RouterProviderId {
  if (raw == null) return DEFAULT_ROUTER_PROVIDER;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value == null || Array.isArray(value)) return DEFAULT_ROUTER_PROVIDER;
    const record = value as Record<string, unknown>;
    if (record.schemaVersion !== 1 || !isRouterProviderId(record.provider)) return DEFAULT_ROUTER_PROVIDER;
    return record.provider;
  } catch {
    return DEFAULT_ROUTER_PROVIDER;
  }
}

export type RouterProviderPersistence = Pick<AgentDesktopBridge["clientPersistence"], "read" | "write">;

export async function loadRouterProvider(persistence: RouterProviderPersistence): Promise<RouterProviderId> {
  return parseRouterProviderPreference(await persistence.read(ROUTER_PROVIDER_PERSISTENCE_KEY));
}

export async function saveRouterProvider(persistence: RouterProviderPersistence, provider: RouterProviderId): Promise<void> {
  if (!isRouterProviderId(provider)) throw new Error("Unknown router provider.");
  await persistence.write(ROUTER_PROVIDER_PERSISTENCE_KEY, JSON.stringify({ schemaVersion: 1, provider }));
}
