# Model binding and BeeBot installation branding

Baseline: `develop` at `6789c7ee736e612dca11f3a91f7830260eb1313b`.
This change is limited to desktop/local Host model configuration, the existing
Bot settings selector, visible product branding and macOS packaging. It does not
merge the pending SSH candidate, change Node authentication, or reroute remote
Bots through the local model settings.

## Report and diagnosis

The reported banner says the Bot's model API is missing even when the desktop
catalog contains an API. That banner is thrown before the model request: the
Bot's stored `inferenceVendorId` cannot be found in the runtime's catalog. It is
not evidence that the model provider rejected the API key.

The local Docker connector used two writable single-file binds for settings and
secrets. Replacing an individual host file atomically can leave the container
reading the previous inode. The baseline attempted in-place synchronous writes
to work around this, while asynchronous secret writes still used replacement.
In-place writes also allow incomplete JSON reads; independently writing the
same desktop settings from the Host introduces additional authority ambiguity.
Reconnect synchronization did not include the full inference account catalog.
The first-run/router path could rotate the generic provider key without rotating
an already existing named account's key. Finally, the Bot settings selector
silently displayed the first option for a missing stored account and did not
await/report a failed binding save.

These are reproducible source/runtime-contract defects, not a claim that the
user's local data or installed app version has been remotely inspected.

## One local configuration publisher

The Electron main process publishes `local-docker-inference/current.json` beside
its settings file. A private staging file is renamed over `current.json`.
Docker mounts the DIRECTORY read-only at `/run/beebot-inference`, not the single
JSON file. `BEEBOT_LOCAL_INFERENCE_SNAPSHOT` explicitly selects this source.
The payload contains the account catalog, selected default, HTTP metadata and
ONLY keys referenced by that catalog. No Node login data, SSH keys, device keys
or complete desktop data directories are mounted. This remains a local
single-owner runtime: a model key available to its Host is not hardware-isolated
from arbitrary tools running under that Host's account.

The Host reads the current snapshot for model resolution and key lookup. An
explicit but missing/corrupt snapshot fails closed rather than reverting to old
container settings. Changes to endpoint, provider, model or secret association
between selection and session creation are rejected rather than silently routing
to another account. A running turn keeps its existing initialized session;
subsequent turns observe the new configuration. This is not a transaction across
all desktop settings files, nor a promise of power-loss durability for every
filesystem; publication itself exposes one complete version to the container.

The local container schema moves from 7 to 8. Reconnect may recreate the owned
runtime container to install the new mount contract; existing named data and
workspace volumes are preserved. Finish active work before explicitly
reconnecting/upgrading. This does not authorize resetting Bot profiles or
replaying uncertain external actions.

All save/delete/first-run and reconnect paths synchronize catalog and default,
including an explicit empty list. Updating a nondefault API does not change the
default. Existing named API key rotation updates that account's key. A new
endpoint cannot borrow an unrelated provider key when its key field is blank.
Named accounts never fall back to a generic provider credential. Recovering a
valid settings backup is retained; guessing unknown models or endpoints from
leftover secret names is removed. Explicit deletion is persisted to the backup
as well, and an unreadable settings file is not reported as a successful save.

## Existing Bot repair UI

The existing Bot settings pane owns the binding via a stable agent ID marker.
A missing stored ID is shown as missing, not as the first configured API.
Selecting an existing API saves against that pane's Bot and awaits success.
Failure retains the original selection and displays an inline error. It does
not recreate the Bot, erase the description, change its role, reset the avatar,
or restart previous tasks. Group/remote-room settings are not offered a local
model override. Late catalog responses cannot attach to a different pane.

## Visible product branding vs compatibility/provenance

