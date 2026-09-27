import { createResource } from "./resource-provider.js";
import type { RemoteExecManager } from "./remote.js";
import type { Context } from "../context/core.js";

/** Local executor metadata, never a remote RPC or permission grant. */
export interface WorkingDirectoryResolver {
  resolve(ctx: Context, requested?: string): Promise<string | undefined>;
}
export const workingDirectoryResource = createResource<WorkingDirectoryResolver | undefined, RemoteExecManager>(
  () => undefined,
  () => {},
);
