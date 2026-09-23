import { constants, closeSync, fsyncSync, lstatSync, openSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NodeAuth } from "./auth.js";
import { loadConfig } from "./config.js";
import { ControlStore } from "./control-store.js";

function privateDirectory(directory: string): void {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory || (stat.mode & 0o077) !== 0 ||
      typeof process.getuid !== "function" || stat.uid !== process.getuid()) {
    throw new Error("Recovery requires a canonical private directory owned by the current Node operator (mode 0700).");
  }
}

/** Explicit operator escape hatch, not an HTTP authentication shortcut. The Node
 * must be stopped and its existing controller lock acquired before issuing codes.
 * Never accepts an owner password, resets owner/Bot data, or prints credentials.
 */
export function writeOfflineRecoveryCodes(dataDir: string, output: string): void {
  if (!path.isAbsolute(dataDir) || !path.isAbsolute(output) || output !== path.normalize(output)) throw new Error("Use canonical absolute paths for offline recovery.");
  privateDirectory(dataDir); privateDirectory(path.dirname(output));
  const config = loadConfig(dataDir);
  const authFile = lstatSync(path.join(dataDir, "auth.sqlite"));
  if (!authFile.isFile() || authFile.isSymbolicLink() || (authFile.mode & 0o077) !== 0 || authFile.uid !== process.getuid!()) throw new Error("Recovery requires the existing private authentication database.");
  const lock = new ControlStore(dataDir);
  let auth: NodeAuth | undefined, fd: number | undefined, wrote = false;
  try {
    // O_EXCL rejects existing files, including symlinks. Open BEFORE rotating codes.
    fd = openSync(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    auth = new NodeAuth({ dataDir, issuer: config.publicUrl });
    auth.offlineRecoveryCodes(codes => {
      writeFileSync(fd!, JSON.stringify({ version: 1, nodeId: config.nodeId, issuer: config.publicUrl, codes }, null, 2) + "\n");
      fsyncSync(fd!);
      const parent = openSync(path.dirname(output), constants.O_RDONLY | constants.O_DIRECTORY);
      try { fsyncSync(parent); } finally { closeSync(parent); }
    });
    wrote = true;
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (fd !== undefined && !wrote) { try { unlinkSync(output); } catch { /* Do not hide the original failed recovery. */ } }
    auth?.close(); lock.close();
  }
}
