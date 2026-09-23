import { closeSync, constants, existsSync, fsyncSync, lstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** One trusted catalog controller per root. OS/SQLite releases the lock on
 * process death; never infer a stale lock from a PID or delete another lock. */
export function lockCatalogRoot(root: string, nodeId: string, issuer: string): () => void {
  const file = path.join(root, "catalog-lock.sqlite");
  if (existsSync(file) && (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())) throw new Error("Invalid hosting lock.");
  closeSync(openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600));
  const lock = new DatabaseSync(file);
  try { lock.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE"); }
  catch { lock.close(); throw new Error("Hosted data directory already has an active controller."); }
  try {
    const marker = path.join(root, "hosting-identity.json"), expected = { version: 1, nodeId, issuer };
    if (existsSync(marker)) {
      const stat = lstatSync(marker);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 || stat.mode & 0o077) throw new Error("Invalid hosting identity.");
      const old = JSON.parse(readFileSync(marker, "utf8"));
      if (JSON.stringify(old) !== JSON.stringify(expected)) throw new Error("Hosted identity changed. Explicit migration is required.");
    } else {
      const fd = openSync(marker, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, JSON.stringify(expected)); fsyncSync(fd); } finally { closeSync(fd); }
      const dir = openSync(root, constants.O_RDONLY); try { fsyncSync(dir); } finally { closeSync(dir); }
    }
  } catch (e) { lock.close(); throw e; }
  let closed = false;
  return () => { if (!closed) { closed = true; lock.close(); } };
}
