import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { generateDpopKey, exportDpopKey, importDpopKey } from "../shared/security/dpop.js";
import type { DeviceGrant } from "../node/auth.js";
import { authorizeNode, DpopClient, exchangeToken, fetchNodeJson, NodeHttpError, normalizeNodeUrl } from "./transport.js";
import type { ConnectionPersistence, CreateNodeBotInput, NodeProfile, NodeSnapshot, OAuthTokens, StoredConnection } from "./types.js";

interface Connection {
  profile: NodeProfile;
  refreshToken?: string;
  deviceKeyPem?: string;
  device?: DpopClient;
  accessToken?: string;
  expiresAt?: number;
  refreshing?: Promise<void>;
  snapshot?: NodeSnapshot;
  socket?: WebSocket;
  timer?: ReturnType<typeof setTimeout>;
  login?: AbortController;
  reconnectAttempt: number;
  generation: number;
  syncing?: Promise<NodeSnapshot>;
  connecting?: Promise<void>;
}

export class NodeConnectionManager {
  private readonly connections = new Map<string, Connection>();
  private readonly listeners = new Set<(id: string) => void>();
  private readonly ready: Promise<void>;
  private closed = false;

  constructor(private readonly persistence: ConnectionPersistence, private readonly openExternal: (url: string) => Promise<unknown>) {
    this.ready = this.load();
    void this.ready.catch(() => {});
  }

  private async load(): Promise<void> {
    for (const entry of await this.persistence.load()) {
      if (!entry.deviceKeyPem) delete entry.refreshToken;
      if (entry.refreshToken) entry.profile.status = "reconnecting";
      this.connections.set(entry.profile.id, { ...entry, ...(entry.deviceKeyPem ? { device: new DpopClient(entry.profile.baseUrl, importDpopKey(entry.deviceKeyPem)) } : {}), reconnectAttempt: 0, generation: 0 });
    }
  }

  private save(): Promise<void> {
    return this.persistence.save([...this.connections.values()].map((c): StoredConnection => ({ profile: c.profile, ...(c.refreshToken ? { refreshToken: c.refreshToken } : {}), ...(c.deviceKeyPem ? { deviceKeyPem: c.deviceKeyPem } : {}) })));
  }

