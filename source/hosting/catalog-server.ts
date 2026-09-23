import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { NodeAuth, NodeAuthError } from "../node/auth.js";
import { ControlError } from "../node/control-store.js";
import { validateConfig, type NodeConfig } from "../node/config.js";
import { EnrollmentError } from "../node/device-enrollment.js";
import { TenantAccessError, TenantDirectory, privateDirectory } from "./tenant-directory.js";
import { TenantStorageError, type TenantKeyWrapper } from "./tenant-crypto.js";
import { TenantWorkspaces, nodeTenantIdentity } from "./tenant-workspaces.js";
import { botSchema } from "./workspace-validation.js";
import { lockCatalogRoot } from "./catalog-lock.js";
import { readCatalogBody } from "./http-body.js";

const uuid = "[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}";
const workspaceRoute = new RegExp(`^/v1/workspaces/(${uuid})(?:/(snapshot|bots|events|goals)(?:/(${uuid}))?)?$`);
const invalid = () => new TenantAccessError(400, "invalid_request", "Invalid request.");
const missing = () => new TenantAccessError(404, "not_found", "Resource is unavailable.");
function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Vary": "Authorization, DPoP" }); res.end(JSON.stringify(value));
}
function query(url: URL, allowed: readonly string[]): void {
  for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw invalid();
}

/** Opt-in, storage-only hosted server with real multi-account NodeAuth.
 * Never constructs ControlService/Host or accepts work. Operator methods below
 * are in-process APIs, NOT HTTP/IPC/Agent methods. An account admin has no
 * authority to provision accounts, grant membership or reset other customers.
 * Standard desktop v1 is intentionally incompatible until workspace UX lands. */
