import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import WebSocket, { WebSocketServer } from "ws";
import { z } from "zod";
import { NodeAuth } from "./auth.js";
import { ControlError, ControlStore, type NodeEvent } from "./control-store.js";
import { ControlService, type BotRuntime } from "./control-service.js";
import type { NodeConfig } from "./config.js";
import { BOT_AVATAR_COLORS, BOT_AVATAR_SHAPES } from "../shared/agents/bot-avatar.js";

const botSchema = z.object({
  name: z.string().trim().min(1).max(100), description: z.string().max(8000).default(""),
  avatarColor: z.enum(BOT_AVATAR_COLORS).optional(), avatarShape: z.enum(BOT_AVATAR_SHAPES).optional(),
}).strict();
const goalSchema = z.object({ botId: z.string().uuid(), prompt: z.string().trim().min(1).max(64_000) }).strict();
const acceptSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
const reconcileSchema = z.object({ expectedVersion: z.number().int().positive(), note: z.string().trim().min(8).max(4000) }).strict();
function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(JSON.stringify(data));
}
async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers["content-type"]?.toLowerCase().startsWith("application/json")) throw new ControlError(415, "content_type", "Use application/json.");
  const parts: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk); size += bytes.length;
    if (size > 128 * 1024) throw new ControlError(413, "body_too_large", "Request is too large.");
    parts.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(parts).toString("utf8")); }
  catch { throw new ControlError(400, "invalid_json", "Invalid JSON request."); }
}
function readableTranscript(raw: unknown[]): unknown[] {
  return raw.map(value => {
    if (!value || typeof value !== "object") return value;
    const item = value as Record<string, unknown>;
    if (item.kind === "send-message" && item.message && typeof item.message === "object") {
      const message = item.message as Record<string, unknown>;
      if (typeof message.content === "string") return { ...item, role: "assistant", text: message.content };
    }
    if (typeof item.content === "string") return { ...item, text: item.content };
    return item;
  });
}

