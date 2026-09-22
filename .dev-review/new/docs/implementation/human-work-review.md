# Human review inside colleague conversations

## Integration baseline and scope

Base: `c157b10` on `feat/message-work-contracts-20260922`, retaining the existing
`collaboration-work` schema, task-scoped questions, atomic SQLite responsibility
records, result fingerprints, targeted handoffs and same-chat quotations. A
separate work-contract prototype was NOT layered on top of this implementation.
There is one task ledger, one review protocol and one actual publication path.

This stage closes a practical gap: a solo Bot, or a group's self-assigned final
integration task, can submit work for its user without inventing a peer reviewer
or remaining indefinitely submitted. Tasks with a designated Bot reviewer retain
that reviewer; human review does not silently override peer responsibility.

## Actual workflow

The submitted message exposes a collapsed, inline review entry. A user-initiated
read obtains the current requirements, submission and bounded evidence previews
from the existing database. Stale, modified or non-quotable evidence is not exposed
through the preview. Files still open through their original attachment messages.
All requirements must be explicitly checked for acceptance; a changes request
needs a concrete note. Neither checkboxes nor a saved review prove automated test
success. No model can set the trusted human-review flag or impersonate `$user`.

`getWorkReview` and `submitWorkReview` use the authenticated local Host RPC. The
Host verifies conversation scope, membership, designated review authority, task
version, submission ID and every submitted result fingerprint. A process context
and explicit Stop epoch fence stale controls. State, quoted user message and the
idempotent command receipt commit in the existing transaction. A repeated command
cannot publish another review or run another turn. The review is a real user
message, not a forged Bot reply or a fabricated second user prompt.

After commit, the existing delivery and per-Bot queues continue the relevant
worker/requester and newly-ready dependents. Other members are not woken. Review
acceptance is distinct from permission for external actions. Existing uncertain
execution prevents automatic follow-up; failure to confirm notification leaves
the review saved and explicitly asks for inspection rather than replaying work.
The follow-up delivery store is separate from the task/message transaction: this
is not a transactional outbox or exactly-once guarantee for external effects.

## UI and implementation paths

The actual pinned renderer includes `beebot-work-review.snippet.js`, bound and
disposed alongside conversation status. The real RPC table and roster bridge,
shared coordinator contracts, editable runtime source and Host endpoints are
updated together. A packaging regression transforms the pinned renderer, verifies
both bridges and parses the resulting JavaScript; editing frontend-only code is
not presented as an installed UI change.

Chat stays non-modal. Notes, selected criteria and evidence retain their nodes
through locale changes and virtualized remounts. Late reads and submits cannot
alter another chat; remote Node selection removes the local review controls. A
lost receipt disables submission until an explicit state read; retrying an
unchanged confirmed-pending operation retains its original operation ID. Newer
submissions and work revisions invalidate older controls. None of these actions
changes the ordinary chat draft or its selected quote.

## Verification boundaries

New tests exercise the production SandAgentDb and review service, authenticated
request parsing, user identity, compare-and-swap, criterion coverage, evidence
changes, duplicates, Stop fencing, uncertain work, dependent wakeups and failed
follow-up handling. Real group routing and private send dispatch are exercised;
model/OS execution is controlled. UI tests run the actual packaged adapter with
controlled stores and RPC, including the compiled renderer composition.

Pinned Node 26.5.0 and locked dependencies are used locally. The full local suite
has the existing preserved-installer assertion failure because the Linux source
bundle has a Git LFS pointer instead of the original macOS DMG. This assertion is
not skipped or weakened. Exact-tree macOS CI must hydrate LFS and rerun all source,
build and publication checks. The gated Host/Shell integration uses deterministic
model responses; it is not a native UI or commercial-model acceptance test.

Chromium/Playwright checked the actual adapter at desktop and 390px widths, light
and dark modes, Chinese/English, unchanged chat input, rework, lost receipt,
idempotent retry, uncertain notification and navigation isolation. Browser policy
blocks localhost navigation in this environment; this is explicitly an offline
`about:blank` component fixture, not a served app. The outer chat shell, task data
and RPC are fixtures. No browser policy was changed. Signed macOS packaging,
production-model quality, cross-server review, arbitrary shared-file write locks,
stall/cost policy and autonomous task reassignment remain separate work.
