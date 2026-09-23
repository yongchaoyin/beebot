# Application-driven server onboarding: read-only preflight

Baseline: develop `183fd0bb11a78562177d8ee1197c72e5ba17a161`.
Parallel change reviewed: PR #8, Node device security `5a3dfa1b`.
This stage deliberately avoids every file modified by that PR, as well as
`deploy/install-node.sh`. It does not import the unverified SSH pairing candidate.

## Delivered boundary

A separate desktop provisioning channel performs **read-only preflight**, not
installation, service readiness, account setup, device authorization or a model
execution test. Existing Node APIs and authentication remain authoritative.
No install/apply/upgrade/reset operation is exposed. A green prerequisite check
must not be presented as a running BeeBot server.

The caller chooses a literal host, port and user. The application collects the
server's ED25519 public host key without authentication, shows its SHA256
fingerprint, and requires explicit verification against a trusted external
source (for example the server administrator's console) before authenticating.
Keyscan is discovery, not proof of server identity. The fingerprint is pinned
for the subsequent SSH connection; a changed key cannot be accepted silently.

Only direct SSH, ED25519 server host keys, an already loaded local SSH agent or
a private key selected by the native file picker are supported. No password
collection, ssh-config aliases, bastions, proxies, agent forwarding, control
socket reuse or arbitrary remote commands. Encrypted keys should be loaded
into the user's agent; this component never asks for a passphrase. It does not
modify the user's known_hosts. Confirmations are single-use, in-memory, target-
and window-bound, expire after five minutes, and do not survive application exit.
Temporary pin files are private and removed after the check, including failure.

The constant POSIX probe reports OS/architecture, Bash, local Linux Docker
access, Compose, writable home and disk availability, and presence of the
**default** `$HOME/.local/share/beebot/server` installation or lock. It does not
scan the whole filesystem or verify an existing Node's ownership. Any existing
managed/foreign directory requires separate inspection, not replacement. Less
than 2 GiB of available disk is a conservative warning gate, not a guarantee
that more space is sufficient for an image or workload. Custom installation
paths, memory, DNS, TLS reachability and image availability remain untested.
A remote Docker context is reported without connecting to that remote daemon.

The main process selects fixed system SSH binaries, spawns without a shell,
limits time/output, disables prompts, strips application environment secrets,
and never returns raw process stderr or key bytes to the renderer. Selected key
paths remain in main-process memory. Only the main trusted BeeBot frame may use
this channel; navigation, closing Settings or quitting invalidates its session.
Cancelling this read-only probe never cancels existing Bot/server work. The SSH
server may still record normal login/audit events and run its own session hooks;
'no changes' means this probe does not intentionally mutate the installation.

## Why this is staged

The concurrent security PR changes pairing and connection management. Completing
an automatic installer against the superseded auth path would create a parallel,
incompatible workflow. First ship independently testable preflight; connect the
installer, verified release artifacts and pairing only against the agreed latest
security baseline. Do not install arbitrary images, downgrade auth, invent a
release download or mark local initialization complete to bypass remote startup.

## Validation

`node --test tests/server-preflight*.test.mjs` executes actual production modules,
real bounded local child processes, and the unchanged POSIX probe with temporary
home directories. Docker responses in branch tests are explicit shell functions,
not a real Docker installation. SSH-manager unit tests substitute process output
and assert host pinning, scope, expiry, cleanup and error redaction. Real SSH and
native Electron acceptance must be reported separately. No production server,
owner account, model credential or paid model call is used by these tests.

## Actual Settings integration

The packaged renderer loads the independent
`beebot-server-preflight.snippet.js` extension after the existing Servers
workbench. It mounts a collapsed check flow inside Settings -> Servers, with
host, user, port, an optional native key picker, explicit out-of-band fingerprint
confirmation, bounded read-only inspection, and localized blockers. It never
adds a chat modal or mutates server authorization, connection identity, model
configuration, onboarding flags, Bot work or drafts. Existing Node UI remains
in its original file. Missing native bridge hides only this optional extension.

The dedicated `beebot:server-preflight` main-process channel checks the existing
trusted-window/main-frame boundary. A random window-local session owns its
manager; Settings disposal, navigation, cancellation and quit invalidate pending
reads. Native picker results expose only the basename, not the private path.
Late picker/read/open responses cannot migrate into another view. All error
responses use stable codes, not remote stderr or filesystem paths. This is an
application management capability, not a tool exposed to Bot models.

The readable preload and actual production-main activation both wire this
channel; no change to `beebot:nodes`, its token store or login protocol is required.
Happy DOM tests execute the original Servers component plus the extension;
Chromium verifies the same two components in a controlled in-memory shell and
IPC fixture. These are not full Electron, OS file-picker or real keychain tests.

Explicit real-SSH regression, on a disposable Linux worker with OpenSSH installed:

```sh
node --test tests/server-preflight-ssh.integration.mjs
```

It generates its own ephemeral keys and loopback-only SSH daemon, exercising
fingerprint verification, real public-key authentication, the unchanged probe,
wrong-key refusal and host-key replacement. Its daemon allows a temporary
AuthorizedKeysFile via fixture-only `StrictModes=no`; the client retains strict
host-key checking. Missing OpenSSH causes failure, not a passing skip. It neither
uses a production server nor modifies the worker's SSH config/known_hosts.

## Next integration gate

Re-read develop and PR #8 before integration; verify the current security branch
can merge without conflicts and run both security and preflight regressions on
that temporary merge tree. This does not promise conflict freedom for future
unpublished changes. Actual installation, trusted release/image distribution,
dependency setup, owner enrollment, model setup, SSH API tunnels and remote
Group parity remain follow-on work; the UI deliberately claims only inspection.
