import { randomBytes, createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { OAuthTokens } from "./types.js";

export function normalizeNodeUrl(raw: string): string {
  const url = new URL(raw.trim());
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Use HTTPS for servers, or HTTP on this computer's loopback address.");
  }
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new Error("Enter the server origin, without a path, credentials, query, or fragment.");
  }
  return url.origin;
}

export class NodeHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function fetchNodeJson(baseUrl: string, route: string, init: RequestInit = {}): Promise<any> {
  // Do not follow a redirect with credentials to a different origin.
  const response = await fetch(new URL(route, baseUrl), {
    ...init, redirect: "error", signal: init.signal ?? AbortSignal.timeout(20_000),
  });
  const raw = await response.text();
  if (raw.length > 8 * 1024 * 1024) throw new Error("The server response exceeds the client limit.");
  let data: any;
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { throw new NodeHttpError(response.status, "The server returned an invalid response."); }
  if (!response.ok) {
    const message = [data.message, data.error_description, data.error].find(value => typeof value === "string");
    throw new NodeHttpError(response.status, message ? message.slice(0, 400) : `Server request failed (${response.status}).`);
  }
  return data;
}

export function validateTokens(value: any): OAuthTokens {
  if (typeof value?.access_token !== "string" || !value.access_token || typeof value.refresh_token !== "string" || !value.refresh_token || !Number.isFinite(value.expires_in) || value.expires_in <= 0 || value.token_type?.toLowerCase() !== "bearer") {
    throw new Error("The server returned an invalid device session.");
  }
  return value;
}

export async function exchangeToken(baseUrl: string, parameters: Record<string, string>): Promise<OAuthTokens> {
  return validateTokens(await fetchNodeJson(baseUrl, "/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: "beebot-desktop", ...parameters }).toString(),
  }));
}

/** The OS browser owns the login UI; this process receives only a single-use code. */
export async function authorizeNode(baseUrl: string, openExternal: (url: string) => Promise<unknown>, signal?: AbortSignal): Promise<OAuthTokens> {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const receivedCode = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  // Install a handler immediately: cancellation can happen while the browser is opening.
  void receivedCode.catch(() => {});
  let redirectUri = "";
  const server = createServer((request, response) => {
    const expected = new URL(redirectUri);
    const requestUrl = new URL(request.url ?? "/", redirectUri);
    const issuer = requestUrl.searchParams.get("iss");
    if (request.method !== "GET" || request.headers.host !== expected.host || requestUrl.pathname !== "/oauth/callback" || requestUrl.searchParams.get("state") !== state || (issuer !== null && issuer !== baseUrl)) {
      response.writeHead(400, { "Content-Type": "text/plain" }).end("Invalid authorization callback.");
      return;
    }
    const code = requestUrl.searchParams.get("code");
    response.writeHead(code ? 200 : 400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'" });
    response.end(code ? "<h1>Connected to BeeBot</h1><p>You can return to the Mac app.</p>" : "<h1>Authorization was declined.</h1>");
    if (code) resolveCode(code); else rejectCode(new Error("Server authorization was declined."));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); }); });
  redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/oauth/callback`;
  const timer = setTimeout(() => rejectCode(new Error("Sign-in timed out. Try again.")), 5 * 60_000);
  const abort = () => rejectCode(new Error("Sign-in cancelled."));
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw new Error("Sign-in cancelled.");
    const url = new URL("/oauth/authorize", baseUrl);
    url.search = new URLSearchParams({ response_type: "code", client_id: "beebot-desktop", redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
    await openExternal(url.href);
    const code = await receivedCode;
    return await exchangeToken(baseUrl, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    server.close();
    server.closeAllConnections();
  }
}
