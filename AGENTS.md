# BeeBot development contract

Read `README.md`, `CONTRIBUTING.md`, and the relevant protocol/implementation
notes before changing a behavior. Work in `yongchaoyin/beebot`; do not mix in
`scene` or unrelated migration projects.

## Product invariants

Bots are long-lived collaborators. Groups are shared workplaces. Coordination
is task-scoped, not a permanent manager hierarchy. Users specify goals and
boundaries, can intervene, and can leave while their team works.

The desktop connects to an independently deployed Node. Do not make SSH, Docker,
server installation, or administrator machine credentials a client prerequisite.
Reuse server-owned browser authentication and trusted-device enrollment; connection
readiness is not model readiness or permission to operate every Bot.

Keep remote Bots in the existing Bot list, New bot entry and conversation
route. Manage connections in Settings → Servers. Do not introduce a parallel
remote dashboard, fake a local account, set a fake model key, or mark local
initialization complete to bypass onboarding.

Each Bot has one explicit primary job. A user-confirmed role is versioned separately
from its mutable persona, name and model. Within scope, own the outcome; outside
scope, explain or collaborate without silently taking over. Mentions and peer
assignments are not role expansions. Role text and Agent self-assessment are NOT
verified capabilities or executable permissions. Preserve legacy profiles and
already-started work; do not infer a confirmed role from old descriptions.

Individual Bots and Groups are equally important core product surfaces. A Bot
is the smallest unit of the swarm and must remain independently useful. Group
collaboration happens through real Bot-to-Bot messages, discussion and handoffs,
not a single coordinator impersonating multiple colleagues. Changes to either
surface must include regression coverage for the other where they share code.

Ordinary chat must remain continuous, with replies, decisions, errors and recovery
in the conversation. This is NOT a global ban on dialogs: user-initiated New Bot,
New Group and settings may use centered management dialogs. Do not put creation
forms into the narrow sidebar just to avoid a modal. Always exercise second and
third sends while work is running, in both single-Bot and Group conversations.

## Conversation and delivery

Ordinary dialogue needs a direct answer, not a task recap. Only report execution
outcomes after real work or an execution attempt, and do not repeat a result
already delivered. Requested document summaries remain valid answers. A task is
not established by tool-call count, a plan, a receipt or a UI working state.

When SendMessage is available, only real successful sends become public replies.
Never synthesize a send from private final text, compaction, or internal bookkeeping.
Be proactive within the user's actual goal and authorization; clarify consequential
ambiguity without turning every question into a workflow. Do not simulate peers.

## Implementation paths

The shipped renderer uses a pinned upstream baseline plus the adapters in
`scripts/lib/`. Editing the readable `frontend/` tree alone does not prove the
packaged UI changed. Identify the actual build entry and exercise it. Preserve
checksum, archive, signing, identity and publication checks.

Use the same Bot identity, avatars and interaction language across entrypoints.
Verify Chinese/English, light/dark, narrow windows, keyboard focus and errors.
Never confuse disconnection with task failure or receipt of a request with
completed delivery. Do not replay uncertain external operations automatically.

## Asynchronous UI

Validate connection/node identity before changing the selected conversation.
A failed open must preserve the previous conversation and its draft. The caller
owns its Settings/dialog lifetime. Cancel read-only navigation when that view
closes; cancelling navigation must not cancel server work.

Bind asynchronous responses to their selection/authentication generation.
Invalidate stale results and private catalog caches on relevant connection
changes. Node identity is not proof of the logged-in principal; do not claim
cross-account isolation where the bridge does not expose enough identity.
Keep drafts, command deduplication, task versions and server ownership distinct.

## Stage completion and commits

Develop in small, verifiable stages. Before completing a stage:

1. Review the diff and run relevant tests against the actual modified sources.
2. Record exactly what passed, failed, was mocked, or could not run. Component
   tests do not replace real Node/Electron integration or macOS package checks.
3. Commit the stage's code and regression tests together, with a meaningful
   message. Include the commit SHA in the handoff. Push to an authorized feature
   branch; do not force-push or change protected/default branches without consent.

Distinguish a local commit, a successful push and an opened PR. A permission
error is not a successful submission. Preserve the commit/patch and report the
blocker rather than describing planned or local-only changes as deployed.

Use the repository's pinned Node/toolchain versions for full validation. Do not
relax engines, dependency locks, security checks or assertions just to get a green
run in a limited environment. Keep credentials and private production data out
of logs, screenshots, fixtures and commits.
