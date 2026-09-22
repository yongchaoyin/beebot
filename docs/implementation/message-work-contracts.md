# Message-linked work contracts

Base: quoted-collaboration `02be4fe`. This is an additive local Host stage, not a
replacement swarm coordinator. Single Bot and Group share the same storage and
message contract. Ordinary chat, questions and quoted replies remain messages;
only explicit structured operations create or change work responsibilities.

## Implemented slice

`SendMessage` text can carry `collaboration`: offer, claim, block, resume, revise,
submit or review. Its normal body and quote are the public collaboration. The
Host supplies sender identity and current membership, validates real message
references and records state plus the public message plus the retry receipt in
one SQLite transaction in the existing agent database. Normal state transitions
use an expected version. There is no silent second owner, self-acceptance or
accepted task mutation. Progress can explicitly use `notify:none` in a group;
it stays visible without waking all colleagues. Legacy untyped chat routing is
unchanged.

An offer ID is its actual assignment message address. An assignee claims the
work explicitly. Dependencies reference existing tasks in this conversation;
backward-only immutable edges cannot introduce cycles. Dependent claims wait for
reviewed results, not merely a reply or submission. Acceptance wakes only newly
ready assignees and the affected task requester. A requester is task-scoped,
not a permanent boss. Source ancestry establishes association, NEVER authority.

Submission references real, already published results from the owner. It records
message-content fingerprints. Only the designated independent reviewer can
accept that exact submission and version, with evidence for every criterion.
This is a recorded peer assessment, not an independent proof of truth or user
approval. Rejection retains the old version and routes rework to its owner.
A solo Bot can claim and submit but cannot create an independent reviewer or
approve its own result. A human acceptance control is not introduced here.

Authoritative task context is refreshed after the execution queue, bounded by
32 whole records / 24,000 characters. Quote a task to prioritize it. Reading work
state does not run a model, replay external work, or automatically resume work
across a restart. Corrupt state/failed writes reject rather than resetting work.
There is no separate work-state sidecar or cross-database transaction gap.

## Evidence and limits

Focused tests use the production SandAgentDb transaction layer and the actual
send -> group routing -> publication chain. Model and OS execution are controlled
substitutes. The fixed-session fixture holds database handles until teardown;
it is not a native lifecycle/reopening test. A separate store reopen test verifies
persistent task state. Failure injection proves ownership rolls back when the
visible message cannot be inserted. No packaging, identity or signature checks
are relaxed.

This does not enforce arbitrary Shell/browser writes against task ownership,
verify model judgments, implement capability bidding, autonomous takeover,
resource/worktree isolation, cost-based replanning, natural-language authorization,
or automatic multi-tenant/cross-server task transport. An urgent boundary change
still needs explicit Stop. A requirement revision fences stale submissions, not
an already-running external operation. No existing workspace/privacy boundary
is broadened. No pending work is silently considered finished at restart.
