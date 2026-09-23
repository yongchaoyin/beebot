import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { SecureStorageCodec } from "../electron-main/secrets/secret-store.js";
import type { ConnectionPersistence, StoredConnection } from "./types.js";
import { normalizeNodeUrl } from "./transport.js";
import { importDpopKey } from "../shared/security/dpop.js";

export function createConnectionPersistence(filename: string, codec: SecureStorageCodec): ConnectionPersistence {
  let tail = Promise.resolve();
  return {
    async load() {
      let raw: string;
      try { raw = await readFile(filename, "utf8"); }
      catch (error: any) { if (error.code === "ENOENT") return []; throw error; }
      const disk = JSON.parse(raw);
      if (![1, 2].includes(disk.version) || !Array.isArray(disk.connections)) throw new Error("Unsupported server connection store.");
      return disk.connections.map((entry: any): StoredConnection => {
        if (typeof entry.id !== "string" || typeof entry.nodeId !== "string" || typeof entry.name !== "string") throw new Error("Invalid server connection record.");
        const baseUrl = normalizeNodeUrl(entry.baseUrl);
        const profile = { id: entry.id, nodeId: entry.nodeId, name: entry.name, baseUrl, status: "signed-out" as const };
        // Do not silently bind old bearer sessions to a new key. Explicit sign-in is required.
        if (!entry.encryptedDeviceKey) return { profile };
        if (!codec.isEncryptionAvailable()) throw new Error("Unlock the system keychain to load saved server sessions.");
        const deviceKeyPem = codec.decryptString(Buffer.from(entry.encryptedDeviceKey, "base64")); importDpopKey(deviceKeyPem);
        return { profile, deviceKeyPem, ...(entry.encryptedRefreshToken ? { refreshToken: codec.decryptString(Buffer.from(entry.encryptedRefreshToken, "base64")) } : {}) };
      });
    },
    save(connections) {
      const serialized = JSON.stringify({ version: 2, connections: connections.map(({ profile, refreshToken, deviceKeyPem }) => {
        if ((refreshToken || deviceKeyPem) && !codec.isEncryptionAvailable()) throw new Error("The system keychain is unavailable. The session cannot be saved securely.");
        if (refreshToken && !deviceKeyPem) throw new Error("A device key is required to save a bound session.");
        if (deviceKeyPem) importDpopKey(deviceKeyPem);
        return { id: profile.id, nodeId: profile.nodeId, name: profile.name, baseUrl: profile.baseUrl,
          ...(deviceKeyPem ? { encryptedDeviceKey: codec.encryptString(deviceKeyPem).toString("base64") } : {}),
          ...(refreshToken ? { encryptedRefreshToken: codec.encryptString(refreshToken).toString("base64") } : {}) };
      }) }, null, 2);
      const operation = tail.then(async () => {
        await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
        const staging = `${filename}.${randomUUID()}.tmp`;
        await writeFile(staging, serialized, { mode: 0o600 });
        await rename(staging, filename);
      });
      tail = operation.catch(() => {});
      return operation;
    },
  };
}
