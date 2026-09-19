import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const CLIENT_ID = "beebot-desktop";
const SCOPE = "owner:node";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ACCESS_TTL = 10 * MINUTE;
const SESSION_IDLE_TTL = 30 * DAY;
const SESSION_ABSOLUTE_TTL = 90 * DAY;
const FORM_TTL = 10 * MINUTE;
const BODY_LIMIT = 16 * 1024;

export class NodeAuthError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "NodeAuthError";
  }
}

type Identity = { principalId: string; sessionId: string };
type Owner = { principal_id: string; username: string; salt: string; password_hash: string };
type Session = { id: string; principal_id: string; idle_expires: number; absolute_expires: number; revoked_at: number | null };
type AuthRequest = { redirectUri: string; challenge: string; state: string; deviceName: string };
type Form = { kind: "setup" | "authorize"; expires: number; csrfHash: string; request?: AuthRequest };
type Code = { hash: string; principal_id: string; redirect_uri: string; challenge: string; device_name: string; expires: number; session_id: string | null };
type Token = { hash: string; kind: string; session_id: string; expires: number; used_at: number | null };

function secret(): string { return randomBytes(32).toString("base64url"); }
function digest(value: string): string { return createHash("sha256").update(value).digest("base64url"); }
function equalDigest(a: string, b: string): boolean {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function invalid(message = "Authentication required"): NodeAuthError {
  return new NodeAuthError(401, "invalid_token", message);
}
function bad(message: string, code = "invalid_request"): NodeAuthError {
  return new NodeAuthError(400, code, message);
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

// Node's built-in asynchronous scrypt avoids an additional native dependency.
// N=2^17, r=8, p=1 uses about 128 MiB, with at most two derivations in flight.
function derivePassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, Buffer.from(salt, "base64url"), 64, {
      N: 131_072, r: 8, p: 1, maxmem: 256 * 1024 * 1024,
    }, (error, result) => error ? reject(error) : resolve(result));
  });
}

function responseJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function html(res: ServerResponse, title: string, body: string, status = 200): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · BeeBot</title><style>body{font:16px/1.6 system-ui,sans-serif;background:#f7f7f5;color:#202324;margin:0;padding:64px 24px}main{max-width:480px;margin:auto;background:white;border:1px solid #deded8;border-radius:16px;padding:32px}h1{font-size:26px}label{display:block;margin:16px 0 4px}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #aaa;border-radius:8px;font:inherit}button{font:inherit;cursor:pointer;padding:12px 20px;border:0;border-radius:8px;background:#263b2f;color:white;margin-top:24px}small{display:block;color:#626862}code{overflow-wrap:anywhere}a{color:#285f42}.secondary{background:#eee;color:#333;margin-left:8px}</style><main><small>BEEBOT · 私有节点</small><h1>${escapeHtml(title)}</h1>${body}</main></html>`);
}

function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const contentType = req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw new NodeAuthError(415, "invalid_request", "Use application/x-www-form-urlencoded");
  }
  const declared = Number(req.headers["content-length"] ?? 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > BODY_LIMIT) {
    throw new NodeAuthError(413, "invalid_request", "Request body too large");
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0; let done = false;
    const timer = setTimeout(() => finish(new NodeAuthError(408, "invalid_request", "Request body timed out")), 10_000);
    timer.unref();
    function finish(error?: Error): void {
      if (done) return; done = true; clearTimeout(timer);
      req.off("data", onData); req.off("end", onEnd); req.off("aborted", onAborted); req.off("error", onError);
      if (error) { req.resume(); reject(error); }
      else {
        const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
        for (const key of form.keys()) {
          if (form.getAll(key).length !== 1) { reject(bad("Repeated form parameter")); return; }
        }
        resolve(form);
      }
    }
    function onData(chunk: Buffer | string): void {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += value.length;
      if (bytes > BODY_LIMIT) finish(new NodeAuthError(413, "invalid_request", "Request body too large"));
      else chunks.push(value);
    }
    function onEnd(): void { finish(); }
    function onAborted(): void { finish(bad("Request aborted")); }
    function onError(): void { finish(bad("Could not read request")); }
    req.on("data", onData); req.on("end", onEnd); req.on("aborted", onAborted); req.on("error", onError);
  });
}

