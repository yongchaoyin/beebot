import path from "node:path";

import { startBoxExecDaemon } from "./server.js";

export async function runBoxExecDaemonEntrypoint(): Promise<void> {
  const workspaceRoot = path.resolve(process.env.SAND_BOX_WORKSPACE_ROOT ?? process.cwd());
  const portText = process.env.SAND_BOX_EXEC_DAEMON_PORT;
  const handle = await startBoxExecDaemon({
    workspaceRoot,
    ...(portText == null ? {} : { port: Number.parseInt(portText, 10) }),
    ...(process.env.SAND_BOX_TERMINALS_DIRECTORY == null ? {} : { terminalsDirectory: process.env.SAND_BOX_TERMINALS_DIRECTORY }),
    ...(process.env.SAND_BOX_EXEC_DAEMON_AUTH_TOKEN == null ? {} : { authToken: process.env.SAND_BOX_EXEC_DAEMON_AUTH_TOKEN }),
  });
  process.stdout.write(`${JSON.stringify({ event: "box-exec-daemon-ready", url: handle.url, workspaceRoot: handle.workspaceRoot, terminalsDirectory: handle.terminalsDirectory })}\n`);
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => shutdownPromise ??= handle.stop().then(() => { process.exitCode = 0; });
  // The Host and its supervisor may signal the same group during shutdown.
  // Keep handlers installed until detached Shell groups have been reaped;
  // a second signal must not apply the default exit action halfway through.
  process.on("SIGINT", () => { void shutdown(); });
  process.on("SIGTERM", () => { void shutdown(); });
}