The packaged renderer is still reconstructed from the pinned upstream baseline.
A build-time AST pass replaces product-copy string literals and template text,
including onboarding, loading, permissions, settings and lazy panels. It does
NOT rewrite user messages at runtime, replace protocol identifiers, or remove
copyright/license notices. Every modified asset's source/output hash is recorded
and the package verifier reproduces the complete transformation from the
unchanged original. The readable frontend receives matching copy changes.
Existing neutral app icon and Presence avatars are retained. The empty composer
microphone is not hidden by the theme's send-button CSS.

The staged `BeeBot.app` now uses matching main and four helper bundle/executable
names. Usage descriptions are branded; helper identifiers are moved under the
existing BeeBot bundle identifier. All renames happen before ad-hoc signing.
Original signed reference verification, signature-excluded Mach-O invariants,
native runtime inventory and ASAR/renderer reconstruction checks stay enabled.
The neutral icon takes precedence over the inherited asset catalog entry.

Native About/Hide/Quit menu labels are explicitly branded as BeeBot in English
and Chinese rather than letting Electron derive them from its retained internal
credential namespace.

Internal `sand`, persisted container/data-volume names and legacy Electron
package identity are deliberately retained to avoid silently moving userData or
invalidating existing safeStorage credentials. They are not advertised product
names. Changing these requires an explicit data/keychain migration, separate
from this branding fix. The official model name `Grok`, provider endpoints and
third-party attribution are not renamed to pretend BeeBot owns those products.
No upstream vendor auto-update channel is enabled by this change.

## Build and install the corrected app

Use the fix branch/PR, not the unchanged main branch. Source changes do not
modify an already installed app. On the supported macOS build environment:

```sh
npm ci
npm run bootstrap
npm run package
node scripts/package-dmg.mjs
```

The first command set produces `dist/BeeBot.app`; the last creates
`dist/BeeBot.dmg` with volume name BeeBot and only BeeBot.app plus an Applications
link. It does not reuse the original installer's background or Finder metadata.
The files under `research-archives/original/` are upstream research/reference
artifacts, NOT BeeBot installers. Do not install those when testing this fix.
These commands create a local ad-hoc build, not a signed/notarized public release.
No user's existing Applications directory or data is changed by these scripts.

Close the old app before replacing it with the new BeeBot build. Do not delete
settings, keys, Bot data or workspaces. Reconnect the local computer/runtime to
adopt schema 8. When an API truly was deleted/recreated with a different ID, open
that Bot's settings and select its existing intended API once. Do not repeatedly
re-enter keys or create a new Bot merely because the old binding is unavailable.
A remote Bot uses the selected server's configuration, not the Mac's local list.

## Reproducible verification

```sh
node --test tests/model-binding.test.mjs tests/model-binding-ui.test.mjs \
  tests/sand-settings-store.test.mjs tests/resolve-inference.test.mjs \
  tests/product-branding.test.mjs
npm run check
npm run frontend:build
npm run package
node scripts/package-dmg.mjs
```

Linux Docker validation (disposable owned container, isolated network, local
immutable image ID; no external model keys):

```sh
BEEBOT_MODEL_DOCKER_TEST=1 BEEBOT_TEST_NODE_IMAGE=sha256:<local-image-id> \
  node scripts/verify-model-config-docker.mjs
```

Model tests exercise real settings/key filesystem IO, production main handlers,
Host resolution and reconnect composition with a controlled IPC receiver. UI
cases evaluate the actual packaged selector with controlled save/read callbacks.
Brand tests run the real pinned-renderer transformation and exact bundle renamer.
Docker tests demonstrate stale single-file mounts and fresh read-only directory
snapshots in a real running container. None is a paid-provider or user-machine
end-to-end test. Browser evidence uses controlled sample data, never real keys.
Final CI results and exact commit identity are recorded on the PR rather than
hard-coding a claim of success before the runs finish.

Remaining manual acceptance: existing installed Mac profile/Keychain upgrade,
Finder/Dock cache and Gatekeeper prompts, hardware mic/permissions, real models,
and uninterrupted use of the user's own Docker Desktop environment.
