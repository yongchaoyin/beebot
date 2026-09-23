/** Encrypted control plane and opt-in storage-only hosted HTTP server.
 * See docs/implementation/hosted-catalog-api.md for the incomplete shipping gates. */
export { TenantDirectory, TenantAccessError } from "./tenant-directory.js";
export type { TenantScope, TenantIdentity, ReadTenantIdentity, MemberRole } from "./tenant-directory.js";
export { TenantWorkspaces, nodeTenantIdentity } from "./tenant-workspaces.js";
export { TenantRecordCodec, LocalTenantKeyWrapper, TenantStorageError, newTenantKey } from "./tenant-crypto.js";
export type { TenantKeyWrapper, WrappedTenantKey, KeyContext } from "./tenant-crypto.js";

export { HostedCatalogServer } from "./catalog-server.js";
