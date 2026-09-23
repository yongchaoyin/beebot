# Client connection to an already deployed server

## Scope and baseline

The client connects; an administrator deploys and maintains the Node separately.
No SSH credentials, Docker commands, installer RPC, release catalog or remote
provisioning are introduced by this change. It is based on the pinned safety
branch `84880c2ae6514b0fecc41a6a57fedc612beda92e` (PR #11, which depends on
trusted enrollment and device security). It does not import installation PR #10.
Do not present these pending safety PRs as already merged into develop.

## Main-process connection contract

1. `inspect(address)` validates a canonical HTTPS origin (HTTP loopback only),
   reads bounded public Node and authorization-server metadata without cookies,
   tokens, DPoP proofs or redirects, and returns a public identity preview.
2. A main-process random preview identifier binds the origin, node ID and a
   five-minute expiry. Inspection saves no connection, opens no browser and
   grants no permission. Names and node IDs are labels, not trust anchors.
3. `confirmConnection(previewId)` re-fetches metadata and checks the same node
   before saving a signed-out connection. A stale, forged or identity-changed
   preview cannot silently replace an existing credential binding. Concurrent
   confirmations for the same origin await the same durable save.
4. Explicit sign-in uses the existing OS-browser authorization code + S256 PKCE,
   issuer/state-validated loopback callback and device-key-bound DPoP exchange.
   A user-editable device name is a label; it does not create trusted identity.
   The existing server requires owner/recovery bootstrap for a first device or
   approval by an already trusted administrator for a new device. No exception
   bypasses these checks; no account password is given to the renderer.
5. Transport open is not authentication. The profile becomes `online` only
   after a valid server `ready` frame acknowledges the event session, not when
   the WebSocket opens. Failed ticket/proof checks never briefly show success.
   Readiness has a bounded timeout; existing reconnect and generation fences
   remain in effect. Online means the authenticated API/events are available,
   not that any model, execution environment or deployment has been tested.

The existing fixed BeeBot v1 routes remain authoritative. Metadata endpoints and
issuer must match that exact origin; S256, code/refresh grants, public-client
`none`, ES256 DPoP, response issuer and trusted-device capabilities are required.
The client does not navigate to arbitrary metadata URLs. An older server lacking
this secure profile must be upgraded rather than falling back to bearer tokens.
Private CA support is unchanged: do not disable certificate verification.

## Cancellation, recovery and authorization

- `cancelLogin` cancels only this client's active browser/callback wait. It does
  not revoke an earlier authorized session, withdraw a pending approval on the
  server, or stop accepted tasks. Pending requests expire on the existing server
  schedule; trusted admins can deny/block them. Explicit sign-out, block-device,
  and block-and-freeze keep their separate existing meanings.
- Closing the settings view cancels only a login started by that view. Read-only
  discovery can finish but a closed/changed view discards its result; it cannot
  start authorization or save a connection. Manager discovery is bounded.
- Token exchange observes cancellation. Callback code/error ambiguity, duplicate
  parameters, wrong state/issuer/host/path and reused callbacks are rejected.
  The callback page says authorization was received, not that connection or
  execution has already succeeded.
- Existing request IDs, task receipts, refresh rotation, scoped Bot permissions,
  quarantine, recovery and main-frame IPC validation are not replaced. Public
  previews contain no credentials; persistence still uses existing encrypted
  main-process storage. This is not hardware-bound key isolation or multi-user
  account hosting.

## Verification and remaining scope

New regressions exercise actual discovery, HTTP/SQLite authorization, key-bound
new-device approval, scoped snapshots, cancellation and event-session readiness.
The end-to-end connection fixture uses the real Node server and client manager,
with browser navigation/form entry injected over real loopback HTTP. It is not
OS browser, Keychain, public TLS or a user's server testing. Tools/task execution
use a controlled runtime; no production provider credentials are used.

The packaged Settings adapter is validated separately; outer chat and IPC are
fixtures. Full macOS checks require the pinned Node 26.5.0, locked dependencies,
Git LFS and bootstrap. Keep failed attempts and platform skips in evidence rather
than weakening tests. Native Electron/Keychain, WAN, signed packaging and actual
server operations remain separate acceptance. QR, short codes, deep links,
server deployment, multi-user identity and cross-Node group protocols are not
part of this change. Browser approval is the existing explicit check flow,
not a newly implemented push-to-browser approval channel.

References: RFC 8252 (external browser/PKCE), RFC 8414 (issuer metadata), RFC 9449
(DPoP) and RFC 9700 (OAuth security). Custom BeeBot capability fields are a
versioned profile, not additional standards.

## Packaged Settings flow

The actual `beebot-node-workbench.snippet.js` injected into the checksum-pinned
renderer now uses inspect -> explicit confirm -> existing browser sign-in.
Metadata/addresses remain inert text. Device labels, draft, focus and the current
chat survive retry and localization; changed addresses and unmounted views discard
late previews. Picker and status card include the same authorization stage.
A scoped empty Bot list does not claim the entire server has no Bots.

Offline Chromium runs cover Chinese/light 1280x900 and English/dark 390x844,
including failure recovery, pending approval, local cancel and scoped readiness.
The Browser plugin was absent. Browser navigation was blocked by environment
policy (`ERR_BLOCKED_BY_ADMINISTRATOR`); no policy was changed. Actual packaged
adapter and theme CSS were loaded into an in-memory page with controlled IPC and
an outer-shell/chat fixture. These checks are not native Electron or WAN tests.
The local full suite's preserved DMG check failed because this source snapshot
contains a Git LFS pointer. Its assertion remains unchanged. Exact locked macOS
checks with hydrated LFS and real Host/Shell tests are required before handoff.

## Connection lifecycle regression hardening

Fault-injection and real loopback HTTP/WebSocket regressions reproduced boundary
failures that were not covered by the initial happy-path suite. This follow-up:

- Keeps discovery and HTTP deadlines active even when a caller supplies its own
  cancellation signal; the deadline also bounds response-body consumption.
- Requires encrypted storage acknowledgement before opening browser authorization
  with a new device key, including a retry after an earlier storage failure.
- Fences protected requests until newly issued credentials are saved. A failed
  write retains the received credentials only for a storage retry in this process,
  rather than replaying an exchange with the predecessor refresh token. Concurrent
  callers await one write. A process exit during failed storage still requires
  normal session recovery; this does not promise crash-proof token rotation.
- Drains obsolete connection attempts before reconnecting in a new generation.
  Stale completions cannot acknowledge a new attempt or schedule its recovery.
- Rejects malformed event tickets/challenges before creating a WebSocket and
  contains signing/send errors within the connection error path.
- Lets cancellation/authorization timeout close the callback listener even if OS
  browser launch has not settled. Cancelling a pending login releases only that
  local attempt; a subsequent login still needs server authorization.

No server approval policy, DPoP verification, resource permissions, task freeze,
chat scheduling, client installation flow or renderer UI is replaced. The new
regressions supplement, rather than weaken, the original enrollment and runtime
checks. Exact-source macOS/LFS, real Host/Shell, security-freeze and native UI
acceptance remain distinct from controlled HTTP/browser fixtures.
