# Linux execution reliability

This stage keeps the local shared Linux computer and the independent Node as
separate implementations. It changes the actual Host and Electron runtimes,
without adding chat controls or another execution dashboard.

## Capability and execution identity

The concrete Box explicitly advertises desktop support. That capability feeds
main-agent prompts, tool lists, subagent configuration and executor guards.
The standalone Node offers shell/files; lack of a desktop must not be reported
as temporary monitor exhaustion. A local group member retains its own Bot ID,
workspace and display when working alone or through internal subagents.

New local desktop assignments receive `/workspace/bots/<sha256-of-Bot-ID>` as
their default working directory. Shell resolves that directory before preflight
and Auto-review, and foreground/background execution and relative Read use the
same assignment. Explicit absolute paths continue to work. `/workspace/shared`
is the conventional team handoff directory. Neither these directories nor the
owner token on a display is an OS sandbox.

Existing persisted assignments without workspace metadata retain `/workspace`,
including old Bots that shared the primary display. This avoids moving files or
changing the meaning of relative paths in already-started work. New assignment
metadata survives Host restart. Attachments and explicit historical paths are
not silently relocated. Ordinary container processes and installed system tools
remain shared between trusted Bots.

The Host reads and atomically writes its fixed assignment store directly. That
internal path may be inside the protected data directory; ordinary model Read
and file-download guards still reject the store and symbolic links into it.

## Lifecycle and credentials

Local Docker management binds to a local Unix socket and checks ownership before
lifecycle mutations. It does not follow a remote Docker context. Replacement
stages persistent state and retains the stopped previous container for recovery;
failed replacement must not delete the only copy of a user's environment.

Desktop assignments, browser profiles and selected home/config data are retained
across managed replacement. Existing shared browser login databases keep their
legacy semantics; this stage does not claim per-Bot account isolation. Required
CLI authentication is exported to dedicated minimal runtime copies, instead of
mounting the user's entire Codex and Claude directories. Runtime token refresh
must not overwrite the user's source login files.

System packages installed in the writable container layer are not guaranteed to
survive recreation. Use the supported base image or a separately reviewed,
reproducible image/setup for those packages. No arbitrary saved shell script is
automatically replayed during migration. Keeping previous containers provides a
recovery copy, not a guarantee that an interrupted operation never ran.

## Mac execution boundary

External execution retains the configured ask/always/never policies. Approval
binds the command and its absolute working directory. A missing directory is an
error, not a request to execute in the user's home. Cancellation covers both
approval checking and active execution; an already-cancelled bridge request is
not dispatched. These checks do not claim OS sandboxing or solve filesystem
symlink changes by other processes.

## Task ownership and completion

The existing same-task assignee/version/SQLite publication guard is retained.
Real peer handoffs use current group membership. Final completion additionally
checks that published results belong to the current goal and current submitted
versions. Another task's result or a stale summary cannot complete new work.
This verifies provenance, not a model's judgment of correctness. Different task
records may still overlap semantically; there is no title-based guess at deduplication.

## Validation

Focused tests exercise real source modules with temporary files, actual SQLite
publication, controlled model choices and transport fixtures. Separate opt-in
integration checks exercise actual Node/Host/Shell and disposable Linux
containers. Native renderer fixtures use real Electron components with controlled
transport. None of these is a production-model quality evaluation or permission
to replay uncertain external operations. The final handoff records exact runs,
skips, package checks and whether the installed app was updated.

### Regression evidence for this stage

- Completion: 104 focused checks, including real SQLite competing claims and
  stale/wrong-goal result rejection. Model choices and delivery transport are
  controlled fixtures.
- Mac execution: 15 checks, including cancellation during approval and a real
  daemon approval-file round trip. No user command was executed.
- Workspace, capabilities and assignment storage: 18 focused checks. A separate
  disposable Linux test verified two Bots writing the same filename, explicit
  team handoff, foreground/background execution and restored directory defaults.
  Its transport is a Docker CLI adapter, not the production exec-daemon RPC.
- Local lifecycle/authentication: 17 behavior checks plus six publication checks.
  The disposable Docker migration fixture passed all five checks using real
  stopped-container copies, readback manifests and the actual bootstrap. It
  covered cookies/WAL, legacy login links, private assignment ownership, writes
  as the `box` user, restart, a second migration and readiness-failure rollback.
  Its final process was controlled, so this is separate from full Host startup.
- Native conversation UI: 90 checks across eight Electron cases (single/Group,
  Chinese/English, light/dark, narrow window). Second and third sends, focus and
  draft preservation use real recovered components and controlled transport.
  This does not replace an installed-app or model smoke test.
- The first unbounded all-test run was aborted under concurrent build load.
  The subsequent two-worker run passed 1,400 tests, skipped 16 opt-in cases and
  exposed one stale publication assertion for Docker schema 8; the assertion
  was updated to the actual schema 9, retaining its exact-version check.
- The first Node integration run had six startup/HTTP timeouts under that load.
  All six passed an isolated retry with the original timeouts and assertions.
  The subsequent complete integration run passed all 14 cases with no skips.
  The final base-prompt wording correction additionally passed three actual
  assembly checks and the real four-round HTTP inference fixture (one case).
  That HTTP case failed against the old artifact and passed after rebuilding;
  it asserts against every complete prompt and tool catalog received by the
  controlled inference endpoint.

The final source validation used the pinned Node 26.5.0: `npm run typecheck`,
`npm run source:typecheck`, then
`node --test --test-concurrency=2 tests/*.test.mjs`. All 1,409 enabled tests
passed; 16 opt-in checks were skipped, with no failures or cancellations. The
concurrency limit avoids local resource contention; test assertions and timeouts
remain unchanged. The independent integrations above were run explicitly.

The actual-image entrypoint smoke passed five checks: upstream supervisor and
the packaged Host become ready, a fresh Host has no implicit Bot, restart
restores a seeded Bot's fork and owner token, and both primary/fork execution
perform real Shell and Read RPCs. It uses an offline disposable container,
synthetic Bot and new volumes, with no model messages or real credentials. All
resources were removed. The first manually constructed probe omitted the
required `parsingResult` field and returned `spawnError`; the final probe uses
the production `buildHostShellArgs` helper. A separate reproduction confirmed
the exact missing-field error. This local production path uses the image's
existing exec-daemon; the mounted reconstructed daemon is not claimed active.

The macOS package passed the normal signing, identity and checksum-pinned
renderer checks, followed by `npm run verify` (14 executable source runtimes,
1,015 evidence markers) and the publication-tree check. A first package attempt
failed because a reused source-directory symlink allowed staging to modify its
target. The final build uses an independent extraction from the checksum-verified
archive; the affected reference files were backed up and restored, and all 680
original files were verified byte-for-byte. No package guard was relaxed.
Installed-app verification and deployment state are reported separately in the
handoff; passing a disposable fixture does not by itself update a user's app.