/** Public controller API. The much broader legacy Host RPC remains private on loopback. */
export class BeeBotServer {
  readonly store: ControlStore;
  readonly auth: NodeAuth;
  readonly service: ControlService;
  readonly http: Server;
  private readonly ws = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });
  private closing: Promise<void> | undefined;
  constructor(readonly options: { config: NodeConfig; dataDir: string; runtime: BotRuntime }) {
    const tls = options.config.tls ? { cert: readFileSync(options.config.tls.certFile), key: readFileSync(options.config.tls.keyFile), minVersion: "TLSv1.2" as const } : undefined;
    const listener = (req: IncomingMessage, res: ServerResponse) => { void this.route(req, res).catch(error => this.failure(res, error)); };
    this.http = tls ? createHttpsServer(tls, listener) : createHttpServer(listener);
    this.store = new ControlStore(options.dataDir);
    try { this.auth = new NodeAuth({ dataDir: options.dataDir, issuer: options.config.publicUrl }); }
    catch (error) { this.store.close(); throw error; }
    try { this.service = new ControlService(this.store, options.runtime, options.config.maxConcurrentRuns, false); }
    catch (error) { this.auth.close(); this.store.close(); throw error; }
    this.http.requestTimeout = 30_000; this.http.headersTimeout = 15_000; this.http.keepAliveTimeout = 5_000;
    this.http.on("upgrade", (req, socket, head) => {
      if (req.url !== "/v1/events" || req.headers.origin) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
      this.ws.handleUpgrade(req, socket, head, ws => this.eventSession(ws));
    });
  }
  get node(): { id: string; nodeId: string; name: string; protocolVersion: 1 } {
    const { nodeId, name } = this.options.config; return { id: nodeId, nodeId, name, protocolVersion: 1 };
  }
  private failure(res: ServerResponse, error: unknown): void {
    if (res.headersSent) { res.destroy(); return; }
    if (error instanceof z.ZodError) { json(res, 400, { error: "invalid_request", message: error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ") }); return; }
    const known = error && typeof error === "object" && "status" in error && typeof error.status === "number";
    json(res, known ? error.status as number : 500, {
      error: known && "code" in error ? error.code : "internal_error",
      message: known && error instanceof Error ? error.message : "The server could not complete this request.",
    });
    if (!known) console.error("[beebot-node] request failed", error);
  }
  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.options.config.publicUrl);
    if (url.origin !== this.options.config.publicUrl) throw new ControlError(400, "invalid_url", "Invalid request URL.");
    if (req.method === "GET" && url.pathname === "/health") { json(res, this.service.failure ? 503 : 200, { ok: !this.service.failure, protocolVersion: 1 }); return; }
    if (req.method === "GET" && url.pathname === "/v1/node") { json(res, 200, this.node); return; }
    if (await this.auth.handle(req, res, url)) return;
    // Native-client API uses bearer credentials and never accepts browser-origin requests.
    if (req.headers.origin) throw new ControlError(403, "browser_origin", "Use the BeeBot client for this API.");
    const { principalId } = this.auth.authenticate(req);
    if (this.service.failure && req.method !== "GET") throw new ControlError(503, "unavailable", "The task controller is unavailable. Restart after repairing its storage.");
    const key = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : "";
    if (req.method === "GET" && url.pathname === "/v1/snapshot") {
      json(res, 200, { node: this.node, bots: this.store.bots(principalId), goals: this.store.goals(principalId), cursor: this.store.cursor }); return;
    }
    if (req.method === "POST" && url.pathname === "/v1/events/ticket") { await body(req); json(res, 200, this.auth.createEventTicket(req)); return; }
    if (req.method === "POST" && url.pathname === "/v1/bots") { json(res, 201, this.store.createBot(principalId, key, botSchema.parse(await body(req)))); return; }
    if (req.method === "POST" && url.pathname === "/v1/goals") { json(res, 202, this.store.submitGoal(principalId, key, goalSchema.parse(await body(req)))); return; }
    const match = /^\/v1\/goals\/([a-f0-9-]{36})(?:\/(cancel|accept|reconcile))?$/.exec(url.pathname);
    if (match?.[1]) {
      const id = match[1]; const action = match[2];
      if (req.method === "GET" && !action) {
        const goal = this.store.goal(id, principalId);
        json(res, 200, { goal, task: this.store.task(goal.taskId), transcript: readableTranscript(this.store.transcript(id)) }); return;
      }
      if (req.method === "POST" && action === "cancel") { z.object({}).strict().parse(await body(req)); json(res, 200, this.store.cancel(principalId, key, id)); return; }
      if (req.method === "POST" && action === "accept") { const input = acceptSchema.parse(await body(req)); json(res, 200, this.store.accept(principalId, key, id, input.expectedVersion)); return; }
      if (req.method === "POST" && action === "reconcile") { const input = reconcileSchema.parse(await body(req)); json(res, 200, await this.service.reconcile(principalId, key, id, input.expectedVersion, input.note)); return; }
    }
    throw new ControlError(404, "not_found", "Unknown API route.");
  }
  private eventSession(socket: WebSocket): void {
    let sessionId: string | undefined; let principalId: string | undefined; let cursor = 0; let alive = true;
    let unsubscribe: (() => void) | undefined;
    const authDeadline = setTimeout(() => socket.close(4401, "Authentication required"), 5_000);
    const ping = setInterval(() => {
      if (!alive) { socket.terminate(); return; }
      alive = false;
      try { if (sessionId) this.auth.assertSession(sessionId); socket.ping(); }
      catch { socket.close(4401, "Session expired"); }
    }, 10_000);
    socket.on("pong", () => { alive = true; });
    const send = (event: unknown) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > 2 * 1024 * 1024) { socket.close(4408, "Reconnect for a snapshot"); return; }
      socket.send(JSON.stringify(event));
    };
    const ownsEvent = (event: NodeEvent): boolean => {
      const data = event.data as { bot?: { ownerId?: string }; goal?: { ownerId?: string } };
      return (data.bot?.ownerId ?? data.goal?.ownerId) === principalId;
    };
    const flush = () => {
      try {
        this.auth.assertSession(sessionId!);
        const events = this.store.events(cursor, 257);
        if (events.length > 256) { cursor = this.store.cursor; send({ type: "resync", cursor }); return; }
        for (const event of events) { cursor = event.seq; if (ownsEvent(event)) send(event); }
      } catch { socket.close(4401, "Session expired"); }
    };
    socket.on("message", (raw: Buffer) => {
      if (sessionId) { socket.close(4400, "Only the initial authentication frame is accepted"); return; }
      try {
        const input = z.object({ ticket: z.string().min(16).max(512), after: z.number().int().nonnegative() }).strict().parse(JSON.parse(raw.toString()));
        const session = this.auth.redeemEventTicket(input.ticket); sessionId = session.sessionId; principalId = session.principalId;
        clearTimeout(authDeadline); cursor = input.after;
        if (cursor > this.store.cursor) { cursor = this.store.cursor; send({ type: "reset", cursor }); }
        unsubscribe = this.store.subscribe(flush); flush(); send({ type: "ready", cursor });
      } catch { socket.close(4401, "Invalid event session"); }
    });
    socket.on("error", () => {});
    socket.on("close", () => { clearTimeout(authDeadline); clearInterval(ping); unsubscribe?.(); });
  }
  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.http.once("error", reject);
      this.http.listen(this.options.config.port, this.options.config.bindHost, () => { this.http.off("error", reject); resolve(); });
    });
    this.service.start();
  }
  close(): Promise<void> {
    this.closing ??= (async () => {
      for (const socket of this.ws.clients) socket.terminate();
      await new Promise<void>(resolve => this.ws.close(() => resolve()));
      const stopped = new Promise<void>(resolve => this.http.close(() => resolve()));
      this.http.closeAllConnections();
      await stopped; await this.service.close(); this.auth.close(); this.store.close();
    })();
    return this.closing;
  }
}
