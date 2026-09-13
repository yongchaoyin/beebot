import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
  mkdirSync(dirname(storePath), { recursive: true });
  const temporary = `${storePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ version: 1, secrets })}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, storePath);
}
