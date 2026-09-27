# Local Linux computer lifecycle

The desktop's local Docker mode is one shared Linux computer. Local Bots keep
separate identities and, where available, desktop seats; this does not create
per-Bot OS users, credential isolation or security sandboxes.

## Selecting the engine and owning the instance

Every lifecycle operation resolves one local Unix socket and retains that endpoint
for all its Docker commands. An explicit local `DOCKER_HOST=unix:///...` takes
precedence, supporting a chosen local engine. An explicit SSH/TCP host is refused.
Without an explicit host, the Docker Desktop socket and `/var/run/docker.sock`
are checked as real Unix sockets. Missing sockets fail closed. Saved Docker
contexts and inherited context/TLS overrides cannot redirect these commands.

Lifecycle mutations are serialized in the desktop process. Inspection failures
are not interpreted as an absent container. Stop, start, restart and rename
recheck the immutable container ID, BeeBot ownership label and expected image.
Initial provisioning pulls the existing supported image only when it is absent,
then validates its entrypoint before stopping an existing computer. Cached images
are not force-pulled. The image still uses the existing upstream tag; this change
does not claim a digest-pinned or fully reproducible base operating system.

## Replacement and persistence

Schema 9 adds a persistent home-state volume for:

- `/home/box/chrome-profile`, including browser profiles, WAL files and existing
  login links;
- `/home/box/cli-config`;
- `/home/box/.config`.

The existing workspace and sand-data volumes remain unchanged. Desktop assignment
IDs/tokens migrate from the legacy home file to
`/home/box/sand-data/local-linux-state/window-assignments.json`, using the Host's
explicit `BEEBOT_DESKTOP_ASSIGNMENTS_PATH` setting.

Before a schema/runtime replacement, the old owned container stops. The desktop
copies these selected paths into a private recovery directory beside its settings,
records file hashes and symlinks, and checks assignment JSON. Copy errors or
corrupt assignments stop the replacement and restore the old running state.
The old container is renamed and retained; it is never deleted as a prerequisite
for starting the replacement. A separate home-state volume is populated while the
replacement is stopped, then copied back and compared with the recorded manifest.
The checked-in bootstrap prepares only those fixed home paths and permissions,
installs the saved assignment once as `box:box` with mode `0600` inside its
`0700` private directory, and executes the validated upstream entrypoint. The
staged assignment is then removed, so restarting cannot overwrite newer Host
assignments with the original imported copy.
It clears only Chromium's stale SingletonLock/SingletonSocket/SingletonCookie
symlinks after the stopped snapshot has been verified, preserving browser databases
and intentional login links. It does not execute arbitrary saved shell configuration
during boot.

A normal creation/readiness failure retains the failed replacement and restores
the previous container's name and running state. Shared workspace/sand-data volumes
are not rolled back; a rollback does not undo task effects or imply interrupted
work can be repeated. A process or machine crash may leave
`local-docker-replacement.json`. Startup refuses a second replacement until that
recovery record and its named containers have been inspected and explicitly
recovered. Do not delete the recovery record just to bypass the refusal.

Old stopped containers, their home-state volumes and private recovery snapshots
remain available after a successful replacement. They contain private browser
state and must not be committed, uploaded or logged. Their cleanup is an explicit
maintenance operation after the new computer and backups have been verified.
Normal stop/start preserves the same container; replacement preserves only the
selected persistent paths. Packages installed elsewhere in the container's root
filesystem remain available only in the retained previous container for recovery;
using them in the replacement requires a reproducible image/provisioning definition. This change does not claim to preserve every package or home file.

## Login export and browser limits

The entire Mac `~/.codex` and `~/.claude` directories are no longer mounted.
The local runtime receives private export directories containing only Codex
`auth.json`, its model/reasoning selections, and Claude `.credentials.json`.
These are writable runtime copies for credential refresh; the Mac source files
are never modified. Unchanged source credentials do not overwrite refreshed
runtime copies; changed or removed source login files update or clear the export.
No histories, project configuration, skills, plugins or Mac CLI binaries are copied.
Claude still needs a compatible CLI inside Linux. This preserves the existing
file-based login routes, not unsupported macOS Keychain-only exports.

Provider credentials and the model catalog remain shared by this local runtime;
the export is narrower, not a per-Bot permission boundary. Login copies can belong
to the same provider token family, so independent concurrent credential rotation
is not a guarantee of independent accounts.

Existing browser behavior is deliberately retained: upstream `box-chrome` gives
forks their own profile/LevelDB and `link-chrome-session` links Cookies and Login
Data to the common Default profile. Migrating the files does not make those logins
private to a Bot. Isolating future browser profiles requires a separately tested
launcher and desktop-owner lifecycle change; it is not silently imposed here.

## Verification

`tests/local-docker-reliability.test.mjs` executes the production helpers with real
temporary files and a controlled Docker command boundary. It covers endpoint
selection, ownership, failed copies, assignment corruption, manifest readback,
readiness rollback, interrupted journals, subsequent migration, minimal auth
export, refresh preservation and source-login removal.

The opt-in `scripts/verify-local-linux-migration.mjs` uses the cached supported
image, randomized `beebot-migration-*` resources, synthetic files, no network,
no published ports and no production mounts or credentials. It exercises actual
Docker copies into a stopped mounted volume, the real bootstrap, persistent
symlinks/permissions, restart, second migration and readiness-failure rollback.
The terminal only prints check counts and the report path, never file contents.
It does not start a model or production Host and does not establish task-quality
or production-account behavior.

```sh
BEEBOT_DOCKER_MIGRATION_TEST=1 node scripts/verify-local-linux-migration.mjs
```
