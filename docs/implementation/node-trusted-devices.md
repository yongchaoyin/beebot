# Trusted device enrollment and persistent grants

This increment extends `node-device-security.md` on commit
`5a3dfa1b13ebab567668d9208c419f49d088d8fa`. It retains standard mandatory DPoP,
PKCE, TLS validation, per-Bot authorization and nonce/replay protection.
It does not implement new cryptography or import the unfinished SSH candidate.

## User flow

The initial owner setup displays eight random single-use recovery codes exactly
once. The operator saves them offline. First-device enrollment requires the owner
password, one recovery code and an explicit recovery confirmation. A Node with
zero trusted devices NEVER trusts the next password login automatically.

Thereafter an unknown key that successfully authenticates the owner password
receives a five-minute pending request, not an authorization code or session.
The existing trusted administrator opens Settings -> Servers -> Security &
devices, compares the complete key fingerprint AND request identifier shown on
the requesting browser, selects a role and Bot scope, and explicitly confirms.
The UI defaults to viewer and no selected Bots, not all Bots. The requesting
browser then clicks Check approval result. The ordinary single-use PKCE+DPoP
exchange completes; no separate unbound token flow is introduced.

Approvals/denials bind request ID, version and key. Decisions expire and are
single-use. A browser must retain its original CSRF cookie. Owner password is
checked at the start; pending requests contain neither it nor recovery codes.
Application browser authorization allows ten minutes overall; each pending
request still expires after five minutes. There is no automatic background
approval, unknown-device password fallback, or cross-Node trust sharing.

Known approved keys retain their role and Bot scope on subsequent owner login.
Permission edits apply to the device key and all its active sessions. They also
invalidate outstanding authorization codes and event tickets. Changing device
names does not change identity. A role restriction cannot be removed by logging
out and logging back in. New devices/permission changes/recovery rotation require
a trusted administrator whose OWNER PASSWORD login is less than five minutes old;
ordinary refresh does not count as new authentication.

## Revocation and recovery

Session revoke remains normal sign-out. Device block is a separate explicitly
confirmed action, bound to the current device version. It tombstones the key,
revokes all associated sessions, invalidates pending codes/tickets/requests and
closes established WebSockets. Password-only re-login does not unblock that key.
Blocking a key is not proof that every copy of the physical computer was found.
Neither operation cancels already accepted jobs or undoes external effects.

The last trusted administrator cannot be accidentally blocked or demoted. Approve
another administrator first, or use the explicit recovery flow. Recovery requires
both the owner password and one still-valid recovery code, revokes all previous
sessions, blocks previous trusted keys and installs the requesting key as the
replacement administrator. Bot identity, history, task records and work data stay.
Other unused recovery codes remain valid; rotate them immediately after suspected
exposure. Rotation replaces the entire set and only stores node/owner-bound hashes.

The recovery-code UI is transient: only an explicit confirmed regeneration returns
plaintext material. Routine security reads return a count. Refresh, switching
Node/account, hiding the output and unmount clear the visible value. No automatic
clipboard, localStorage or logging is used. Software/OS memory erasure and protection
against a compromised renderer are NOT claimed. This is intentionally sensitive
output that the authorized owner requests to save offline.

### Offline operator recovery (no trusted device available)

With the Node stopped and the existing controller lock free:

```sh
node .build/node/node/main.mjs recovery-codes \
  --data-dir /absolute/private/node \
  --output /absolute/private/recovery.json \
  --confirm-recovery
```

This is an explicit OS-operator escape hatch, not an HTTP/IPC endpoint. Both
directories must be canonical, private (0700), and owned by the invoking user.
An existing, private auth database is required. The output is exclusive-created
0600; existing files/symlinks are refused. The controller lock excludes a running
Node. Output and parent-directory fsync happen before the database transaction
commits; an I/O failure does not replace the old usable code set. The command does
not print codes, reset the owner password, delete Bots, or start tasks. After a
crash inspect the reported file explicitly rather than silently overwriting it.

Anyone controlling the Node OS account or root can use operator recovery or
replace the service itself. This feature does not purport to defeat root compromise.

## Persistence and endpoints

New tables share NodeAuth SQLite and transactions: `auth_trusted_devices`,
`auth_device_requests`, `auth_recovery_codes`. Approvals, recovery and audit
commit together. Pending requests survive restart with their original expiry;
expired requests are removed. Device list capacity is 200 keys per owner (blocked
keys remain tombstones); at most ten live pending requests per owner.

- `GET /v1/security/sessions` additionally returns trusted devices, pending
  requests and remaining recovery-code count. No private key/token/password/code
  is returned by routine reads.
- `POST /v1/security/requests/:id/approve` accepts `expectedVersion`, `thumbprint`,
  `grant: {role, botIds}`; `deny` accepts the first two fields only.
- `POST /v1/security/devices/:thumbprint/block` accepts `expectedVersion`.
- `POST /v1/security/recovery-codes` accepts `{}` and returns the new set once.
- Browser-only `POST /oauth/device-approval` checks/cancels the original request,
  with CSRF and strict Origin validation; it cannot approve itself.

Every mutation rechecks the administrator after delayed body reads, and Bot scope
must belong to the authenticated owner. Main-process IPC exposes these narrow
operations, not generic signing. Private signing keys and refresh tokens stay in
the existing OS-encrypted persistence. No dependency/lockfile changes.

## Upgrade behavior

Client and Node must be upgraded together. A new client requires both mandatory
DPoP and `trustedDevicesRequired` capability, and refuses credential transmission
to an endpoint missing this contract. Existing-bound device trust is imported ONCE
from unexpired, nonrevoked bound sessions at migration. Multiple grants for one key
are INTERSECTED (including role), not unioned. Existing trusted rows are never
re-created merely because sessions expire or a device is blocked. Old unbound
sessions remain revoked by the preceding security migration. If migration finds
no usable bound session, offline recovery is required; there is no password-only
bootstrap exception. This migration does not detect already-compromised sessions.
Back up owner data before upgrade. Downgrading to the older password-only service
is not a supported recovery procedure.

## Validation / remaining boundaries

Run the pinned Node toolchain and lockfile:

```sh
npm run check
npm run frontend:build
node --test tests/node-enrollment.test.mjs tests/node-security.test.mjs tests/node-security-ui.test.mjs
npm run node:build
BEEBOT_RUNTIME_INTEGRATION=1 node --test tests/node-runtime.test.mjs tests/node-e2e.test.mjs
node scripts/smoke-node-service.mjs
```

Enrollment tests use real HTTP, SQLite, signatures and WebSockets with an explicit
fixture task runtime; the opt-in suite uses real Host/Shell and a deterministic
model. Settings browser QA uses the real packaged snippet/Presence tokens with
controlled IPC/sample devices, not an installed Electron application or real
Keychain. Linux Docker demo scripts retain an explicit private fixture signing
identity to avoid silently re-enrolling on each run; they do not bypass approval.

Not included: SSH pairing integration, internal mTLS, task-scoped execution leases
or revocation, executor sandbox changes, hardware non-exportable keys, passkeys/MFA,
independent notification delivery, externally witnessed audit or installed Mac QA.
The security journal is local, bounded and not an independent alert channel.
The Node remains single-owner rather than a multi-tenant public hosting service.


## Task-safety follow-up

`node-task-safety.md` adds a separate, explicit device-block-and-freeze action and
Bot admission freezes. Ordinary logout and the original block-only operation
retain the behavior documented above; they do not silently cancel accepted work.
Only tasks accepted after the provenance migration can be attributed to a device.
