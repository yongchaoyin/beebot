import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

import { resolveLocalShellDirectory } from "../../shared/node/local-shell-directory.js";
import { realpathNearestExisting } from "../../shared/node/paths.js";

export class SandLocalExecPathError extends Error {}

async function statOrUndefined(path: string) {
  try { return await stat(path); } catch { return undefined; }
}

export async function regularFileSizeBytes(path: string): Promise<number | undefined> {
  const stats = await statOrUndefined(path);
  return stats?.isFile() === true ? stats.size : undefined;
}

export function resolveLocalExecRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.SAND_LOCAL_EXEC_ROOT?.trim() || env.SAND_AGENT_PROJECT_DIR?.trim();
  return resolve(configured != null && configured.length > 0 ? configured : homedir());
}

async function isDirectory(path: string): Promise<boolean> {
  return (await statOrUndefined(path))?.isDirectory() ?? false;
}

export async function resolveShellWorkingDirectory(args: { readonly root: string; readonly requested: string }): Promise<{ workingDirectory: string }> {
  const resolved = resolveLocalShellDirectory(args.root, args.requested);
  if (resolved == null || !await isDirectory(resolved)) {
    throw new SandLocalExecPathError(`The requested working directory does not exist or is not a directory: ${args.requested || args.root}. Nothing ran. Choose an existing directory and retry.`);
  }
  return { workingDirectory: resolved };
}

export function escapesRoot(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel !== "" && (rel.startsWith("..") || isAbsolute(rel));
}

export async function containPath(args: { readonly root: string; readonly path: string }): Promise<string> {
  const resolved = isAbsolute(args.path) ? resolve(args.path) : resolve(args.root, args.path);
  if (escapesRoot(args.root, resolved)) {
    throw new SandLocalExecPathError(`Path is outside the allowed local-exec root and was refused: ${args.path}`);
  }
  let realRoot: string;
  try { realRoot = await realpathNearestExisting(args.root); }
  catch { return resolved; }
  const realResolved = await realpathNearestExisting(resolved);
  if (escapesRoot(realRoot, realResolved)) {
    throw new SandLocalExecPathError(`Path resolves through a symlink to outside the allowed local-exec root and was refused: ${args.path}`);
  }
  return resolved;
}

/**
 * The original manager wiring depends on the recovered workspace local-exec
 * package. Keeping that dependency explicit prevents a reduced substitute from
 * being mistaken for the shipped executor while the package runtime is rebuilt.
 */
export interface LocalExecManagerRuntime<Manager> {
  build(root: string, maxFileBytes: number, guards: {
    readonly containPath: typeof containPath;
    readonly regularFileSizeBytes: typeof regularFileSizeBytes;
    readonly resolveShellWorkingDirectory: typeof resolveShellWorkingDirectory;
  }): Manager;
}

export function buildLocalExecManager<Manager>(root: string, maxFileBytes: number, runtime: LocalExecManagerRuntime<Manager>): Manager {
  return runtime.build(root, maxFileBytes, { containPath, regularFileSizeBytes, resolveShellWorkingDirectory });
}

