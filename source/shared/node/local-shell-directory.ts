import { posix, win32 } from "node:path";

/** Resolve on the target computer, not the Host process (which may be Linux). */
export function resolveLocalShellDirectory(root: string | undefined, requested: string): string | undefined {
  const value = requested.trim();
  const windows = /^[A-Za-z]:[\\/]/.test(root ?? value) || (root ?? value).startsWith("\\\\");
  const paths = windows ? win32 : posix;
  // Drive-relative paths depend on the process's per-drive cwd, which the
  // remote Host cannot attest to when showing an approval.
  if (windows && /^[A-Za-z]:(?![\\/])/.test(value)) return undefined;
  if (root != null && paths.isAbsolute(root)) return paths.resolve(root, value || ".");
  if (paths.isAbsolute(value)) return paths.normalize(value);
  return undefined;
}

export function localShellApprovalTarget(command: string, workingDirectory: string): string {
  // JSON quoting makes the boundary unambiguous even for newlines/quotes in paths.
  // Keep the existing { action, target } approval wire format and renderer storage.
  return `Working directory: ${JSON.stringify(workingDirectory)}\n\n${command}`;
}
