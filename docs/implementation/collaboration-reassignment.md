# Unable to accept is a normal colleague response

Extends the existing SendMessage work sidecar for individual Bots and Groups.
It does not introduce a new manager, task dashboard, chat modal or automatic
capability claims. Natural text and its original assignment quote stay visible.

## Decline and re-offer

Before any recorded claim, the designated colleague may `decline` with a reason.
The original coordinator is notified, not every group member. The coordinator may
`reassign` to an explicit current assignee and independent reviewer/user. A declined
assignment may be re-offered to its original Bot when its limitation is resolved.
The assignee still has to claim; reassignment itself does not start work. The
original task/goal IDs, criteria and dependencies remain; scopeVersion increments
so old assignment-scoped answers cannot authorize a new owner. A new user goal or
expanded criteria cannot be smuggled into this action's strict schema.

The UI displays the reason inline, calls a declined assignment "originally offered"
rather than falsely "owned", and does not offer acceptance for unsubmitted work.
Neither model prose nor a new state grants tools or changes the OS execution lease.

## No blind takeover

Wait and revision can clear the current claimedBy field. Therefore every transfer
checks the validated history for a past claim/submission, not merely the latest
state. Previously claimed work is refused even if its latest row says offered or
waiting. Inspect and explicitly stop/reconcile possible external effects instead
of moving it to a new Bot. This protects recorded work, not arbitrary untracked
Shell writes. Automatic recovery of running/uncertain work is not introduced.

Stable request IDs preserve existing idempotence and version conflict rules.
Sync validation and the visible transcript append stay in the existing single
Host writer boundary. Missing members, self-review and failed persistence do not
change the owner. A decline does not satisfy dependencies or permit completion.

## Validation

Eleven new runtime regressions exercise actual publication, state projection,
SQLite and send ingress, including the single-Bot update handler and A->B decline
->A reassignment->C execution->D review->A finish. Model and OS behavior are
controlled fixtures. Cases cover retries, stale versions, permissions, missing
members, persistence failure, wait/revision history, dependencies and the real
tool schema. One actual UI-adapter regression covers inline reason/localization
and markup safety. The browser checks use the actual adapter with controlled RPC
at 1120x860/light and 390x844/dark, preserving drafts and never auto-accepting.

Both pinned Node 26.5.0 typechecks and the frontend build passed locally. The
full local run before the final schema case had 388 tests: 378 passed, 1 failed
because the installer remained a Git LFS pointer, and 9 conditionally skipped.
The final exact source still requires the unmodified macOS CI (LFS hydration)
and the separately enabled Host/Shell suite. This is not production-model,
end-user native UI, signed release, cross-server work, or capability matchmaking.
