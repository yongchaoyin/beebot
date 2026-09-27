import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface DockerCommandResult { readonly ok: boolean; readonly output: string }
export type DockerCommand = (args: readonly string[]) => Promise<DockerCommandResult>;
export interface LocalDockerClient { readonly endpoint: string; readonly run: DockerCommand }
export async function resolveLocalDockerEndpoint(options: {
  env?: NodeJS.ProcessEnv; home?: string;
  socket?: (path: string) => Promise<string | undefined>;
} = {}): Promise<string> {
  const env = options.env ?? process.env, home = options.home ?? homedir();
  const explicit = env.DOCKER_HOST?.trim();
  if (explicit && (!explicit.startsWith("unix:///") || /[\r\n]/.test(explicit))) throw new Error("Local computer requires a local Unix Docker socket; a remote DOCKER_HOST is not allowed.");
  const socket = options.socket ?? (async path => { try { const resolved = await realpath(path); return (await stat(resolved)).isSocket() ? resolved : undefined; } catch (error) { if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined; throw error; } });
  const candidates = explicit ? [explicit.slice("unix://".length)] : [join(home, ".docker", "run", "docker.sock"), "/var/run/docker.sock"];
  for (const candidate of candidates) {
    if (!isAbsolute(candidate)) continue;
    const resolved = await socket(candidate);
    if (resolved != null && isAbsolute(resolved)) return `unix://${resolved}`;
  }
  throw new Error("No local Docker socket is available. Start your local Docker engine; remote contexts are not used.");
}

/** Freeze one endpoint for the whole operation. Never consult Docker's saved context. */
export async function createLocalDockerClient(options: {
  env?: NodeJS.ProcessEnv; home?: string; socket?: (path: string) => Promise<string | undefined>;
  spawn?: typeof spawn;
} = {}): Promise<LocalDockerClient> {
  const endpoint = await resolveLocalDockerEndpoint(options), env = { ...(options.env ?? process.env) };
  delete env.DOCKER_CONTEXT; delete env.DOCKER_HOST;
  delete env.DOCKER_TLS; delete env.DOCKER_TLS_VERIFY; delete env.DOCKER_CERT_PATH;
  return { endpoint, run: args => new Promise(resolve => {
    const child = (options.spawn ?? spawn)("docker", ["--host", endpoint, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", done = false;
    const finish = (ok: boolean) => { if (!done) { done = true; resolve({ ok, output: output.trim() }); } };
    const append = (chunk: Buffer) => { output += chunk.toString(); if (output.length > 200_000) output = output.slice(-200_000); };
    child.stdout?.on("data", append); child.stderr?.on("data", append);
    child.once("error", () => { output = "Could not run the Docker executable."; finish(false); });
    child.once("close", code => finish(code === 0));
  }) };
}
