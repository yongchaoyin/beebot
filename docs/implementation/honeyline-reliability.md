# Honeyline reliability increment

This increment follows the `a8bd470` Honeyline theme audit. It preserves the
checksum-pinned compatibility runtime, receipt ledger, remote controller and
normal build/publication checks. It does not replace the runtime with the editable
frontend or claim that a delivery receipt proves task execution/completion.

## Send invariants and ownership

`workspace/submission.ts` has one FIFO lane per agent/conversation, independent
lanes for other conversations, and stable nonce receipts for the lifetime of its
owning account session. A duplicate nonce with the same semantic payload shares
the original promise; a different payload is rejected without overwriting it.
Timestamps are not semantic payload and cannot reorder queued messages.

Only a provably pre-dispatch failure or an authoritative rejected receipt releases
a failed lane. Other failures become `uncertain`, hold that lane, and never replay
the request. Queued messages can be cancelled while the uncertain request itself
cannot be deleted/retried through the failure controls. A positive authoritative
echo may settle an in-flight request before its RPC reply; a late failure cannot
change that receipt. Reset invalidates old callbacks and queued work on an account
switch. Observer errors do not own transport progress.

`ProductionRenderer` stages attachments before dispatch, fences account changes,
uses the existing read-only `promptAcceptanceStatus` RPC, and projects uncertainty
into the acknowledgement store and transcript. Receipt lookup validates the host
protocol slot, conversation and nonce. Missing/pending/evicted/malformed records
remain unknown; a five-second lookup limit is not a rejection. Inline **Check
receipt** performs no send. No automatic replays or implicit stop operations have
been introduced. A missing durable record still requires external verification;
this increment intentionally does not offer an unsafe "assume failed" override.

## Stable UI and truthful work state

The ordinary message action anchor remains mounted across pending, queued,
failed, uncertain and sent states. Hooks are unconditional; loss of action
eligibility closes menus without moving focus into the composer. Uncertain
messages have their own inline receipt control and no Resend button. Offline
composition timestamps cannot label a queued/unconfirmed message as already sent.

Legacy queued/failed/unread feedback uses the Honeyline semantic palette, including
its actual buttons and inherited status text. Both themes keep their existing
palette. Status projection distinguishes waiting for a human, another agent,
resources or review; offline/unknown results outrank stale work flags. Free-text
`waitingReason` is descriptive, not authority to assign work to the user. Typed
waiting ownership outranks legacy cached flags.

## Renderer boundaries

- Editable `ProductionRenderer`: the source queue and receipt reconciliation are
  wired here and typechecked; this is not the preserved upstream send journal.
- Packaged remote chat: `buildNodeChat` bundles the same transcript and header
  components. The remote transport keeps its own existing command-idempotency,
  acknowledgement gating and interruption-reconciliation rules.
- Packaged local compatibility renderer: the Honeyline CSS and shared work-status
  adapter are built into it through the existing hash-checked patcher. Its own
  send journal was not silently replaced. Native runtime/publishing regression
  must be run on macOS, not inferred from a source-only Linux build.

## Repeatable verification

Run `npm run typecheck`, `npm run source:typecheck` and `npm test` in a bootstrapped
checkout. Added tests cover FIFO after rejection, concurrent conversation lanes,
nonce conflicts, account-reset fencing, authoritative echo races, unknown receipt
parsing/timeouts, explicit waiting ownership and actual React message lifecycles.
The React test bundles the real transcript in development mode, checks retained
DOM/focus, closes an open menu on eligibility changes and verifies that unknown
receipt feedback never exposes retry actions. happy-dom's missing optional console
profiling hook is shimmed; React errors themselves are captured and must be empty.

Browser QA uses the actual built React transcript/status and CSS with clearly
labelled test data, not an installed native application or a live model. Tests
cover 1440/960/390 widths, both themes, normal text contrast, retained DOM/draft,
read-only receipt errors and console health. Native windows, microphone, computer
control, system permissions and signed distribution still require interactive
macOS verification; passing CI alone does not replace it.
