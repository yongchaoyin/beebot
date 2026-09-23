import type { IncomingMessage } from "node:http";
import { TenantAccessError } from "./tenant-directory.js";

const bad = () => new TenantAccessError(400, "invalid_request", "Invalid JSON object.");
/** Small authenticated API bodies only. Reject duplicate members (including
 * escaped spellings), malformed UTF-8, nested bombs and trailing input. */
export function parseCatalogObject(bytes: Uint8Array): Record<string, unknown> {
  try {
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(raw), stack: (Set<string> | null)[] = [];
    const tokens = /"(?:[^"\\]|\\[\s\S])*"|[{}\[\]]/g;
    for (let match; (match = tokens.exec(raw));) {
      const token = match[0];
      if (token === "{" || token === "[") {
        if (stack.length >= 8) throw bad();
        stack.push(token === "{" ? new Set() : null);
      } else if (token === "}" || token === "]") stack.pop();
      else if (/^\s*:/.test(raw.slice(tokens.lastIndex))) {
        const keys = stack.at(-1), key: string = JSON.parse(token);
        if (!keys || keys.has(key)) throw bad();
        keys.add(key);
      }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw bad();
    return parsed as Record<string, unknown>;
  } catch { throw bad(); }
}
export function readCatalogBody(req: IncomingMessage, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json" ||
      req.headers["content-encoding"] !== undefined) throw new TenantAccessError(415, "content_type", "Use uncompressed application/json.");
  const maximum = 32 * 1024, declared = Number(req.headers["content-length"] ?? 0);
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > maximum) throw new TenantAccessError(413, "body_too_large", "Request is too large.");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0, done = false;
    const timeout = setTimeout(() => finish(new TenantAccessError(408, "body_timeout", "Request timed out.")), 10_000);
    timeout.unref();
    function finish(error?: Error): void {
      if (done) return; done = true; clearTimeout(timeout);
      req.off("data", data); req.off("end", end); req.off("error", failed); req.off("aborted", failed);
      signal.removeEventListener("abort", failed);
      if (error) { req.resume(); reject(error); return; }
      try { resolve(parseCatalogObject(Buffer.concat(chunks))); } catch (e) { reject(e); }
    }
    function data(value: Buffer | string): void {
      const b = Buffer.from(value); size += b.length;
      if (size > maximum) finish(new TenantAccessError(413, "body_too_large", "Request is too large."));
      else chunks.push(b);
    }
    function end(): void { finish(); }
    function failed(): void { finish(new TenantAccessError(400, "request_aborted", "Request ended.")); }
    req.on("data", data); req.once("end", end); req.once("error", failed); req.once("aborted", failed);
    signal.addEventListener("abort", failed, { once: true }); if (signal.aborted || req.aborted) failed();
  });
}