  subscribe(listener: (id: string) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private changed(c: Connection): void { for (const listener of this.listeners) listener(c.profile.id); }

  async list(): Promise<NodeProfile[]> {
    await this.ready;
    return [...this.connections.values()].map(c => ({ ...c.profile }));
  }

  private async get(id: string): Promise<Connection> {
    await this.ready;
    if (this.closed) throw new Error("The server client is closed.");
    const c = this.connections.get(id);
    if (!c) throw new Error("Unknown server connection.");
    return c;
  }

  async add(address: string): Promise<NodeProfile> {
    await this.ready;
    const baseUrl = normalizeNodeUrl(address);
    const previous = [...this.connections.values()].find(c => c.profile.baseUrl === baseUrl);
    if (previous) return { ...previous.profile };
    const node = await fetchNodeJson(baseUrl, "/v1/node");
    if (node.protocolVersion !== 1 || typeof node.id !== "string" || !node.id || typeof node.name !== "string") throw new Error("This server does not support BeeBot protocol version 1.");
    if (node.security?.dpopRequired !== true) throw new Error("Update this BeeBot Node before connecting: device-bound authentication is required.");
    const profile: NodeProfile = { id: randomUUID(), nodeId: node.id, name: node.name, baseUrl, status: "signed-out" };
    const c: Connection = { profile, reconnectAttempt: 0, generation: 0 };
    this.connections.set(profile.id, c);
    try { await this.save(); } catch (error) { this.connections.delete(profile.id); throw error; }
    this.changed(c);
    return { ...profile };
  }

  private async verifyIdentity(c: Connection): Promise<void> {
    const node = await fetchNodeJson(c.profile.baseUrl, "/v1/node");
    if (node.id !== c.profile.nodeId || node.protocolVersion !== 1 || node.security?.dpopRequired !== true) throw new Error("The server identity changed. Remove this connection and add the server again.");
  }

  async login(id: string): Promise<void> {
    const c = await this.get(id);
    if (c.login) throw new Error("Sign-in is already open in the system browser.");
    this.stopConnection(c);
    const generation = c.generation;
    const abort = new AbortController(); c.login = abort;
    c.profile.status = "connecting"; delete c.profile.error; this.changed(c);
    try {
      await this.verifyIdentity(c);
      if (!c.device) {
        const key = generateDpopKey(); c.deviceKeyPem = exportDpopKey(key); c.device = new DpopClient(c.profile.baseUrl, key);
        await this.save(); // Persist the key before the browser can grant a session.
      }
      const tokens = await authorizeNode(c.profile.baseUrl, this.openExternal, c.device, abort.signal);
      if (c.generation !== generation) return;
      await this.storeTokens(c, tokens);
      await this.connect(c);
    } catch (error) {
      if (c.generation === generation) { c.profile.status = "signed-out"; c.profile.error = this.message(error); this.changed(c); }
      throw error;
    } finally { if (c.login === abort) delete c.login; }
  }

  private async storeTokens(c: Connection, tokens: OAuthTokens): Promise<void> {
    c.refreshToken = tokens.refresh_token;
    c.accessToken = tokens.access_token;
    c.expiresAt = Date.now() + tokens.expires_in * 1000;
    await this.save();
  }

  private async ensureAccess(c: Connection): Promise<void> {
    if (c.accessToken && (c.expiresAt ?? 0) > Date.now() + 30_000) return;
    if (c.refreshing) return c.refreshing;
    if (!c.refreshToken) throw new NodeHttpError(401, "Sign in to this server.");
    const refreshToken = c.refreshToken;
    const generation = c.generation;
    const operation = (async () => {
      await this.verifyIdentity(c);
      const tokens = await exchangeToken(c.profile.baseUrl, { grant_type: "refresh_token", refresh_token: refreshToken }, c.device!);
      if (c.generation !== generation) throw new Error("The server connection changed during sign-in.");
      await this.storeTokens(c, tokens);
    })();
    c.refreshing = operation;
    try { await operation; } finally { if (c.refreshing === operation) delete c.refreshing; }
  }

  private async request(c: Connection, route: string, method = "GET", data?: unknown, key?: string): Promise<any> {
    const generation = c.generation;
    const assertCurrent = () => {
      if (this.closed || generation !== c.generation || this.connections.get(c.profile.id) !== c) throw new Error("The server session changed during this request. Its result was not applied.");
    };
    await this.ensureAccess(c); assertCurrent();
    if (!c.device) throw new Error("Sign in again to bind this connection to a device key.");
    const device = c.device;
    const send = async () => {
      assertCurrent();
      const result = await device.request(route, {
        method, headers: { ...(data === undefined ? {} : { "Content-Type": "application/json" }), ...(key ? { "Idempotency-Key": key } : {}) },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      }, c.accessToken);
      assertCurrent(); return result;
    };
    try { return await send(); }
    catch (error) {
      assertCurrent();
      if (!(error instanceof NodeHttpError) || error.status !== 401 || error.code !== "invalid_token") throw error;
      delete c.accessToken;
      await this.ensureAccess(c); assertCurrent();
      return send();
    }
  }

  async snapshot(id: string): Promise<NodeSnapshot> {
    const c = await this.get(id);
    if (!c.socket && !c.timer && c.refreshToken) void this.connect(c).catch(error => this.scheduleReconnect(c, error));
    return this.sync(c);
  }

  private async sync(c: Connection): Promise<NodeSnapshot> {
    if (c.syncing) return c.syncing;
    const operation = (async () => {
      const snapshot = await this.request(c, "/v1/snapshot") as NodeSnapshot;
      if (snapshot.node?.id !== c.profile.nodeId || !Array.isArray(snapshot.bots) || !Array.isArray(snapshot.goals) || !Number.isSafeInteger(snapshot.cursor) || snapshot.cursor < 0) throw new Error("The server returned an invalid snapshot.");
      c.snapshot = snapshot;
      return snapshot;
    })();
    c.syncing = operation;
    try { return await operation; } finally { if (c.syncing === operation) delete c.syncing; }
  }

  async resume(id: string): Promise<void> {
    const c = await this.get(id);
    this.stopConnection(c);
    try { await this.connect(c); } catch (error) { this.scheduleReconnect(c, error); throw error; }
  }

  private async connect(c: Connection): Promise<void> {
    if (c.connecting) return c.connecting;
    const operation = this.openEventConnection(c);
    c.connecting = operation;
    try { await operation; } finally { if (c.connecting === operation) delete c.connecting; }
  }

  private async openEventConnection(c: Connection): Promise<void> {
    if (this.closed || c.socket) return;
    const generation = c.generation;
    c.profile.status = "connecting"; this.changed(c);
    await this.verifyIdentity(c);
    await this.sync(c);
    const { ticket, nonce } = await this.request(c, "/v1/events/ticket", "POST", {});
    if (typeof ticket !== "string" || !ticket) throw new Error("Invalid event session.");
    if (this.closed || generation !== c.generation || c.socket) return;
    const endpoint = new URL("/v1/events", c.profile.baseUrl);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(endpoint, { handshakeTimeout: 15_000, maxPayload: 2 * 1024 * 1024, followRedirects: false });
    c.socket = socket;
    const active = () => !this.closed && generation === c.generation && c.socket === socket;
    socket.on("open", () => {
      if (!active()) { socket.close(); return; }
      socket.send(JSON.stringify({ ticket, proof: c.device!.eventProof(ticket, nonce), after: c.snapshot?.cursor ?? 0 }));
      c.profile.status = "online"; delete c.profile.error; c.reconnectAttempt = 0; this.changed(c);
    });
    socket.on("message", raw => {
      if (!active()) return;
      try {
        const event = JSON.parse(raw.toString());
        if (event.type === "error") throw new Error(typeof event.error === "string" ? event.error : "The event session was rejected.");
        // Snapshots are the authoritative projection. Coalescing invalidations avoids replay races.
        if (Number.isSafeInteger(event.seq) || event.type === "reset" || event.type === "resync") this.changed(c);
      } catch (error) { c.profile.error = this.message(error); socket.close(); }
    });
    socket.on("error", error => { if (active()) c.profile.error = this.message(error); });
    socket.on("close", () => { if (active()) { delete c.socket; this.scheduleReconnect(c, new Error(c.profile.error ?? "Connection interrupted.")); } });
  }

  private scheduleReconnect(c: Connection, error: unknown): void {
    if (this.closed || !this.connections.has(c.profile.id) || c.timer) return;
    c.profile.error = this.message(error);
    if (!c.refreshToken || error instanceof NodeHttpError && [400, 401, 403].includes(error.status)) {
      c.profile.status = "signed-out"; this.changed(c); return;
    }
    c.profile.status = "reconnecting"; this.changed(c);
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(c.reconnectAttempt++, 5)) + Math.floor(Math.random() * 300);
    const generation = c.generation;
    c.timer = setTimeout(() => {
      delete c.timer;
      if (generation !== c.generation || this.closed) return;
      void this.connect(c).catch(next => this.scheduleReconnect(c, next));
    }, delay);
    c.timer.unref?.();
  }

