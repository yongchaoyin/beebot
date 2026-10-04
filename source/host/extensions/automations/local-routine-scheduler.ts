import { dirname } from "node:path";
import { createPollingPolicy, realClock, type Clock } from "../../../internal/scheduling.js";
import { compileCronMatcher, computeNextRunAt, getZonedFormatter } from "../../../shared/automation-schedule.js";
import { FileAutomationStore } from "../../automations/automation-store.js";
import { isLocalProactiveAutomation, localAutomationDefinition, LOCAL_AUTOMATION_MAX_LATENESS_MS, type AutomationRecord } from "../../automations/automation.js";

export const LOCAL_ROUTINE_POLL_INTERVAL_MS = 15_000;
export interface LocalRoutineTarget { agentId: string; automation: AutomationRecord }
interface Slot { definition: string; nextAt: number | null }

/** The owning Node's opt-in cron lane. It never takes over legacy/cloud routines,
 * catches up missed work, or retries a dispatch whose external effects are unknown. */
export class LocalRoutineScheduler {
  private readonly slots = new Map<string, Slot>();
  private polling: { dispose(): void } | undefined;
  private generation = 0;
  private active = false;
  private inFlight: Promise<void> | undefined;
  private rerun = false;
  private readonly clock: Clock;
  constructor(readonly deps: {
    listAutomations(): Promise<readonly LocalRoutineTarget[]>;
    isReady(): boolean;
    getTimeZone(): string | undefined;
    fire(args: { agentId: string; automation: AutomationRecord; runUuid: string; scheduledForMs: number }): Promise<unknown>;
    clock?: Clock;
    reportDiagnostic?(value: { extensionId: string; operation: string; errorType: string }): void;
  }) { this.clock = deps.clock ?? realClock; }

  start(): void {
    if (this.active) return;
    this.active = true; this.generation += 1; this.slots.clear();
    this.polling = createPollingPolicy(this.clock, { name: "automations.local-cron", intervalMs: LOCAL_ROUTINE_POLL_INTERVAL_MS }).start(() => this.reconcileNow());
  }
  stop(): void { this.active = false; this.generation += 1; this.polling?.dispose(); this.polling = undefined; this.slots.clear(); this.rerun = false; }
  reconcileNow(): Promise<void> {
    if (!this.active) return Promise.resolve();
    if (this.inFlight) { this.rerun = true; return this.inFlight; }
    this.inFlight = this.tick(this.generation).catch((error: unknown) => this.diagnostic("reconcile", error)).finally(() => {
      this.inFlight = undefined;
      if (this.rerun && this.active) { this.rerun = false; void this.reconcileNow(); }
    });
    return this.inFlight;
  }
  private diagnostic(operation: string, error: unknown): void { this.deps.reportDiagnostic?.({ extensionId: "automations.local-cron", operation, errorType: error instanceof Error ? error.constructor.name : typeof error }); }
  private async tick(generation: number): Promise<void> {
    const targets = await this.deps.listAutomations();
    if (!this.active || this.generation !== generation) return;
    const now = this.clock.now(), timeZone = this.deps.getTimeZone();
    const seen = new Set<string>();
    for (const { agentId, automation } of targets) {
      if (!automation.isEnabled || !isLocalProactiveAutomation(automation) || automation.trigger.type !== "cron") continue;
      const matcher = compileCronMatcher(automation.trigger.schedule);
      // Invalid explicitly configured time zones fail closed, with no host-local fallback.
      const configuredZone = matcher?.timeZone ?? timeZone;
      if (!matcher || (configuredZone && !getZonedFormatter(configuredZone))) continue;
      const key = `${agentId}\0${automation.id}`, definition = `${localAutomationDefinition(automation)}\0${timeZone ?? ""}`;
      seen.add(key);
      const nextAfterNow = () => computeNextRunAt(automation.trigger.type === "cron" ? automation.trigger.schedule : "", now, timeZone);
      let slot = this.slots.get(key);
      if (!slot || slot.definition !== definition) { slot = { definition, nextAt: nextAfterNow() }; this.slots.set(key, slot); continue; }
      if (slot.nextAt == null || slot.nextAt > now) continue;
      const scheduledForMs = slot.nextAt;
      // Move first; no catch-up when offline, paused, asleep, or after a dispatch error.
      slot.nextAt = nextAfterNow();
      if (!this.deps.isReady() || now - scheduledForMs >= LOCAL_AUTOMATION_MAX_LATENESS_MS) continue;
      if (typeof automation.filePath !== "string") continue;
      const store = new FileAutomationStore(dirname(dirname(automation.filePath)), () => timeZone);
      if (store.configPath(automation.id) !== automation.filePath) continue;
      const runUuid = store.claimLocalScheduleSlot({ agentId, automation, scheduledForMs });
      if (!runUuid || !this.active || this.generation !== generation || !this.deps.isReady()) continue;
      // Do not wait for a model turn here: another Bot/Group's cron must remain independent.
      try { void this.deps.fire({ agentId, automation, runUuid, scheduledForMs }).catch((error: unknown) => this.diagnostic("dispatch", error)); }
      catch (error) { this.diagnostic("dispatch", error); }
    }
    for (const key of this.slots.keys()) if (!seen.has(key)) this.slots.delete(key);
  }
}
