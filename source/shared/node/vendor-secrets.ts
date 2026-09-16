import { readFileSync } from "node:fs";
import { writeFileReplaceSync } from "./atomic-write.js";

export function readPersistedVendorSecrets(storePath: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) return {};
    const secrets = (parsed as { secrets?: unknown }).secrets;
    if (typeof secrets !== "object" || secrets == null || Array.isArray(secrets)) return {};
    return Object.fromEntries(Object.entries(secrets).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

export function persistVendorSecret(storePath: string, key: string, value: string): void {
  const secrets = { ...readPersistedVendorSecrets(storePath), [key]: value };
  writeFileReplaceSync(storePath, `${JSON.stringify({ version: 1, secrets })}\n`, { mode: 0o600 });
}