  async createBot(id: string, body: CreateNodeBotInput, key: string): Promise<unknown> {
    const c = await this.get(id);
    const result = await this.request(c, "/v1/bots", "POST", body, key); this.changed(c); return result;
  }
  async submitGoal(id: string, body: { botId: string; prompt: string }, key: string): Promise<unknown> {
    const c = await this.get(id);
    const result = await this.request(c, "/v1/goals", "POST", body, key); this.changed(c); return result;
  }
  async goal(id: string, goalId: string): Promise<unknown> { return this.request(await this.get(id), `/v1/goals/${encodeURIComponent(goalId)}`); }
  async cancel(id: string, goalId: string, key: string): Promise<unknown> {
    const c = await this.get(id); const result = await this.request(c, `/v1/goals/${encodeURIComponent(goalId)}/cancel`, "POST", {}, key); this.changed(c); return result;
  }
  async accept(id: string, goalId: string, expectedVersion: number, key: string): Promise<unknown> {
    const c = await this.get(id); const result = await this.request(c, `/v1/goals/${encodeURIComponent(goalId)}/accept`, "POST", { expectedVersion }, key); this.changed(c); return result;
  }
  async reconcile(id: string, goalId: string, expectedVersion: number, note: string, key: string): Promise<unknown> {
    const c = await this.get(id); const result = await this.request(c, `/v1/goals/${encodeURIComponent(goalId)}/reconcile`, "POST", { expectedVersion, note }, key); this.changed(c); return result;
  }

  async securitySessions(id: string): Promise<unknown> { return this.request(await this.get(id), "/v1/security/sessions"); }
  async securityEvents(id: string): Promise<unknown> { return this.request(await this.get(id), "/v1/security/events"); }
  async revokeSession(id: string, sessionId: string): Promise<void> {
    const c = await this.get(id); await this.request(c, `/v1/security/sessions/${encodeURIComponent(sessionId)}/revoke`, "POST", {});
  }
  async setSessionGrant(id: string, sessionId: string, grant: DeviceGrant): Promise<void> {
    const c = await this.get(id); await this.request(c, `/v1/security/sessions/${encodeURIComponent(sessionId)}/grant`, "POST", grant);
  }

  async logout(id: string): Promise<void> {
    const c = await this.get(id);
    this.stopConnection(c);
    // Do not silently claim logout if device revocation failed on the server.
    if (c.refreshToken) await this.revoke(c);
    delete c.refreshToken; delete c.accessToken; delete c.snapshot; delete c.profile.error;
    c.profile.status = "signed-out"; await this.save(); this.changed(c);
  }
  private async revoke(c: Connection): Promise<void> {
    await this.verifyIdentity(c);
    if (!c.device) throw new Error("The saved session is not device-bound; sign in again.");
    await c.device.request("/oauth/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: "beebot-desktop", token: c.refreshToken!, token_type_hint: "refresh_token" }).toString() });
  }
  async remove(id: string): Promise<{ remoteRevoked: boolean }> {
    const c = await this.get(id); this.stopConnection(c);
    let remoteRevoked = true;
    if (c.refreshToken) { try { await this.revoke(c); } catch { remoteRevoked = false; } }
    this.connections.delete(id);
    try { await this.save(); } catch (error) { this.connections.set(id, c); throw error; }
    return { remoteRevoked };
  }
  private stopConnection(c: Connection): void {
    c.generation++; c.login?.abort();
    if (c.timer) clearTimeout(c.timer); delete c.timer;
    const socket = c.socket; delete c.socket; socket?.close();
  }
  close(): void { this.closed = true; for (const c of this.connections.values()) this.stopConnection(c); this.listeners.clear(); }
  private message(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 400); }
}
