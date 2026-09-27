import { createHash } from "node:crypto";
import { posix } from "node:path";
import { CombinedResourceAccessor, resourceEntry, type ResourceAccessor } from "../../packages/agent-exec/resource-provider.js";
import type { RemoteExecManager } from "../../packages/agent-exec/remote.js";
import { shellExecutorResource } from "../../packages/agent-exec/shell.js";
import { shellStreamExecutorResource } from "../../packages/agent-exec/shell-stream.js";
import { backgroundShellExecutorResource } from "../../packages/agent-exec/background-shell.js";
import { readExecutorResource } from "../../packages/agent-exec/read.js";
import { workingDirectoryResource } from "../../packages/agent-exec/working-directory.js";
import type { Context } from "../../packages/context/core.js";
import { runBoxShell, shellSingleQuote } from "./box-file-transfer.js";

export const TEAM_WORKSPACE = "/workspace/shared";
export function agentWorkspacePath(agentId: string): string {
  if (!agentId) throw new Error("A Bot identity is required for its workspace");
  return `/workspace/bots/${createHash("sha256").update(agentId).digest("hex")}`;
}

/** Directory defaults prevent accidental collisions; they are not an OS sandbox. */
export function withAgentWorkspace<T extends object>(base: T, workspace: string): T {
  const accessor = base as unknown as ResourceAccessor<RemoteExecManager>;
  let prepared: Promise<void> | undefined;
  const prepare = async (ctx: Context) => {
    prepared ??= runBoxShell(ctx, accessor, `mkdir -p -- ${shellSingleQuote(workspace)} ${shellSingleQuote(TEAM_WORKSPACE)}`)
      .catch(error => { prepared = undefined; throw error; });
    await prepared;
  };
  const resolve = (requested = "") => posix.resolve(workspace, requested || ".");
  const shellArgs = <A extends { workingDirectory: string; clone(): A }>(args: A): A => {
    const copy = args.clone();
    copy.workingDirectory = resolve(args.workingDirectory);
    return copy;
  };
  const scoped = new CombinedResourceAccessor(accessor, [
    resourceEntry(workingDirectoryResource, { async resolve(_ctx: Context, requested?: string) { return resolve(requested); } }),
    resourceEntry(shellExecutorResource, { async execute(ctx, args, options) {
      await prepare(ctx);
      return accessor.get(shellExecutorResource).execute(ctx, shellArgs(args), options);
    } }),
    resourceEntry(shellStreamExecutorResource, { async *execute(ctx, args, options) {
      await prepare(ctx);
      yield* accessor.get(shellStreamExecutorResource).execute(ctx, shellArgs(args), options);
    } }),
    resourceEntry(backgroundShellExecutorResource, { async execute(ctx, args, options) {
      await prepare(ctx);
      return accessor.get(backgroundShellExecutorResource).execute(ctx, shellArgs(args), options);
    } }),
    resourceEntry(readExecutorResource, { async execute(ctx, args, options) {
      const copy = args.clone();
      copy.path = resolve(args.path);
      return accessor.get(readExecutorResource).execute(ctx, copy, options);
    } }),
  ]);
  return new Proxy(base, { get(target, name, receiver) {
    return name === "get" ? scoped.get.bind(scoped) : Reflect.get(target, name, receiver);
  } });
}
