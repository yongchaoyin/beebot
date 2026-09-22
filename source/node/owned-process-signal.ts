import { setTimeout as delay } from "node:timers/promises";

type SignalPorts = {
  platform: NodeJS.Platform;
  kill: (pid: number, signal: NodeJS.Signals | number) => unknown;
  wait: (ms: number) => Promise<unknown>;
};
const defaults: SignalPorts = { platform: process.platform, kill: (pid, signal) => process.kill(pid, signal), wait: ms => delay(ms) };
const code = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

/** Only for a child/group already owned by the runtime; never a PID loaded from
 * an old receipt. Denial is NOT evidence of exit. Observe a short macOS teardown
 * race read-only, accepting only explicit ESRCH; a live/unknown group stays fenced.
 * No privileged fallback, repeated termination signals, or swallowed EPERM. */
export async function signalOwnedRuntime(pid: number, signal: NodeJS.Signals, ports: SignalPorts = defaults): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) throw new Error("Invalid owned runtime PID");
  const target = ports.platform === "win32" ? pid : -pid;
  try { ports.kill(target, signal); }
  catch (error) {
    if (code(error) === "ESRCH") return;
    if (ports.platform !== "darwin" || code(error) !== "EPERM") throw error;
    // A group can be disappearing during signal delivery. Do not assume that
    // happened: insist on OS confirmation, otherwise preserve the original error.
    for (let attempt = 0; attempt < 20; attempt++) {
      try { ports.kill(target, 0); }
      catch (probeError) {
        if (code(probeError) === "ESRCH") return;
        if (code(probeError) !== "EPERM") throw error;
      }
      if (attempt < 19) await ports.wait(50);
    }
    throw error;
  }
}
