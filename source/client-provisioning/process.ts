import { spawn } from "node:child_process";
import { PreflightError } from "./preflight.js";

export type ProcessRequest = { program: string; args: string[]; input?: string; signal: AbortSignal; timeoutMs: number; maxBytes: number };
export type ProcessResult = { status: number | null; stdout: string; stderr: string };
export type ProcessRunner = (request: ProcessRequest) => Promise<ProcessResult>;

/** No shell and no inherited application secrets. Only system utilities are
 * selected by the caller, never a renderer-supplied executable/command. */
export const runBounded: ProcessRunner = request => new Promise((resolve, reject) => {
  if (request.signal.aborted) { reject(new PreflightError("CANCELLED")); return; }
  const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C", SSH_ASKPASS_REQUIRE: "never" };
  if (process.env.HOME) env.HOME = process.env.HOME;
  if (process.env.SSH_AUTH_SOCK) env.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
  const child = spawn(request.program, request.args, { env, shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let failure: PreflightError | undefined, bytes = 0, stdout = "", stderr = "";
  const stop = (reason: PreflightError) => { failure ??= reason; child.kill("SIGKILL"); };
  const abort = () => stop(new PreflightError("CANCELLED"));
  request.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => stop(new PreflightError("TIMEOUT")), request.timeoutMs);
  const clean = () => { clearTimeout(timer); request.signal.removeEventListener("abort", abort); };
  const consume = (chunk: Buffer, error: boolean) => {
    bytes += chunk.length;
    if (bytes > request.maxBytes) { stop(new PreflightError("OUTPUT_LIMIT")); return; }
    if (error) stderr += chunk.toString("utf8"); else stdout += chunk.toString("utf8");
  };
  child.stdout.on("data", chunk => consume(chunk, false));
  child.stderr.on("data", chunk => consume(chunk, true));
  child.stdin.on("error", () => { /* close/error below is authoritative; no raw diagnostics leak. */ });
  child.once("error", error => {
    clean(); reject(new PreflightError((error as NodeJS.ErrnoException).code === "ENOENT" ? "SSH_UNAVAILABLE" : "CONNECTION_FAILED"));
  });
  child.once("close", status => { clean(); failure ? reject(failure) : resolve({ status, stdout, stderr }); });
  child.stdin.end(request.input ?? "");
  if (request.signal.aborted) abort();
});
