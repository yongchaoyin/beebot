# App-assisted server installation: verified release planning

Continuation of PR #10, exact baseline `5815b8abc993a328440dfb4a6b324b906fb2a6a9`.
This stage prepares a **read-only, expiring installation preview**, not a server
installation or an execution grant. It deliberately leaves the concurrently
reviewed Node authentication, task-security, installer and Servers workbench
implementations untouched. Product branches/develop are not overwritten.

## Release provenance

A Node image digest fixes content identity; it does not establish who approved
it. `release-manifest.ts` verifies an Ed25519 signature over the exact UTF-8
payload, prefixed with `BeeBot Node release manifest v1\n`, before interpreting
it. Uses Node's standard `crypto.verify(null, ...)`, not custom cryptography.
The envelope has exactly `keyId`, canonical base64 `payload`, and `signature`.
The payload has a strict format-1 stable-channel contract, version, monotonic
sequence, bounded validity, per-architecture Node digest references, proxy digest,
minimum disk requirement and the required trusted-device/DPoP security profile.
Repository names and signer keys come from client-packaged release policy, not
from renderer input, the server, environment variables or the signed envelope.

Both Node and proxy references must be immutable approved-repository digests.
Unknown signer/repository, byte tampering, wrong key type, incompatible fields,
expired manifests and sequences below the client policy minimum are rejected.
No raw parsing errors, private keys or remote diagnostics reach the UI. The
security-profile claim is publisher metadata, NOT a runtime feature probe.
Signatures/digests do not prove that an image is vulnerability-free or available.

`release-catalog.ts` is intentionally empty: the repository has no published
release or approved signing identity. Do NOT fill it with a generated test key,
fabricated digest, mutable `latest` tag or an unsigned fallback. Release operators
must review public keys, approved repositories, policy sequence and signed
manifests as part of a client release. Keys belong to the release process; this
change does not create/store/export any production signing key. A subsequent
online catalog requires revocation, authenticated distribution and persisted
rollback state; this offline packaged policy is not presented as that service.

## Plan boundaries

Only a successful, user-confirmed SSH probe retained by the main-process manager
can produce a plan. Renderer-supplied reports, image names, paths, commands,
credentials, keys or script URLs cannot become plan input. Options are limited
to a DNS hostname and human-readable Node name for the existing HTTPS installation
path. The instance/path are fixed; no arbitrary filesystem target is accepted.
Plans include target, host fingerprint, observation time, domain/name, platform,
selected release identity, resources to create, things not to modify, outstanding
checks and a deterministic specification digest. IDs distinguish each viewing;
the digest identifies identical specifications. Neither is an authorization token.

Inspection expiry (five minutes), clock rollback, cancellation, changing SSH keys
or scanning a new target invalidate the observation. A plan cannot outlive its
release. Existing directories, symlinks, locks, missing dependencies, insufficient
space and absent platform-specific releases remain explicit blockers.

No network request, DNS lookup, filesystem mutation, image pull, sudo or installer
execution is performed by previewing. No server password or model key is collected.
The response ALWAYS has `status: review_only`, `canInstall: false`, `installed:
false`, `executionProbe: not_run`, and an `execution_not_enabled` blocker. There
is no apply endpoint/confirmation that pretends to start work. The existing
installer still uses its own proxy image; it must be reconciled to the selected
release before an apply path can be enabled. Closing this view does not stop
any existing Node/Bot work.

## Validation and next gate

`node --test tests/server-install-plan.test.mjs tests/server-preflight*.test.mjs`
uses real Ed25519 generation/signature checks with ephemeral in-memory test keys,
production TypeScript modules, filesystem and bounded child-process tests. SSH
probe output and release offers in planner tests are explicit fixtures, not a
published image or a real installation. No signing key is checked in.

Next: converge on the accepted security baseline, publish and approve immutable
Node/proxy artifacts, implement durable single-use installation operations and
read-only uncertain-result reconciliation, then device enrollment/model setup
using the existing security APIs. Do not expose writes before those gates, claim
SSH/domain/firewall readiness from a preview, or replace uncertain work by retry.

## Shipped Settings integration

The existing preflight channel now accepts only an additional `previewInstall`
read action; its options contain domain and name only. The manager, not renderer
input, supplies the successful observation. Existing trusted-window/main-frame
checks and window-local session IDs also protect plan reads. `install`, `apply`,
`sudo`, arbitrary commands and legacy pairing remain unsupported.

In Settings -> Servers, complete the existing identity check, then optionally
expand "Next: preview installation". No new chat dialog, automatic request,
credential form or second Servers dashboard. Plans show the verified host,
proposed origin/resources, unavailable release and execution blockers honestly.
Missing release is an explicit absent value, never a fabricated package. Changing
the SSH target clears the observation; changing installation options clears only
the plan. Closing Settings, changing target/options, a newer preview or expiration
fences late results. Language changes preserve exact input nodes, IME state and
keyboard focus. Errors leave input intact; no automatic retry, service readiness
claim or executable "confirm" control is displayed.
