# Collaboration integrity hardening

Continues the C1-C3 local Host implementation on `639ff09`. No parallel work
ledger, permanent manager Bot, new chat modal or Honeyline branch overwrite.

## Evidence belongs to the actual review

Submission evidence and independent reviewer evidence are different sets. A
review now captures a deduplicated manifest of all cited criterion evidence in
the same durable transcript event. Finish verifies both manifests against the
published versions. Editing an independent test report after acceptance can no
longer pass simply because a newly calculated hash matches the new report.
Hashes still prove content identity, not semantic correctness. Peer/human check
outcomes remain attributed assertions; no production-model grade is invented.

Older rows without a review manifest remain readable and historical. They are
not silently backfilled from today's evidence. Such acceptance is ineligible for
new dependent claims/closure until the designated peer or authenticated user
reviews the current submission again. User re-review stays in the existing inline
control, requires each criterion, and retains the Stop/member/version guards.

## Dependencies remain live after revisions

When an upstream revision is accepted, notify the owners of directly dependent
work whose earlier acceptance is now obsolete, as well as offered/waiting work.
This notification does not claim or execute a task, mutate downstream versions,
release an OS lease, or replay old writes. Normal dependency checks govern the
owner's explicit re-claim. Further dependencies become ready in order, not all at
once. Peer acceptance also rejects a missing assignee/coordinator instead of
marking an orphaned assignment accepted and discovering it only at finish.

## Regression evidence

The new integrity suite first reproduced unpinned independent review evidence,
missing-member acceptance and missed dependent notifications against the base.
It uses actual group publication/state/SQLite, with controlled model/OS I/O.
The existing completion/review suites are retained. A migration case validates
real user re-review and finish; an actual adapter test checks its inline warning.

Both typechecks and focused tests run on the pinned Node 26.5.0. Chromium checks
the actual review adapter at 1120x860 and 390x844 with controlled shell/RPC data:
no chat modal, no horizontal overflow, no automatic acceptance, criterion checks,
and unchanged chat draft. Browser plugin was not available; Playwright was used.
This is not native macOS UI, production-model behavior or a signed installation.
Full exact-tree macOS checks must hydrate the existing LFS installer and runtime
and pass the unmodified publication checks before a release claim.
