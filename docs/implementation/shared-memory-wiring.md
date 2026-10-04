# Shared memory in the actual Host prompt

2026-10-04. This completes the existing private/user/project memory paths in the
production Host. It adds no account, Node protocol or renderer surface.

The prior `MemoryService` exposed only `createAgentStore`. Host composition asked
for nonexistent shared factories, the user/project recall shapes differed from
the prompt interfaces, and the production prompt supplied four null memory
closures. Assigning stores to runner setter fields did not make the Agent read
them. This stage joins the real factories, typed recall and prompt closures.

- Private memory remains in each Bot's `memory/` and is the default write target.
  Existing private facts are preserved; no content is automatically copied to a
  shared tier. Automatic extraction and synthesis still use the private store.
- Explicit user memory is stored in `user-memory/agents/<bot-id>/`. Recall merges
  shards with dated source labels, bounded profile/log limits and deduplication
  of identical normalized facts. Contradictory wording is not a semantic conflict
  resolver; it remains visible context requiring judgment.
- Project memory lives at `projects/<slug>/memory/agents/<bot-id>/`, with its name
  read from `project.md`. Recall reads the Bot's explicit `projects.json` on every
  turn, includes only joined existing projects, and injects at most three named
  blocks plus a list of other joined projects. Leaving removes that project's
  injection from the next turn, including an already-created runner.
- Single-Bot prompts can receive all three tiers. Local Group prompts and memory
  interfaces receive only that Bot's joined project context. Group memory writes
  must name `scope: "project"` and a current joined project; default/private and
  global user writes fail with a conversation-readable explanation. Cross-user
  SharedRoom prompts receive no private, user or project memory providers and no
  Agent state writer.
- Missing `sandRoot` exposes no shared stores or fabricated paths. Private memory
  remains usable, while shared writes and project management report unavailable
  storage.

Private prompt snapshots retain their existing freeze rule. Shared user/project
sections are read live outside those snapshots so membership changes cannot be
frozen into later turns. Known older snapshots that combine shared sections with
private memory are rebuilt as private-only presentation snapshots; facts on disk
are untouched. The pre-existing production `compactionEpoch` is still constant
zero in Host composition; this stage does not claim to implement the complete
compaction lifecycle. Clearing or explicitly resetting a private snapshot remains
separate from live shared recall.

Prompt guidance requires an explicit user request before sharing facts or joining
shared scope, and states that memory and project membership cannot change a
confirmed primary job, prove capability or grant tool permissions. This is model
guidance, not a natural-language authorization classifier. The memory interface
and automatic prompt boundaries do not sandbox arbitrary filesystem tools.
The Host's shared root has no new principal identifier; this stage makes no claim
of cross-account isolation or shared-machine filesystem isolation.

Validation uses pinned Node 26.5.0 and locked dependencies. The dedicated tests
and existing collaboration review regressions passed 22/22, with zero failures
and zero skips; the 13 dedicated shared-memory cases all passed. Source typecheck
also passed. An earlier fixture run failed because its production inference port
lacked the required session/privacy methods; the fixture now supplies those
contracts and fails if session creation is attempted. No product assertion was
relaxed to resolve the fixture failure. The tests
exercise real filesystem stores and membership files, the started memory
extension, production Host construction and the actual per-turn prompt generator.
The fixture observes the production adapter's construction input without
replacing its implementation, and calls its prompt owner without inference.
Model creation throws if attempted. Snapshot storage, debounce, box, context and
model/OS ports are controlled substitutes. The tests cover single Bot, local
Group, cross-user SharedRoom, project leave, a legacy combined snapshot, write
scope, source/limit contracts, and preservation of the separately confirmed job.
Full integration, macOS package and installed-app checks are recorded by the
parent stage; these component/runtime fixtures do not substitute for them.
