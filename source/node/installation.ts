import { constants, closeSync, fstatSync, openSync, readSync, accessSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { NodeConfig } from "./config.js";

/** Installation commands never collect an OS password or create a desktop identity. */
const FLAGS: Record<string, readonly string[]> = {
  init: ["data-dir", "name", "public-url", "bind-host", "trusted-proxy", "if-absent"],
  start: ["data-dir", "setup-output"],
  doctor: ["data-dir"],
  verify: ["data-dir"],
  "setup-link": ["data-dir"],
  "configure-model": ["data-dir", "base-url", "model-id", "api-key-stdin"],
};
const SWITCHES = new Set(["trusted-proxy", "if-absent", "api-key-stdin"]);
export function parseNodeArguments(command: string, args: readonly string[]): Record<string, string | true> {
  const allowed = FLAGS[command];
  if (!allowed) throw new Error("Unknown server command.");
  const result: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    const key = token.startsWith("--") ? token.slice(2) : "";
    if (!allowed.includes(key) || Object.hasOwn(result, key)) throw new Error("Unknown or repeated server option.");
    if (SWITCHES.has(key)) { result[key] = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`A value is required for --${key}.`);
    result[key] = value;
  }
  if (result["setup-output"] && !["console", "file"].includes(String(result["setup-output"]))) throw new Error("--setup-output must be console or file.");
  return result;
}

const KEY_LIMIT = 16 * 1024;
export function validateModelKey(value: string): string {
  const key = value.trim();
  if (!key || Buffer.byteLength(value) > KEY_LIMIT || /[\s\x00-\x1f\x7f]/.test(key)) throw new Error("The model credential must be a non-empty, single-line value of at most 16 KiB.");
  return key;
}
export async function readModelKeyInput(input: AsyncIterable<Buffer | string>): Promise<string> {
  const parts: Buffer[] = []; let size = 0;
  for await (const part of input) {
    const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += bytes.length;
    if (size > KEY_LIMIT) throw new Error("The model credential exceeds 16 KiB.");
    parts.push(bytes);
  }
  return validateModelKey(Buffer.concat(parts).toString("utf8"));
}
export function readPrivateFile(file: string, limit: number): string {
  // Reject symlinks and unbounded special files, and check the same opened inode.
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit || (stat.mode & 0o077) !== 0) throw new Error("Invalid private file.");
    const bytes = Buffer.alloc(limit + 1); let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size > limit) throw new Error("Private file is too large.");
    return bytes.subarray(0, size).toString("utf8");
  } finally { closeSync(fd); }
}
export type ModelCredential = { status: "available"; value: string } | { status: "missing" | "unreadable" };
export function readModelCredential(model: NodeConfig["model"], env: NodeJS.ProcessEnv): ModelCredential {
  if (!model) return { status: "missing" };
  try {
    // An explicitly configured file must not silently fall back to another key.
    const value = model.apiKeyFile ? readPrivateFile(model.apiKeyFile, KEY_LIMIT) : env[model.apiKeyEnv];
    if (!value?.trim()) return { status: "missing" };
    return { status: "available", value: validateModelKey(value) };
  } catch { return { status: "unreadable" }; }
}

export interface NodeReadiness {
  version: 1;
  checkedAt: string;
  status: "configuration_required" | "configured" | "degraded";
  model: "not_configured" | "credential_missing" | "credential_unreadable" | "configured_not_tested";
  hostBundle: "available" | "missing";
  shell: "available" | "missing";
  browser: "not_advertised";
  desktop: "not_advertised";
  executionProbe: "not_run";
}
/** Configuration inspection is not a model call or a successful work/desktop probe. */
export function inspectNodeReadiness(config: NodeConfig, credential: ModelCredential, hostEntry: string, shell = "/bin/sh"): NodeReadiness {
  const available = (file: string, mode: number) => { try { if (!statSync(file).isFile()) return false; accessSync(file, mode); return true; } catch { return false; } };
  const hostBundle = available(hostEntry, constants.R_OK) ? "available" : "missing";
  const shellStatus = available(shell, constants.X_OK) ? "available" : "missing";
  const model = !config.model ? "not_configured" : credential.status === "available" ? "configured_not_tested" : credential.status === "missing" ? "credential_missing" : "credential_unreadable";
  return {
    version: 1, checkedAt: new Date().toISOString(),
    status: hostBundle === "missing" || shellStatus === "missing" ? "degraded" : model === "configured_not_tested" ? "configured" : "configuration_required",
    model, hostBundle, shell: shellStatus, browser: "not_advertised", desktop: "not_advertised", executionProbe: "not_run",
  };
}

export const SETUP_FILE = "setup-link.json";
export function removeSetupLink(dataDir: string): void {
  try { unlinkSync(path.join(dataDir, SETUP_FILE)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
export function storeSetupLink(dataDir: string, nodeId: string, origin: string, code: string, expiresAt: number): void {
  const file = path.join(dataDir, SETUP_FILE);
  removeSetupLink(dataDir);
  writeFileSync(file, JSON.stringify({ version: 1, nodeId, url: `${origin}/setup?code=${encodeURIComponent(code)}`, expiresAt }) + "\n", { flag: "wx", mode: 0o600 });
}
export function loadSetupLink(dataDir: string, config: Pick<NodeConfig, "nodeId" | "publicUrl">, now = Date.now()): string {
  const value = JSON.parse(readPrivateFile(path.join(dataDir, SETUP_FILE), 4096));
  const url = new URL(value.url);
  if (value.version !== 1 || value.nodeId !== config.nodeId || !Number.isFinite(value.expiresAt) || value.expiresAt <= now ||
      url.origin !== config.publicUrl || url.pathname !== "/setup" || url.username || url.password || url.hash ||
      url.searchParams.size !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("code") ?? "")) {
    throw new Error("Setup link is expired or does not match this node. It may already have been consumed; do not reset node data.");
  }
  return url.href;
}

/** Read-only network check. No redirect, credentials, TLS override, or model call. */
export async function verifyNodeEndpoint(config: Pick<NodeConfig, "nodeId" | "publicUrl">, request: typeof fetch = fetch): Promise<void> {
  const response = await request(new URL("/v1/node", config.publicUrl), { redirect: "error", signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error("The public Node endpoint is not available; installation data was kept.");
  }
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 16 * 1024) throw new Error("Unexpected Node response size.");
      parts.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const value = JSON.parse(Buffer.concat(parts).toString("utf8"));
  if (value?.protocolVersion !== 1 || value?.nodeId !== config.nodeId || value?.id !== config.nodeId) throw new Error("The HTTPS address does not identify this Node. Check DNS and proxy routing; no identity or data was replaced.");
}
