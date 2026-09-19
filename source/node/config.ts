import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const schema = z.object({
  version: z.literal(1), nodeId: z.string().uuid(), name: z.string().trim().min(1).max(100),
  bindHost: z.string().default("127.0.0.1"), port: z.number().int().min(1024).max(65535).default(7331),
  publicUrl: z.string().url(), maxConcurrentRuns: z.number().int().min(1).max(8).default(2),
  tls: z.object({ certFile: z.string(), keyFile: z.string() }).strict().optional(),
  tlsTermination: z.literal("trusted-proxy").optional(),
  model: z.object({ baseUrl: z.string().url(), modelId: z.string().min(1), apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/).default("CUSTOM_API_KEY") }).strict().optional(),
}).strict();
export type NodeConfig = z.infer<typeof schema>;
export function validateConfig(input: unknown): NodeConfig {
  const config = schema.parse(input);
  const url = new URL(config.publicUrl);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("publicUrl must be an origin without a path or credentials.");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) throw new Error("Remote servers require an HTTPS publicUrl.");
  if (url.protocol === "http:" && !["127.0.0.1", "::1", "localhost"].includes(config.bindHost)) throw new Error("Plain HTTP is allowed only on a loopback bind address.");
  if (config.tls && url.protocol !== "https:") throw new Error("TLS requires an HTTPS publicUrl.");
  if (!config.tls && !["127.0.0.1", "::1", "localhost"].includes(config.bindHost) && config.tlsTermination !== "trusted-proxy") throw new Error("Without TLS, bind to loopback or explicitly configure trusted-proxy TLS termination on a private network.");
  if (config.tlsTermination && url.protocol !== "https:") throw new Error("A trusted TLS proxy requires an HTTPS publicUrl.");
  if (config.model) {
    const endpoint = new URL(config.model.baseUrl);
    if (endpoint.username || endpoint.password || !["https:", "http:"].includes(endpoint.protocol)) throw new Error("Model endpoint must be HTTP(S) without embedded credentials.");
  }
  return { ...config, publicUrl: url.origin };
}
export function initializeConfig(dataDir: string): NodeConfig {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const config = validateConfig({ version: 1, nodeId: randomUUID(), name: "My BeeBot", bindHost: "127.0.0.1", port: 7331, publicUrl: "http://127.0.0.1:7331", maxConcurrentRuns: 2 });
  writeFileSync(path.join(dataDir, "node.json"), `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return config;
}
export function loadConfig(dataDir: string): NodeConfig { return validateConfig(JSON.parse(readFileSync(path.join(dataDir, "node.json"), "utf8"))); }
