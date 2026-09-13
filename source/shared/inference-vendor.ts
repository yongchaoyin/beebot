export const HTTP_INFERENCE_VENDORS = ["openrouter", "openai", "deepseek", "custom"] as const;
export type HttpInferenceVendor = (typeof HTTP_INFERENCE_VENDORS)[number];

export const LOCAL_ACCOUNT_ID = "local";
export const LOCAL_ACCOUNT_STATUS = {
  kind: "logged-in",
  authId: LOCAL_ACCOUNT_ID,
  displayName: "Local",
} as const;

export interface InferenceVendorPreset {
  readonly id: HttpInferenceVendor;
  readonly label: string;
  readonly defaultBaseUrl: string;
  readonly defaultModelId: string;
  readonly secretKey: string;
}

export const INFERENCE_VENDOR_PRESETS: readonly InferenceVendorPreset[] = [
  { id: "openrouter", label: "OpenRouter", defaultBaseUrl: "https://openrouter.ai/api/v1", defaultModelId: "openai/gpt-4.1-mini", secretKey: "OPENROUTER_API_KEY" },
  { id: "openai", label: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1", defaultModelId: "gpt-4.1-mini", secretKey: "OPENAI_API_KEY" },
  { id: "deepseek", label: "DeepSeek", defaultBaseUrl: "https://api.deepseek.com", defaultModelId: "deepseek-chat", secretKey: "DEEPSEEK_API_KEY" },
  { id: "custom", label: "Custom", defaultBaseUrl: "", defaultModelId: "", secretKey: "CUSTOM_API_KEY" },
];

export interface InferenceHttpConfig {
  readonly baseUrl: string;
  readonly modelId: string;
}

export interface VendorSetupInput {
  readonly provider: string;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly modelId?: string;
}

export type VendorSetupResult =
  | { readonly ok: true; readonly provider: HttpInferenceVendor; readonly apiKey: string; readonly http: InferenceHttpConfig }
  | { readonly ok: false; readonly error: string };

const PRESETS = new Map(INFERENCE_VENDOR_PRESETS.map((preset) => [preset.id, preset]));

export function isHttpInferenceVendor(value: unknown): value is HttpInferenceVendor {
  return typeof value === "string" && (HTTP_INFERENCE_VENDORS as readonly string[]).includes(value);
}

export function isCursorlessProvider(value: unknown): boolean {
  return isHttpInferenceVendor(value) || value === "claude-code" || value === "codex";
}

export function vendorPreset(id: HttpInferenceVendor): InferenceVendorPreset {
  const preset = PRESETS.get(id);
  if (preset == null) throw new Error(`Unknown inference vendor: ${id}`);
  return preset;
}

export function parseInferenceHttpConfig(value: unknown): InferenceHttpConfig | null {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.baseUrl !== "string" || typeof record.modelId !== "string") return null;
  return { baseUrl: record.baseUrl.trim().replace(/\/+$/, ""), modelId: record.modelId.trim() };
}

export function resolveVendorHttpConfig(provider: HttpInferenceVendor, stored?: InferenceHttpConfig | null): InferenceHttpConfig {
  const preset = vendorPreset(provider);
  const baseUrl = stored?.baseUrl?.trim().replace(/\/+$/, "") || preset.defaultBaseUrl;
  const modelId = stored?.modelId?.trim() || preset.defaultModelId;
  return { baseUrl, modelId };
}

export function validateVendorSetup(input: VendorSetupInput): VendorSetupResult {
  if (!isHttpInferenceVendor(input.provider)) return { ok: false, error: "Choose a model vendor." };
  const apiKey = input.apiKey.trim();
  if (apiKey.length === 0) return { ok: false, error: "Paste an API key to continue." };
  const http = resolveVendorHttpConfig(input.provider, {
    baseUrl: input.baseUrl?.trim() ?? "",
    modelId: input.modelId?.trim() ?? "",
  });
  if (input.provider === "custom" && http.baseUrl.length === 0) return { ok: false, error: "Custom vendors need a Base URL." };
  if (input.provider === "custom" && http.modelId.length === 0) return { ok: false, error: "Custom vendors need a model ID." };
  if (http.baseUrl.length === 0 || http.modelId.length === 0) return { ok: false, error: "This vendor needs a Base URL and model ID." };
  return { ok: true, provider: input.provider, apiKey, http };
}

export function mapAuthStatus<Status extends { readonly kind: string }>(
  status: Status,
  options: { readonly localAccountActive: boolean },
): Status | typeof LOCAL_ACCOUNT_STATUS {
  if (status.kind === "logged-in" || status.kind === "logging-in") return status;
  if (options.localAccountActive) return LOCAL_ACCOUNT_STATUS;
  return status;
}
