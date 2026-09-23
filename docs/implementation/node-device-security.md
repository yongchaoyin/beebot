# Node device-bound security, first implementation

> Follow-up: `node-trusted-devices.md` adds approval, persistent device grants,
> device blocking and recovery. The "remaining work" below describes this
> original increment; the follow-up supersedes its password-only enrollment
> and per-session-only grant limitations.

Baseline: develop `183fd0bb11a78562177d8ee1197c72e5ba17a161`.
This increment protects the independent Node HTTP/event API and the desktop
connection manager. It does not import the unmerged SSH candidate, change the
local legacy Host RPC, invent an encryption primitive, merge develop/main, or
publish an application or image.

## Implemented

- Mandatory ES256/P-256 DPoP (RFC 9449), with RFC 7638 public-key thumbprints.
  Authorizations bind `dpop_jkt` before code exchange, independently of PKCE.
  Access and refresh credentials are bound to that key. No Bearer fallback.
- Public asymmetric JWKs only: fixed algorithm/type, no private/remote keys,
  strict JSON including duplicate/escaped-duplicate names, canonical base64url,
  bounded proofs, method and queryless target, token hash, server nonce and time.
  Node/OpenSSL implements signing and verification; no new dependency.
- Unpredictable server nonces, at most 120 seconds past / 30 seconds future,
  persisted `(jkt,jti)` replay records. The 50,000-record bound rejects requests
  rather than evicting live proofs. Nonces rotate and are new after restart.
- Each desktop connection generates and persists its own software signing key
  through the existing operating-system-backed encryption codec, before opening
  the system browser. Profiles/renderer IPC contain neither the private key nor
  refresh tokens. This is NOT Secure Enclave or hardware-backed non-exportability.
- Existing user login, CSRF, state, strict issuer, PKCE, refresh rotation and
  credential-reuse revocation remain in use. Stolen refresh credentials with
  another key cannot revoke the real owner's session family.
- Access credentials last five minutes. Existing refresh idle/absolute limits
  remain 30/90 days in this increment. Refresh is serialized by connection.
  Client retries only explicit nonce challenges with a fresh proof and the same
  body/idempotency key. Transport errors do not replay uncertain writes.
- Per-session administrator/operator/viewer grants, optionally restricted to
  selected Bot IDs. Snapshots, events, goal reads and writes check server-side
  permissions AND resource ownership. Grant changes cannot reference another
  owner's Bot. Empty scope grants no Bot access.
- Administrative session/permission changes require an owner login within the
  preceding five minutes; ordinary token refresh does not extend that window.
- Session revocation and permission changes invalidate event tickets and close
  established WebSockets. The initial event frame requires a ticket-bound key
  proof; this is an explicit BeeBot event profile, not a claim that WebSocket
  frames themselves are RFC 9449 HTTP requests.
- Delayed request bodies recheck the current session grant immediately before
  mutations, so a revocation or downgrade during body upload cannot keep old rights.
- Main-process request generation guards discard late results after sign-out,
  removal or a changed session. They do not resend under a replacement session.
- Private Node audit events record authorization, revocation and permission
  changes. Invalid device proofs against active known access tokens are logged
  at most once per session/minute. The local journal retains at most 10,000
  records; neither credentials nor message bodies are written into it.
- Native HTTPS listener requires TLS 1.3. Existing trusted reverse-proxy
  deployments still need their own HTTPS/TLS policy; the application does not
  configure or attest to every proxy. Loopback HTTP remains a local-only mode.

## User interface and API

Settings -> Servers -> Security & devices uses the existing packaged Settings
adapter and trusted main-process IPC. It lists up to 200 recent sessions and
200 recent audit records (the panel shows the newest 20 events). The panel is
an administrative view, not a second chat workspace.

- `GET /v1/security/sessions`
- `GET /v1/security/events`
- `POST /v1/security/sessions/:id/grant` with `role` and `botIds`
- `POST /v1/security/sessions/:id/revoke` with an empty object

Permissions/revocations require inline confirmation. Confirmation identifies the
role and exact Bot scope. Editing a selection, switching servers, signing out or
leaving Settings invalidates it. Failed changes remain unconfirmed. Revoked
sessions visibly stay inactive, and cannot be restored with a permission edit.
UI mutation failures are not automatically retried. Re-authentication is an
explicit browser action; the renderer receives no generic signing capability.

## Migration / deployment

Upgrade client and Node together. New clients reject Nodes that do not advertise
mandatory DPoP; new Nodes reject old Bearer clients. There is no automatic downgrade.
On Node startup, old unbound sessions are revoked and old unbound authorization
codes removed. Existing owner account, Bot identity, messages and task data are
preserved. Desktop connection store v2 encrypts the software key and refresh
credential separately; a v1 connection remains listed but requires explicit login.
Back up the private profile before upgrading. Returning to an old executable is
not a supported security downgrade or database rollback procedure.

An owner who supplies the Node password can still explicitly authorize a NEW
administrator session. Grant restrictions apply to sessions, not all future
sessions using that password or the same physical computer. This increment is
NOT a trusted-device-approval/MFA system, and does not protect a stolen owner
password from new-device enrollment.

## Explicit remaining work

- Independent trusted-device approval, MFA/passkeys, recovery codes and key
  rotation UI are not implemented. A hardware key provider requires native work.
- A session revoke blocks that session's HTTP/event access; it does NOT cancel
  already accepted jobs, revoke all sessions sharing a physical device, or undo
  external actions. Task-level authorization/revocation is a separate increment.
- Internal mTLS/executor credentials, unmerged SSH pairing integration, execution
  sandbox changes, and outbound security notifications are not included.
- Audit is local and bounded, not append-only externally witnessed logging. It
  cannot prove integrity after root compromise. No independent alert channel is
  configured by this change.
- This remains a single-owner Node, not a public multi-tenant service. A hostile
  program controlling an authorized client can potentially ask it to sign; key
  binding alone cannot make a compromised endpoint trustworthy.
- DPoP is not payload encryption or a request-body signature. TLS termination
  points must remain trusted. Business authorization/confirmation is separate.

## Verification

Use the pinned toolchain/lockfile:

```sh
npm run check
npm run frontend:build
node --test tests/node-security.test.mjs tests/node-security-ui.test.mjs
npm run node:build
BEEBOT_RUNTIME_INTEGRATION=1 node --test tests/node-runtime.test.mjs tests/node-e2e.test.mjs
```

The security suite uses independent Node-crypto signing and WebCrypto verification,
real HTTP/TLS 1.3, SQLite, WebSockets and the actual connection manager. Task runtime
is explicitly a fixture there. Native certificate verification stays enabled.
The separate opt-in runtime suite executes real Host/Shell with a deterministic
model, not a production provider.

Happy DOM executes the real Settings snippet with controlled IPC. Browser evidence
is a trusted in-memory Chromium component fixture because local navigation is
blocked by the environment, not a full Electron app or real system Keychain test.
Existing install, smoke and browser-auth verification scripts now use bound proofs.
Evidence, screenshots and temporary validation workflows are not production files.
