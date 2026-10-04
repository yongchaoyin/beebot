# Local proactive follow-up

Conversation details can explicitly enable a standing follow-up for one Bot or one
Group. The pinned renderer uses the existing automation bridge to create this
specification; no template is installed merely by opening details:

```json
{
  "name": "Proactive follow-up",
  "purpose": "proactive-followup",
  "executionOwner": "local",
  "isEnabled": true,
  "trigger": { "type": "cron", "schedule": "17 9-17 * * 1-5" },
  "prompt": "Check only the work and boundaries already authorized in this conversation; stay silent unless an actionable change needs the user."
}
```

The prompt describes work within the user's existing authorization. It does not
confirm a Bot role, expand responsibilities, grant tool permissions, approve an
external action, or impersonate peers. Ordinary approval and tool checks still
apply. A Group wake runs the existing Group orchestrator and real member Bots.
Private model output remains private; only successful SendMessage entries deliver
public results. Silence when nothing changed is a valid routine outcome.

## Ownership and creation

`AutomationSpec`/`AutomationConfig` persist optional `executionOwner: "local"`
and `purpose: "proactive-followup"`. The runtime's existing per-agent lifecycle
mutation lane serializes creation. The file store returns an existing routine with
both markers, preserving its customized prompt, schedule and paused state after a
lost acknowledgement or repeated enable action. Ordinary routine updates that
omit these fields preserve them. Each local update or enabled-state transition
also changes `localRevision`; returning to an earlier prompt or briefly pausing
and re-enabling cannot revive an old queued wake.

Legacy definitions without ownership markers retain their existing cloud/event
scheduling behavior. Local-owned definitions never become cloud shadows, and the
remote fire consumer rejects all local-owner fires before considering completed
run ids, hashes or trigger payloads. A previously authenticated cloud shadow is
pruned by the existing reconciliation path. Missing cloud authentication does not
make a legacy cron local. Local cron scheduling does not need a cloud OAuth
credential; it does require the owning Node's normal model/execution readiness.

## Node lifecycle and delivery safety

`LocalRoutineScheduler` starts with the actual Automations host extension, stops
on host shutdown or wake suspension, and resumes from a future slot. Its
independent 15-second polling loop admits only enabled, explicitly local-owned
proactive follow-ups with a compiled cron trigger. It uses the owning Node's
configured timezone (or the cron's explicit timezone); invalid configured zones
fail closed. Sub-minute `@every` schedules and event triggers are outside this
local lane.

The **owning Node must be online**. Closing a desktop connected to an independently
running Node does not stop that Node; shutting down the Node does. Missed slots
while the Node is stopped, not ready, asleep, paused or deleted are discarded.
There is no catch-up queue. A slot at least one minute late is discarded, and
starting/resuming always computes a future slot from the current time. Changes to
prompt, schedule, pause state or timezone seed a future slot.

Before dispatch, the actual file store verifies the Bot/Group directory, current
markers, enabled state and definition. It exclusively creates a claim under the
routine's `.local-schedule-claims` directory, writes only a stable run UUID,
creation time and scheduled time, and fsyncs the file and directory entries. The
same routine identity/creation time/cron slot yields the same UUID. The claim
survives restarts and the bounded 20-entry display history. A claim is never
removed following an unknown dispatch result. Deleting the routine deletes its
claims; a later newly created routine has a separate creation identity. At the
default weekday schedule, retained claims grow by nine small files per weekday.

The normal serialized execution lane re-reads local routine enabled state,
`localRevision`, prompt, trigger and slot age before starting. Failed checks consume
the already claimed slot without executing. Failure to persist a run record also
fails before external action. A claim guarantees at most one dispatch attempt for
its slot, not that an external operation completed. Crashes can leave an
unconfirmed running history entry; neither that entry nor a claim is a public
success. Users should inspect the conversation and existing effects before
manually continuing uncertain work.

Local Bot and Group peer turns disable transient stream replay. Local Group peers
skip DM-preemption redrive, and both parent and peers are counted as running only
when their execution lane starts. The parent Group remains running while peers
wait. Upgrade recovery excludes active local routine parents and peers and rejects
explicit local automation resume markers. Legacy/ordinary Group redrive and
ordinary user-turn recovery retain their existing behavior.

## Validation

With the pinned Node 26.5.0:

- `node --test tests/local-proactive-scheduler.test.mjs`: 14 passing regressions.
  They use real temporary FileAutomationStore directories and the actual
  AutomationRuntime/RunPath, durable SQLite conversation harness, Group scheduler
  and Bot peers. OS/model execution and cloud HTTP are controlled fixtures.
- The combined local scheduler and ordinary Bot/Group continuity, peer lanes and
  delivery suite passes 57 regressions and exercises second and third sends, distinct peers and public
  delivery boundaries. These tests do not invoke a live inference account.
- `node scripts/verify-local-routine-clock.mjs`: an isolated Node process with the
  actual wall clock and independent timer dispatched both Bot and Group fixture
  stores at `2026-10-04T05:43:00.000Z`; 5 checks passed, no external actions, no UI
  reconciliation and no OAuth. The scheduled execution callback is controlled;
  this is a timer/store integration check, not a live model or full deployed Node.
- `source:typecheck` passes against the modified host sources.

Pinned renderer native details validation and full Node/macOS package checks are
recorded by the integration stage, separately from these host checks. No personal
production data or credentials are used in fixtures.
