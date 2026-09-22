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


## Scoped questions and quiet event UI

A run captures its visible work and user context at dequeue. Its own committed
work publications update that capture; later user changes never get retroactively
read into it. Questions with `work_on` bound to a recorded task carry a Host-minted
scope fingerprint. It includes requirements/revision identity, parent work and
dependencies, current membership, submitted results and relevant user messages.
A clearly quoted unrelated task does not invalidate the question. Unquoted,
unknown or non-task quotes remain conservative global context. Related edits,
revisions (including A→B→A), membership changes and explicit Stop still invalidate
old answers. A delayed question already based on stale context is marked inactive
at publication. Unbound/legacy questions keep their earlier conservative rule.
These are ordinary clarification answers, never tool or external-action grants.
Explicit semantic global changes should remain unquoted or use Stop; this is
structural task scoping, not natural-language permission understanding.

The shipped status adapter adds small inline historical event labels. A visible
claim, submission or peer review is rendered only from the Host-written event,
not by parsing Bot prose. Submission is not acceptance; peer review is not user
approval. Labels describe the event on that message, not an inferred latest state
from incomplete/virtualized history. There are no new dialogs, dashboards or
automatic retries. Invalid event shapes are ignored; chat switching, remote
selection, language and virtualization preserve input/focus and clear old labels.

Follow-up tests cover actual single-Bot SendMessage dispatch, two concurrent
SQLite writers, eight question-scope scenarios through real group ingress, and
four UI scenarios. Model/OS execution remains controlled. Claim/status messages
cannot serve as result or review evidence. The local all-tests gate retains an
installer-inventory failure because this Linux snapshot has the Git LFS pointer;
macOS CI must hydrate the real preserved file. Both typechecks pass locally.
Browser checks use the actual packaged status adapter with an in-memory fixture:
loopback navigation was blocked by browser policy, so no network navigation or
native app validation is claimed. No browser policy was changed.
