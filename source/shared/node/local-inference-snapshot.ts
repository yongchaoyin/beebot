import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { isSandInferenceProvider, type SandInferenceProvider } from "../inference-router.js";
import { isHttpInferenceVendor, parseInferenceHttpConfig, parseInferenceVendorAccounts, vendorPreset, type InferenceHttpConfig, type InferenceVendorAccount } from "../inference-vendor.js";

/** Only model routing and its selected credentials cross this read-only mount.
 * Never mount the desktop's complete data/keychain directory into the VM. */
export const LOCAL_INFERENCE_SNAPSHOT_ENV = "BEEBOT_LOCAL_INFERENCE_SNAPSHOT";
export const LOCAL_INFERENCE_MOUNT = "/run/beebot-inference";
export interface LocalInferenceSnapshot {
  version: 1;
  provider: SandInferenceProvider;
  vendors: InferenceVendorAccount[];
  defaultVendorId: string | null;
  http: InferenceHttpConfig | null;
  localAccountActive: boolean;
  secrets: Record<string, string>;
}
export function localInferenceDirectory(settingsPath: string): string {
  return join(dirname(settingsPath), "local-docker-inference");
}
function readObject(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error("Invalid local model configuration file.");
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* Do not leak credential contents or guess a replacement configuration. */ }
  throw new Error("Cannot read local model configuration; the previous runtime snapshot was retained.");
}

export function publishLocalInferenceSnapshot(settingsPath: string): string {
  const settings = readObject(settingsPath);
  const provider = isSandInferenceProvider(settings.inferenceProvider) ? settings.inferenceProvider : "cursor";
  const http = parseInferenceHttpConfig(settings.inferenceHttp);
  let vendors = parseInferenceVendorAccounts(settings.inferenceVendors);
  if (settings.inferenceVendors !== undefined && (!Array.isArray(settings.inferenceVendors) || vendors.length !== settings.inferenceVendors.length)) throw new Error("Model catalog is malformed; the previous runtime configuration was retained.");
  // Only pre-catalog profiles have a legacy account. An explicit empty catalog
  // means the user deleted it, not permission to resurrect keys or change vendors.
  if (settings.inferenceVendors === undefined && isHttpInferenceVendor(provider)) {
    const preset = vendorPreset(provider);
    vendors = [{ id: "legacy", label: preset.label, provider, baseUrl: http?.baseUrl || preset.defaultBaseUrl,
      modelId: http?.modelId || preset.defaultModelId, secretKey: preset.secretKey }];
  }
  const defaultVendorId = vendors.some(v => v.id === settings.defaultInferenceVendorId)
    ? String(settings.defaultInferenceVendorId) : vendors[0]?.id ?? null;
  const stored = readObject(join(dirname(settingsPath), "box-secrets.json")).secrets;
  const source = stored && typeof stored === "object" && !Array.isArray(stored) ? stored as Record<string, unknown> : {};
  const keys = new Set(vendors.map(v => v.secretKey));
  if (!vendors.length && isHttpInferenceVendor(provider) && settings.inferenceVendors === undefined) keys.add(vendorPreset(provider).secretKey);
  const secrets: Record<string, string> = Object.create(null);
  for (const key of keys) if (typeof source[key] === "string" && source[key].trim()) secrets[key] = source[key].trim();
  const snapshot: LocalInferenceSnapshot = { version: 1, provider, vendors, defaultVendorId, http,
    localAccountActive: settings.localAccountActive === true, secrets };
  const directory = localInferenceDirectory(settingsPath);
  if (existsSync(directory) && (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())) throw new Error("Local model mount must be a private direct directory.");
  mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
  const target = join(directory, "current.json"), temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(snapshot), { flag: "wx", mode: 0o600 });
    renameSync(temporary, target);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  return directory;
}

export function readLocalInferenceSnapshot(env: NodeJS.ProcessEnv = process.env): LocalInferenceSnapshot | undefined {
  const file = env[LOCAL_INFERENCE_SNAPSHOT_ENV];
  if (!file) return undefined;
  const raw = readObject(file);
  const vendors = parseInferenceVendorAccounts(raw.vendors);
  if (raw.version !== 1 || !isSandInferenceProvider(raw.provider) || !Array.isArray(raw.vendors) || vendors.length !== raw.vendors.length ||
      !(raw.defaultVendorId === null || typeof raw.defaultVendorId === "string" && vendors.some(v => v.id === raw.defaultVendorId)) ||
      typeof raw.localAccountActive !== "boolean" || !raw.secrets || typeof raw.secrets !== "object" || Array.isArray(raw.secrets) ||
      Object.values(raw.secrets).some(value => typeof value !== "string")) {
    throw new Error("The desktop model configuration is unavailable or invalid. Reconnect the local computer; no alternative model was selected.");
  }
  return { version: 1, provider: raw.provider, vendors, defaultVendorId: raw.defaultVendorId as string | null,
    http: parseInferenceHttpConfig(raw.http), localAccountActive: raw.localAccountActive, secrets: raw.secrets as Record<string, string> };
}

export function snapshotHttpSession(snapshot: LocalInferenceSnapshot, provider: string, selected?: InferenceVendorAccount) {
  const id = selected?.id ?? snapshot.defaultVendorId;
  const account = snapshot.vendors.find(v => v.id === id);
  if (!account || account.provider !== provider || selected && (selected.baseUrl !== account.baseUrl || selected.modelId !== account.modelId || selected.secretKey !== account.secretKey)) {
    throw new Error("This Bot's model selection changed or is missing. Select its API again; the request was not sent to another model.");
  }
  const apiKey = snapshot.secrets[account.secretKey];
  if (!apiKey) throw new Error(`${account.label} needs its own API key. Edit this model in Settings → Router → Model APIs.`);
  if (!account.baseUrl || !account.modelId) throw new Error(`${account.label} needs a Base URL and model ID.`);
  return { apiKey, baseUrl: account.baseUrl, modelId: account.modelId };
}
