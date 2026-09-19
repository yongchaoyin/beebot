/** Shared by the standalone host's daemon supervisor and transport. */
export function standaloneExecEndpoint(env: NodeJS.ProcessEnv = process.env): { port: number; authToken: string } {
  const port = Number(env.SAND_BOX_EXEC_DAEMON_PORT ?? 1337);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SAND_BOX_EXEC_DAEMON_PORT must be between 1 and 65535");
  }
  return { port, authToken: env.SAND_BOX_EXEC_DAEMON_AUTH_TOKEN ?? "local" };
}