export class HostedCatalogServer {
  readonly http: Server;
  readonly auth: NodeAuth;
  readonly directory: TenantDirectory;
  readonly workspaces: TenantWorkspaces;
  readonly config: NodeConfig;
  #closing: Promise<void> | undefined;
  #unlock: () => void;
  #inflight = new Map<string, number>();
  #active = 0;
  constructor(options: { config: NodeConfig; dataDir: string; keyWrapper: TenantKeyWrapper }) {
    this.config = validateConfig(options.config);
    const root = privateDirectory(options.dataDir);
    if (existsSync(path.join(root, "auth.sqlite")) || existsSync(path.join(root, "control.sqlite"))) {
      throw new Error("Use a separate hosted data directory. Legacy Node data is never implicitly adopted.");
    }
    const tls = this.config.tls ? { cert: readFileSync(this.config.tls.certFile), key: readFileSync(this.config.tls.keyFile), minVersion: "TLSv1.3" as const } : undefined;
    this.#unlock = lockCatalogRoot(root, this.config.nodeId, this.config.publicUrl);
    try { this.auth = new NodeAuth({ dataDir: privateDirectory(path.join(root, "accounts")), issuer: this.config.publicUrl, accountMode: "invited" }); }
    catch (e) { this.#unlock(); throw e; }
    try { this.directory = new TenantDirectory(path.join(root, "tenants"), [this.config.publicUrl]); }
    catch (e) { this.auth.close(); this.#unlock(); throw e; }
    try { this.workspaces = new TenantWorkspaces(this.directory, options.keyWrapper); }
    catch (e) { this.directory.close(); this.auth.close(); this.#unlock(); throw e; }
    const listener = (req: IncomingMessage, res: ServerResponse) => { void this.route(req, res).catch(e => this.failure(res, e)); };
    this.http = tls ? createHttpsServer(tls, listener) : createHttpServer(listener);
    this.http.requestTimeout = 30_000; this.http.headersTimeout = 15_000; this.http.keepAliveTimeout = 5_000;
    this.http.maxHeadersCount = 64;
    // No compatibility fallback into legacy unscoped event streams.
    this.http.on("upgrade", (_req, socket) => socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n"));
  }
  /** Operator-only, resumable workspace creation for an existing account.
   * No HTTP route calls this, and no identity fields are copied from requests. */
  async provisionWorkspace(principalId: string, command: string, name: string): Promise<string> {
    const read = () => {
      if (this.#closing || !this.auth.hasInvitedAccount(principalId)) throw missing();
      return { issuer: this.config.publicUrl, subject: principalId, deviceRole: "admin" as const, botIds: "*" as const };
    };
    return this.workspaces.provision(read, command, name);
  }
  private failure(res: ServerResponse, error: unknown): void {
    if (res.destroyed || res.writableEnded) return;
    if (res.headersSent) { res.destroy(); return; }
    const known = error instanceof TenantAccessError || error instanceof TenantStorageError || error instanceof NodeAuthError || error instanceof ControlError || error instanceof EnrollmentError;
    const status = error instanceof z.ZodError ? 400 : known ? error.status : 500;
    const code = error instanceof z.ZodError ? "invalid_request" : known ? error.code : "internal_error";
    if (status === 401) res.setHeader("WWW-Authenticate", `DPoP error="${code === "use_dpop_nonce" ? "use_dpop_nonce" : "invalid_token"}"`);
    // Never serialize raw crypto/provider/SQLite errors or untrusted input.
    json(res, status, { error: code, message: status === 503 ? "Workspace is unavailable; no new task was accepted." : "Request could not be completed. Check authorization and request options." });
  }
  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.#closing) throw new TenantAccessError(503, "unavailable", "Server is closing.");
    res.setHeader("DPoP-Nonce", this.auth.getDpopNonce());
    const raw = req.url ?? "/", origin = this.config.publicUrl, url = new URL(raw, origin);
    if (raw.length > 2048 || !raw.startsWith("/") || raw.startsWith("//") || /[\\#]/.test(raw) ||
        raw.split("?")[0] !== url.pathname || url.origin !== origin || req.headers.host !== new URL(origin).host) throw invalid();
    if (req.method === "GET" && url.pathname === "/health") { query(url, []); json(res, 200, { ok: true, mode: "hosted-catalog", execution: "unavailable" }); return; }
    if (req.method === "GET" && url.pathname === "/v1/node") {
      query(url, []); json(res, 200, { id: this.config.nodeId, nodeId: this.config.nodeId, name: this.config.name,
        protocolVersion: 2, hostingProtocolVersion: 1, mode: "hosted-catalog", eventTransport: "poll",
        execution: "unavailable", registration: "operator-only", security: { dpopRequired: true, trustedDevicesRequired: true } }); return;
    }
    if (await this.auth.handle(req, res, url)) return;
    if (req.headers.origin !== undefined) throw new TenantAccessError(403, "browser_origin", "Use an authorized native client.");
    for (const name of ["authorization", "dpop"]) {
      if (req.rawHeaders.filter((s, i) => i % 2 === 0 && s.toLowerCase() === name).length !== 1) throw new NodeAuthError(401, "invalid_token", "One device-bound authorization is required.");
    }
    const identity = this.auth.authenticate(req); // Verify the single-use proof exactly once.
    const lifetime = new AbortController(), baseRead = nodeTenantIdentity(this.auth, origin, identity);
    const ended = () => lifetime.abort();
    const read = () => { if (lifetime.signal.aborted || this.#closing) throw new NodeAuthError(401, "invalid_token", "Request ended."); return baseRead(); };
    res.once("close", ended); req.once("aborted", ended);
    const count = this.#inflight.get(identity.principalId) ?? 0;
    if (this.#active >= 32 || count >= 4) {
      res.off("close", ended); req.off("aborted", ended); res.setHeader("Retry-After", "1");
      throw new TenantAccessError(429, "request_capacity", "Too many concurrent requests.");
    }
    this.#active++; this.#inflight.set(identity.principalId, count + 1);
    try {
      if (req.method === "GET" && (req.headers["transfer-encoding"] !== undefined || Number(req.headers["content-length"] ?? 0) !== 0)) throw invalid();
      if (["x-tenant-id", "x-user-id", "x-account-id"].some(name => req.headers[name] !== undefined)) throw invalid();
      if (url.pathname === "/v1/workspaces" && req.method === "GET") {
        query(url, ["after"]); json(res, 200, this.directory.memberships(read, url.searchParams.get("after") ?? "")); return;
      }
      // Account-scoped administration only. No platform/tenant membership writes.
      if (url.pathname === "/v1/security/sessions" && req.method === "GET") { query(url, []); json(res, 200, this.auth.listSessions(identity)); return; }
      const approval = new RegExp(`^/v1/security/requests/(${uuid})/(approve|deny)$`).exec(url.pathname);
      if (approval && req.method === "POST") {
        query(url, []); this.auth.requireRecentAdministrator(identity);
        const input = z.object({ expectedVersion: z.number().int().positive(), thumbprint: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          ...(approval[2] === "approve" ? { grant: z.unknown() } : {}) }).strict().parse(await readCatalogBody(req, lifetime.signal));
        read(); const grant = approval[2] === "approve" ? this.auth.validateGrant((input as { grant: unknown }).grant) : undefined;
        // Until cross-workspace Bot scope selection is exposed, grant only known
        // role ceilings with wildcard scope; per-Bot expansion has no shortcut.
        if (grant && grant.botIds !== "*") throw invalid();
        this.auth.decideDevice(identity, approval[1]!, input.expectedVersion, input.thumbprint, grant);
        json(res, 200, { ok: true }); return;
      }
      const block = /^\/v1\/security\/devices\/([A-Za-z0-9_-]{43})\/block$/.exec(url.pathname);
      if (block && req.method === "POST") {
        query(url, []); this.auth.requireRecentAdministrator(identity);
        const input = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(await readCatalogBody(req, lifetime.signal));
        read(); this.auth.blockDevice(identity, block[1]!, input.expectedVersion); json(res, 200, { ok: true }); return;
      }
      const match = workspaceRoute.exec(url.pathname);
      if (!match) throw missing();
      const [, id, action, botId] = match;
      const scope = this.directory.scope(read, id!); // Select AND authorize; URL is not authority.
      query(url, action === "events" ? ["after"] : []);
      if (req.method === "GET" && !action) { const result = await this.workspaces.describe(scope); this.directory.assert(scope, "read"); json(res, 200, result); return; }
      if (req.method === "GET" && action === "snapshot" && !botId) { const result = await this.workspaces.snapshot(scope); this.directory.assert(scope, "read"); json(res, 200, { workspaceId: id, ...result }); return; }
      if (req.method === "GET" && action === "bots" && botId) { const bot = await this.workspaces.bot(scope, botId); this.directory.assert(scope, "read", botId); json(res, 200, { workspaceId: id, bot }); return; }
      if (req.method === "GET" && action === "events" && !botId) {
        const cursor = url.searchParams.get("after") ?? "0";
        if (!/^(0|[1-9][0-9]{0,15})$/.test(cursor)) throw invalid();
        const result = await this.workspaces.events(scope, Number(cursor)); this.directory.assert(scope, "read");
        json(res, 200, { workspaceId: id, ...result }); return;
      }
      if (req.method === "POST" && action === "bots" && !botId) {
        this.directory.assert(scope, "write");
        const keys = req.rawHeaders.filter((s, i) => i % 2 === 0 && s.toLowerCase() === "idempotency-key");
        const key = req.headers["idempotency-key"];
        if (keys.length !== 1 || typeof key !== "string" || !/^[\w.:-]{8,128}$/.test(key)) throw invalid();
        const input = botSchema.parse(await readCatalogBody(req, lifetime.signal));
        const result = await this.workspaces.createBot(scope, key, input);
        this.directory.assert(scope, "read", result.bot.id); json(res, 201, { workspaceId: id, ...result }); return;
      }
      if (req.method === "POST" && action === "goals" && !botId) {
        const input = z.object({ botId: z.string().uuid(), prompt: z.string().min(1).max(64000) }).strict().parse(await readCatalogBody(req, lifetime.signal));
        await this.workspaces.submitGoal(scope, input.botId); return;
      }
      throw missing();
    } finally {
      res.off("close", ended); req.off("aborted", ended);
      this.#active--; const left = (this.#inflight.get(identity.principalId) ?? 1) - 1;
      if (left) this.#inflight.set(identity.principalId, left); else this.#inflight.delete(identity.principalId);
    }
  }
  async listen(): Promise<void> {
    if (this.#closing) throw new Error("Server is closing.");
    await new Promise<void>((resolve, reject) => {
      const failed = (e: Error) => { this.http.off("listening", ready); reject(e); };
      const ready = () => { this.http.off("error", failed); resolve(); };
      this.http.once("error", failed); this.http.once("listening", ready); this.http.listen(this.config.port, this.config.bindHost);
    });
  }
  close(): Promise<void> {
    return this.#closing ??= (async () => {
      const stopped = new Promise<void>(resolve => this.http.close(() => resolve())); this.http.closeAllConnections();
      try { await this.workspaces.close(); await stopped; }
      finally { this.directory.close(); this.auth.close(); this.#unlock(); }
    })();
  }
}