/** Self-hosted single-owner authentication. Never exposes old Host RPC methods. */
export class NodeAuth {
  private readonly db: DatabaseSync;
  private readonly issuer: string;
  private readonly origin: string;
  private readonly cookieName: string;
  private setupCode: string | undefined;
  private readonly setupExpires = Date.now() + FORM_TTL;
  private readonly forms = new Map<string, Form>();
  private readonly tickets = new Map<string, Identity & { expires: number }>();
  private readonly limits = new Map<string, { count: number; expires: number }>();
  private passwordJobs = 0;
  private closed = false;

  constructor({ dataDir, issuer }: { dataDir: string; issuer: string }) {
    const address = new URL(issuer);
    if (address.username || address.password || address.search || address.hash || (address.pathname !== "/" && address.pathname !== "") ||
      (address.protocol !== "https:" && !(address.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(address.hostname)))) {
      throw new Error("Authentication issuer requires an HTTPS origin (HTTP is allowed only on loopback)");
    }
    this.issuer = address.origin;
    this.origin = address.origin;
    this.cookieName = address.protocol === "https:" ? "__Host-beebot_browser" : "beebot_browser";
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const dbPath = path.join(dataDir, "auth.sqlite");
    if (existsSync(dbPath) && (!lstatSync(dbPath).isFile() || lstatSync(dbPath).isSymbolicLink())) {
      throw new Error("Authentication database must be a regular file");
    }
    closeSync(openSync(dbPath, "a", 0o600));
    chmodSync(dbPath, 0o600);
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS owner (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), principal_id TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL,
        password_scheme TEXT NOT NULL DEFAULT 'scrypt-n131072-r8-p1', created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY, principal_id TEXT NOT NULL REFERENCES owner(principal_id), device_name TEXT NOT NULL,
        created_at INTEGER NOT NULL, last_refreshed_at INTEGER NOT NULL, idle_expires INTEGER NOT NULL,
        absolute_expires INTEGER NOT NULL, revoked_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS auth_codes (
        hash TEXT PRIMARY KEY, principal_id TEXT NOT NULL REFERENCES owner(principal_id), redirect_uri TEXT NOT NULL,
        challenge TEXT NOT NULL, device_name TEXT NOT NULL, expires INTEGER NOT NULL, session_id TEXT
      );
      CREATE TABLE IF NOT EXISTS auth_tokens (
        hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('access','refresh')),
        session_id TEXT NOT NULL REFERENCES auth_sessions(id), expires INTEGER NOT NULL, used_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS auth_tokens_session ON auth_tokens(session_id);
    `);
    for (const suffix of ["-wal", "-shm"]) if (existsSync(`${dbPath}${suffix}`)) chmodSync(`${dbPath}${suffix}`, 0o600);
    if (!this.owner()) this.setupCode = secret();
  }

  getSetupInfo(): { required: boolean; code?: string } {
    if (this.owner()) return { required: false };
    return this.setupCode && Date.now() < this.setupExpires ? { required: true, code: this.setupCode } : { required: true };
  }

  authenticate(req: IncomingMessage): Identity {
    const auth = req.headers.authorization;
    if (!auth || !/^Bearer [A-Za-z0-9_-]{43}$/i.test(auth)) throw invalid();
    const token = this.db.prepare("SELECT * FROM auth_tokens WHERE hash=? AND kind='access'").get(digest(auth.slice(7))) as Token | undefined;
    if (!token || token.expires <= Date.now()) throw invalid("Session expired or revoked");
    const session = this.activeSession(token.session_id);
    return { principalId: session.principal_id, sessionId: session.id };
  }

  assertSession(sessionId: string): void { this.activeSession(sessionId); }

  createEventTicket(req: IncomingMessage): { ticket: string } {
    const identity = this.authenticate(req); this.prune();
    if (this.tickets.size >= 1000) throw new NodeAuthError(429, "temporarily_unavailable", "Too many pending event connections");
    const ticket = secret();
    this.tickets.set(digest(ticket), { ...identity, expires: Date.now() + 30_000 });
    return { ticket };
  }

  redeemEventTicket(ticket: string): Identity {
    const key = digest(ticket); const entry = this.tickets.get(key); this.tickets.delete(key);
    if (!entry || entry.expires <= Date.now()) throw invalid("Event ticket expired or already used");
    this.assertSession(entry.sessionId);
    return { principalId: entry.principalId, sessionId: entry.sessionId };
  }

  close(): void { if (!this.closed) { this.closed = true; this.forms.clear(); this.tickets.clear(); this.db.close(); } }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const route = url.pathname;
    if (!["/setup", "/oauth/authorize", "/oauth/token", "/oauth/revoke", "/.well-known/oauth-authorization-server"].includes(route)) return false;
    this.securityHeaders(res);
    try {
      this.prune();
      if (route === "/.well-known/oauth-authorization-server") {
        this.method(req, "GET");
        responseJson(res, 200, {
          issuer: this.issuer, authorization_endpoint: `${this.issuer}/oauth/authorize`, token_endpoint: `${this.issuer}/oauth/token`,
          revocation_endpoint: `${this.issuer}/oauth/revoke`, response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"], revocation_endpoint_auth_methods_supported: ["none"], scopes_supported: [SCOPE],
          authorization_response_iss_parameter_supported: true,
        });
      } else if (route === "/setup") {
        await this.setup(req, res, url);
      } else if (route === "/oauth/authorize") {
        await this.authorize(req, res, url);
      } else {
        this.method(req, "POST"); this.checkOrigin(req, false);
        this.limit(`token:${req.socket.remoteAddress ?? "unknown"}`, 120, MINUTE);
        const form = await readForm(req);
        if (form.get("client_id") !== CLIENT_ID) throw bad("Unknown public client", "invalid_client");
        if (route === "/oauth/revoke") {
          const token = form.get("token"); if (!token || token.length > 512) throw bad("Missing token");
          const row = this.db.prepare("SELECT session_id FROM auth_tokens WHERE hash=?").get(digest(token)) as { session_id: string } | undefined;
          if (row) this.revokeSession(row.session_id);
          responseJson(res, 200, {});
        } else {
          const grant = form.get("grant_type");
          if (grant === "authorization_code") responseJson(res, 200, this.exchangeCode(form));
          else if (grant === "refresh_token") responseJson(res, 200, this.refresh(form));
          else throw bad("Unsupported grant type", "unsupported_grant_type");
        }
      }
    } catch (error) {
      const safe = error instanceof NodeAuthError ? error : new NodeAuthError(503, "temporarily_unavailable", "Authentication service unavailable");
      if (safe.status === 429) res.setHeader("Retry-After", "60");
      if (safe.status === 405) res.setHeader("Allow", route === "/setup" || route === "/oauth/authorize" ? "GET, POST" : route.startsWith("/.well-known/") ? "GET" : "POST");
      if (!res.headersSent) responseJson(res, safe.status, { error: safe.code, error_description: safe.message });
      else res.end();
    }
    return true;
  }

  private owner(): Owner | undefined { return this.db.prepare("SELECT * FROM owner WHERE singleton=1").get() as Owner | undefined; }

  private activeSession(id: string): Session {
    const row = this.db.prepare("SELECT * FROM auth_sessions WHERE id=?").get(id) as Session | undefined;
    if (!row || row.revoked_at !== null || row.idle_expires <= Date.now() || row.absolute_expires <= Date.now()) throw invalid("Session expired or revoked");
    return row;
  }

  private revokeSession(id: string): void {
    this.db.prepare("UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE id=?").run(Date.now(), id);
    for (const [key, ticket] of this.tickets) if (ticket.sessionId === id) this.tickets.delete(key);
  }

  private transaction<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = run(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private issueTokens(session: Session): Record<string, unknown> {
    const now = Date.now(); const access = secret(); const refresh = secret();
    const accessExpires = Math.min(now + ACCESS_TTL, session.absolute_expires);
    const refreshExpires = Math.min(now + SESSION_IDLE_TTL, session.absolute_expires);
    this.db.prepare("INSERT INTO auth_tokens(hash,kind,session_id,expires) VALUES (?,'access',?,?)").run(digest(access), session.id, accessExpires);
    this.db.prepare("INSERT INTO auth_tokens(hash,kind,session_id,expires) VALUES (?,'refresh',?,?)").run(digest(refresh), session.id, refreshExpires);
    this.db.prepare("UPDATE auth_sessions SET last_refreshed_at=?,idle_expires=? WHERE id=?").run(now, refreshExpires, session.id);
    return { access_token: access, token_type: "Bearer", expires_in: Math.max(0, Math.floor((accessExpires - now) / 1000)), refresh_token: refresh, scope: SCOPE };
  }

  private exchangeCode(form: URLSearchParams): Record<string, unknown> {
    const code = form.get("code") ?? ""; const verifier = form.get("code_verifier") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(code) || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw bad("Invalid authorization grant", "invalid_grant");
    const result = this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM auth_codes WHERE hash=?").get(digest(code)) as Code | undefined;
      if (!row || row.expires <= Date.now() || row.redirect_uri !== form.get("redirect_uri") || !equalDigest(row.challenge, digest(verifier))) {
        throw bad("Invalid authorization grant", "invalid_grant");
      }
      // Commit replay-triggered revocation before returning the protocol error.
      if (row.session_id) { this.revokeSession(row.session_id); return null; }
      const now = Date.now(); const id = randomUUID();
      this.db.prepare("INSERT INTO auth_sessions(id,principal_id,device_name,created_at,last_refreshed_at,idle_expires,absolute_expires) VALUES (?,?,?,?,?,?,?)")
        .run(id, row.principal_id, row.device_name, now, now, now + SESSION_IDLE_TTL, now + SESSION_ABSOLUTE_TTL);
      this.db.prepare("UPDATE auth_codes SET session_id=? WHERE hash=? AND session_id IS NULL").run(id, row.hash);
      return this.issueTokens(this.activeSession(id));
    });
    if (!result) throw bad("Authorization code already used", "invalid_grant");
    return result;
  }

  private refresh(form: URLSearchParams): Record<string, unknown> {
    const value = form.get("refresh_token") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw bad("Invalid refresh token", "invalid_grant");
    const result = this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM auth_tokens WHERE hash=? AND kind='refresh'").get(digest(value)) as Token | undefined;
      if (!row) throw bad("Invalid refresh token", "invalid_grant");
      if (row.used_at !== null) { this.revokeSession(row.session_id); return null; }
      let session: Session;
      try { session = this.activeSession(row.session_id); } catch { throw bad("Session expired or revoked", "invalid_grant"); }
      if (row.expires <= Date.now()) throw bad("Refresh token expired", "invalid_grant");
      this.db.prepare("UPDATE auth_tokens SET used_at=? WHERE hash=?").run(Date.now(), row.hash);
      return this.issueTokens(session);
    });
    if (!result) throw bad("Refresh token reuse detected; sign in again", "invalid_grant");
    return result;
  }

  private async setup(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (this.owner()) throw new NodeAuthError(409, "already_initialized", "This node already has an owner");
    if (!this.setupCode || Date.now() >= this.setupExpires) throw new NodeAuthError(410, "setup_expired", "Setup link expired; restart the node to generate a new link");
    if (req.method === "GET") {
      this.limit(`setup-get:${req.socket.remoteAddress ?? "unknown"}`, 20, MINUTE);
      if (!equalDigest(digest(url.searchParams.get("code") ?? ""), digest(this.setupCode))) throw new NodeAuthError(403, "access_denied", "Invalid setup link");
      const fields = this.newForm(req, res, { kind: "setup" });
      html(res, "设置节点所有者", `<p>此节点由你独立管理。请创建登录账号，随后从 BeeBot Mac 客户端连接。</p><form method="post" action="/setup">${fields}<label for="username">用户名</label><input id="username" name="username" autocomplete="username" minlength="3" maxlength="64" required><label for="password">密码（至少 12 个字符）</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required><button type="submit">创建所有者账号</button></form>`);
      return;
    }
    this.method(req, "POST"); this.checkOrigin(req, true);
    this.limit(`setup-post:${req.socket.remoteAddress ?? "unknown"}`, 5, FORM_TTL);
    const form = await readForm(req); this.verifyForm(req, form, "setup");
    const username = (form.get("username") ?? "").trim(); const password = form.get("password") ?? "";
    if (!/^[A-Za-z0-9_.@-]{3,64}$/.test(username)) throw bad("Username must contain 3–64 letters, digits, dots, underscores, @ or hyphens");
    if (password.length < 12 || password.length > 1024) throw bad("Password must contain 12–1024 characters");
    const salt = secret(); const passwordHash = await this.password(password, salt);
    this.transaction(() => {
      if (this.owner()) throw new NodeAuthError(409, "already_initialized", "This node already has an owner");
      if (!this.setupCode || Date.now() >= this.setupExpires) throw new NodeAuthError(410, "setup_expired", "Setup link expired");
      this.db.prepare("INSERT INTO owner(singleton,principal_id,username,salt,password_hash,created_at) VALUES (1,?,?,?,?,?)")
        .run(`owner:${randomUUID()}`, username, salt, passwordHash.toString("base64url"), Date.now());
    });
    this.setupCode = undefined;
    html(res, "节点已就绪", `<p>所有者账号已创建。在 BeeBot 客户端添加以下服务器地址：</p><p><code>${escapeHtml(this.issuer)}</code></p><p>随后点击连接，在浏览器中登录并确认授权。</p>`);
  }

  private async authorize(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (!this.owner()) throw new NodeAuthError(409, "setup_required", "The node owner must complete setup first");
    if (req.method === "GET") {
      this.limit(`authorize-get:${req.socket.remoteAddress ?? "unknown"}`, 40, MINUTE);
      const request = this.authorizationRequest(url);
      this.allowCallback(res, request.redirectUri);
      const fields = this.newForm(req, res, { kind: "authorize", request });
      html(res, "连接 BeeBot 客户端", `<p>设备名称：<strong>${escapeHtml(request.deviceName)}</strong></p><p>应用：BeeBot Desktop<br>节点：<code>${escapeHtml(this.issuer)}</code></p><p>授权后，此设备可以管理该节点的 Bot、对话、任务和设置。设备名称由客户端提供，仅供识别。</p><form method="post" action="/oauth/authorize">${fields}<label for="username">用户名</label><input id="username" name="username" autocomplete="username" maxlength="64" required><label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="1024" required><button type="submit" name="decision" value="allow">登录并授权此设备</button><button type="submit" name="decision" value="deny" class="secondary" formnovalidate>取消</button></form>`);
      return;
    }
    this.method(req, "POST"); this.checkOrigin(req, true);
    const form = await readForm(req); const flow = this.verifyForm(req, form, "authorize"); const request = flow.request!;
    this.allowCallback(res, request.redirectUri);
    if (form.get("decision") === "deny") { this.redirect(res, request, { error: "access_denied" }); return; }
    if (form.get("decision") !== "allow") throw bad("Explicit device authorization is required");
    this.limit(`login:${req.socket.remoteAddress ?? "unknown"}`, 10, 15 * MINUTE);
    this.limit("login-global", 30, 15 * MINUTE);
    const username = (form.get("username") ?? "").trim(); const password = form.get("password") ?? "";
    if (username.length > 64 || password.length > 1024) throw bad("Invalid credentials", "access_denied");
    const owner = this.owner()!; const candidate = await this.password(password, owner.salt);
    if (!timingSafeEqual(candidate, Buffer.from(owner.password_hash, "base64url")) || username !== owner.username) {
      throw new NodeAuthError(401, "access_denied", "Incorrect username or password; reopen the connection request to try again");
    }
    const code = secret();
    this.db.prepare("INSERT INTO auth_codes(hash,principal_id,redirect_uri,challenge,device_name,expires) VALUES (?,?,?,?,?,?)")
      .run(digest(code), owner.principal_id, request.redirectUri, request.challenge, request.deviceName, Date.now() + MINUTE);
    this.redirect(res, request, { code });
  }

  private authorizationRequest(url: URL): AuthRequest {
    for (const key of url.searchParams.keys()) if (url.searchParams.getAll(key).length !== 1) throw bad("Repeated authorization parameter");
    const query = url.searchParams;
    if (query.get("client_id") !== CLIENT_ID) throw bad("Unknown public client", "unauthorized_client");
    const redirectUri = query.get("redirect_uri") ?? "";
    // Match the original string as well as parsing it: URL normalization must not
    // broaden the registered loopback callback to alternate IP forms or paths.
    if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/oauth\/callback$/.test(redirectUri)) throw bad("Unregistered redirect URI");
    let redirect: URL;
    try { redirect = new URL(redirectUri); } catch { throw bad("Invalid redirect URI"); }
    if (Number(redirect.port || "80") < 1024 || Number(redirect.port) > 65535) throw bad("Use an ephemeral loopback callback port");
    if (query.get("response_type") !== "code") throw bad("Only authorization code flow is supported", "unsupported_response_type");
    if (query.get("code_challenge_method") !== "S256") throw bad("PKCE S256 is required");
    const challenge = query.get("code_challenge") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw bad("Invalid PKCE challenge");
    const state = query.get("state") ?? "";
    if (state.length < 16 || state.length > 512 || /[\u0000-\u001f\u007f]/.test(state)) throw bad("A random state of 16–512 characters is required");
    if (query.has("scope") && query.get("scope") !== SCOPE) throw bad("Unsupported scope", "invalid_scope");
    const deviceName = (query.get("device_name") ?? "BeeBot Desktop").trim();
    if (!deviceName || deviceName.length > 80 || /[\u0000-\u001f\u007f]/.test(deviceName)) throw bad("Invalid device name");
    return { redirectUri, state, challenge, deviceName };
  }

  private redirect(res: ServerResponse, request: AuthRequest, response: Record<string, string>): void {
    const target = new URL(request.redirectUri);
    for (const [key, value] of Object.entries(response)) target.searchParams.set(key, value);
    target.searchParams.set("state", request.state);
    target.searchParams.set("iss", this.issuer);
    res.writeHead(303, { Location: target.href }); res.end();
  }

  private newForm(req: IncomingMessage, res: ServerResponse, input: Pick<Form, "kind" | "request">): string {
    if (this.forms.size >= 1000) throw new NodeAuthError(429, "temporarily_unavailable", "Too many pending sign-in requests");
    const existing = this.cookie(req); const csrf = existing && /^[A-Za-z0-9_-]{43}$/.test(existing) ? existing : secret();
    const id = secret();
    this.forms.set(id, { ...input, expires: Date.now() + FORM_TTL, csrfHash: digest(csrf) });
    res.setHeader("Set-Cookie", `${this.cookieName}=${csrf}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${this.issuer.startsWith("https:") ? "; Secure" : ""}`);
    return `<input type="hidden" name="flow_id" value="${id}"><input type="hidden" name="csrf" value="${csrf}">`;
  }

  private verifyForm(req: IncomingMessage, body: URLSearchParams, kind: Form["kind"]): Form {
    const id = body.get("flow_id") ?? ""; const form = this.forms.get(id);
    const cookie = this.cookie(req); const csrf = body.get("csrf") ?? "";
    if (!form || form.expires <= Date.now() || form.kind !== kind || !cookie || !equalDigest(form.csrfHash, digest(cookie)) || !equalDigest(form.csrfHash, digest(csrf))) {
      throw new NodeAuthError(403, "access_denied", "Invalid or expired browser form");
    }
    this.forms.delete(id); return form;
  }

  private cookie(req: IncomingMessage): string | undefined {
    return req.headers.cookie?.split(";").map(part => part.trim()).find(part => part.startsWith(`${this.cookieName}=`))?.slice(this.cookieName.length + 1);
  }

  private async password(value: string, salt: string): Promise<Buffer> {
    if (this.passwordJobs >= 2) throw new NodeAuthError(429, "temporarily_unavailable", "Too many password attempts; try again shortly");
    this.passwordJobs += 1;
    try { return await derivePassword(value, salt); } finally { this.passwordJobs -= 1; }
  }

  private checkOrigin(req: IncomingMessage, required: boolean): void {
    const origin = req.headers.origin;
    if ((required && !origin) || (origin && origin !== this.origin)) throw new NodeAuthError(403, "access_denied", "Cross-origin authentication request rejected");
    if (required && req.headers["sec-fetch-site"] === "cross-site") throw new NodeAuthError(403, "access_denied", "Cross-site form rejected");
  }

  private method(req: IncomingMessage, expected: string): void {
    if (req.method !== expected) throw new NodeAuthError(405, "invalid_request", "Method not allowed");
  }

  private limit(key: string, maximum: number, period: number): void {
    const now = Date.now(); let limit = this.limits.get(key);
    if (!limit && this.limits.size >= 10_000) throw new NodeAuthError(429, "temporarily_unavailable", "Authentication service is busy; try again later");
    if (!limit || limit.expires <= now) { limit = { count: 0, expires: now + period }; this.limits.set(key, limit); }
    limit.count += 1;
    if (limit.count > maximum) throw new NodeAuthError(429, "temporarily_unavailable", "Too many authentication attempts; try again later");
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, form] of this.forms) if (form.expires <= now) this.forms.delete(id);
    for (const [id, ticket] of this.tickets) if (ticket.expires <= now) this.tickets.delete(id);
    for (const [key, limit] of this.limits) if (limit.expires <= now) this.limits.delete(key);
    // Used refresh tokens stay until family expiry, so replay still revokes the family.
    this.db.prepare("DELETE FROM auth_codes WHERE expires < ?").run(now - DAY);
    this.db.prepare("DELETE FROM auth_tokens WHERE (kind='access' AND expires < ?) OR session_id IN (SELECT id FROM auth_sessions WHERE absolute_expires < ?)").run(now - DAY, now);
    this.db.prepare("DELETE FROM auth_sessions WHERE absolute_expires < ?").run(now);
  }

  private securityHeaders(res: ServerResponse): void {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Pragma", "no-cache");
    // Chromium makes a native form POST's Origin opaque under no-referrer.
    // Keep the same-origin Origin for strict CSRF checks, while withholding
    // Referer entirely on the cross-origin native-client callback redirect.
    res.setHeader("Referrer-Policy", "same-origin"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    if (this.issuer.startsWith("https:")) res.setHeader("Strict-Transport-Security", "max-age=31536000");
  }

  private allowCallback(res: ServerResponse, callback: string): void {
    // Browsers may also apply form-action to the 303 redirect after login.
    // Only this request's strictly validated registered callback is allowed.
    res.setHeader("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${callback}; frame-ancestors 'none'; base-uri 'none'`);
  }
}
