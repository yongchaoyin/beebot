/** Internal control-plane API, not a public hosting endpoint.
 * See docs/implementation/multi-tenant-foundation.md for the shipping gates. */
export { TenantDirectory, TenantAccessError } from "./tenant-directory.js";
export type { TenantScope, TenantIdentity, ReadTenantIdentity, MemberRole } from "./tenant-directory.js";
export { TenantWorkspaces, nodeTenantIdentity } from "./tenant-workspaces.js";
export { TenantRecordCodec, LocalTenantKeyWrapper, TenantStorageError, newTenantKey } from "./tenant-crypto.js";
export type { TenantKeyWrapper, WrappedTenantKey, KeyContext } from "./tenant-crypto.js";
