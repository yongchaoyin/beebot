# Colleague-owned completion in the local Host

The 2026-09-26 product correction retains a detailed, read-only collaboration
panel. Ordinary task completion belongs to the Bot, rather than to a user
acceptance/refresh workflow. This stage changes the transcript-backed local Host
used by individual Bots and local Groups; it does not change Node protocol v1's
separate remote goal ledger or claim new cross-server capabilities.

## Actual completion, without invented user approval

`SendMessage.collaboration.assign` defaults to owner checking at the Host. Tool
parsing preserves an omitted reviewer so exact pre-upgrade command retries can
still match their historical user-default digest. New tasks record
`reviewPolicy: owner | peer`. Explicit `reviewer: user` on new assignment or
reassignment is rejected with guidance to ask actual decisions/permissions in
conversation; it must not establish an inaccessible manual acceptance workflow.
Existing human-review records and the authenticated review API remain readable
and usable for compatibility.

The owner claims, publishes its actual result/evidence, submits that version, and
uses `self-check` to check each criterion exactly once against pinned evidence.
Passing owner checks produce `completed` plus an attributed `selfCheck`, not
`accepted` or `review.reviewer=user`. A designated independent colleague still
uses the existing review action. The first assignment creator finishes only the
exact full current work set. An owner check, independent check, and the final
receipt are assertions backed by published evidence; hashes prove version
identity, not semantic correctness or permission to send/deploy externally.

Failed owner checks produce `changes-requested`. They can cite a fresh report of
corrupt output or obsolete prerequisites without certifying those originals.
Successful completion and final delivery still re-verify the original submission
and check manifests, membership, all criteria, and dependency versions. Repairs
require fresh result publication. Revisions invalidate downstream completion and
notify the responsible owner to inspect/reconcile; no external operation is
replayed by a transition, dependency notification, read, or restart.

## History, intervention, and exceptional recovery

No saved task is silently changed on read. A legacy `reviewer=user` task lacking
a review policy may be owner-checked only after a new real, task-quoted user
continuation following the submission. Its old reviewer/history remain intact;
the new proof records the Bot and the continuation source. An explicit stored
human review policy or designated peer cannot be replaced by self-check.

A Stop after submission requires a fresh scoped user continuation and fresh
inspection evidence published after that continuation before checking saved
results. This is a result inspection path, not permission to replay tools.
Unresolved delivery records marked `needs-review` still fence completion for the
related task/goal, including an interrupted active execution. This stage does not
invent reconciliation for uncertain side effects or reset those records; such
work still needs explicit inspection/reconciliation. Unrelated interrupted
messages do not prevent fresh unrelated goals from completing. The user can keep
sending ordinary messages during both single-Bot and Group work.

The compatibility human-review API remains available for historical work, but
there is no new natural-language action that pretends to be authenticated human
acceptance. Existing explicitly required human gates are not auto-converted.

## Validation scope

`tests/collaboration-self-check.test.mjs` exercises the actual publication,
projection, SQLite writer, tool schema, single-Bot update handler, and Group
scheduler with controlled model and OS I/O. It covers owner completion and repair,
peer/human boundaries, legacy digest retries, failed persistence/idempotence,
evidence drift, dependency invalidation, Stop inspection, relevant uncertainty,
and second/third user sends while work is running. Historical review regression
fixtures explicitly represent pre-upgrade events rather than creating removed
user-review workflows. These tests do not establish production-model quality,
real Electron installation, or Node service integration by themselves.
