# Honeyline reliability increment — 2026-09-22

Base: `a8bd4703edf0e75196d308b31b5b3c4ea9e34d74` (PR #2).

## Scope

This increment keeps the owned Honeyline design and existing collaboration
runtime. It does not replace the checksum-pinned upstream renderer wholesale.

- **Editable renderer**: receipt queue, ProductionRenderer call-site wiring,
  stable transcript frames and inline delivery recovery.
- **Shared native/editable layer**: semantic exception colors and neutral
  waiting-state projection, through the existing Honeyline build adapters.
- No protocol changes, automatic external replay, new dependency, relaxed hash,
  archive, CSP, signing or publication check.

## Behavioral contract

A Bot or Group has one FIFO receipt queue. New sends and reconnect flushes use
one scheduler. A typed pre-dispatch rejection permits later messages to proceed;
a generic exception is an **unknown receipt**, not proof the host did nothing.
Unknown receipts pause that conversation until a verified read-only receipt resolves it, or the user reviews and explicitly
dismisses the receipt. Continuing never replays the uncertain message and never
cancels host work. Other conversations remain independent.

Same nonce/content reuses the original promise; conflicting content is rejected
without replacing it. Routing, rich text, quote/fork fields and attachment identity
participate in that check. Payloads/snapshots are copied. The bounded 256-receipt
cache is renderer memory, not durable server deduplication or an exactly-once
external-operation guarantee.

The editor remains usable while work is running. The queue owns a copied payload
at handoff; only that draft is cleared, synchronously, not by an old network
completion. Uncertain messages are not silently restored into the composer.
Attachment preparation gates submission for that conversation, not editing.
Queued cancellation restores the original rich text and quote; a stale Cancel
click must not hide a send that has already started.

Account observation resets queue epochs before late results can mutate the new
account. Attachment commit checks its account epoch again before sending the RPC.
Resetting client receipts does not cancel work already accepted by the host.

Message frames remain mounted across delivery changes and read-only transitions.
Unknown receipt actions are inline, explicit and bilingual; there is no blind
Resend. Actual user-input requests may demand attention; a free-text wait reason
alone only yields a neutral Waiting state.

## Reproducible source checks

Use the pinned Node 26.5.0 and lockfile, then:

```sh
node --test tests/honeyline-reliability.test.mjs tests/honeyline-transcript.test.mjs tests/honeyline-integration-contract.test.mjs tests/honeyline-theme.test.mjs tests/composer-submission-gate.test.mjs
node --test tests/chat-continuity.test.mjs tests/conversation-deliveries.test.mjs tests/quoted-collaboration*.test.mjs
npm run typecheck
npm run source:typecheck
npm run frontend:build
```

The targeted set passed 49 tests locally; the existing collaboration subset
passed 30. The integration-contract cases are explicitly static call-site guards,
not a claim to have mounted the entire ProductionRenderer. The real React
transcript tests use trusted code in happy-dom, not a security sandbox. The
fixture helper also bundles the actual composer/queue for browser validation.

Chromium/Playwright offline component QA passed 71 checks (single Bot and Group,
continuous sends, uncertainty review, known rejection, IME, theme/focus, stable
message geometry, light/dark and 390/1000px windows). Twelve rendered text states
met 4.5:1 contrast. No page errors. Browser plugin was unavailable and localhost
navigation was blocked by the environment, so the actual component bundle was
loaded in memory. This is not full-app navigation or real transport validation.
QA screenshots/logs remain outside the repository. Existing Vite mixed-import
warnings and the fixture's unexercised PDF import.meta warning are not hidden.

## Native validation and release gate

Full checks must run on macOS after `npm ci`, `npm run bootstrap` and
`npm run icon:generate`. Then `npm run check`, `npm run frontend:build` and
`npm run publication:check` verify the real modified tree and pinned packaging
inputs. CI results and exact final commit are recorded in the PR, not guessed
here. Component checks do not establish shipped send-journal behavior.

Still requires interactive Mac validation: native window/IPC, real Bot and Group
transport, permissions, audio, computer stream, installation, signing and update.
No signed release or main-branch merge is part of this increment.

## Reconciled concurrent increment

The concurrent `a11209c` draft handoff, live-client dispatch ref, per-conversation
attachment gates, queued-cancel restoration, bilingual inline recovery and bounded
receipt cache are retained. Unknown receipt compatibility remains `phase: failed`
with `failureKind: unknown`; it is never treated as a proven rejection or exposed
to blind Resend. The acknowledgement store distinguishes it as `uncertain`.

Read-only `promptAcceptanceStatus` validates host slot, conversation and nonce.
A five-second lookup bound, missing/pending/evicted/malformed results and a failed
lookup all remain unknown. A verified acceptance can settle before the original
RPC returns; late failures cannot reverse it. A verified rejection enables review
or deliberate resend, without replaying automatically. The user's existing inline
queue-review/dismiss action is preserved: it releases later messages without
claiming this message was rejected and without re-executing it.

Work-state projection now also distinguishes typed wait owners, review, resource
queues and lost connection. Source/packaged adapters share that projection.
Unspecified free-text waits remain neutral. Actual React tests preserve frames,
menus, input focus and draft; both branches' tests are retained. Browser checks
include computed feedback spacing above upstream specificity, both palettes,
three window widths and readonly lookup errors. Updated final counts are recorded
in PR #3 and the evidence bundle, not inferred from either pre-merge suite.
