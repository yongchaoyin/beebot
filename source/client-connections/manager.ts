import { discoverNode, type NodeConnectionPreview } from "./discovery.js";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { generateDpopKey, exportDpopKey, importDpopKey } from "../shared/security/dpop.js";
import type { DeviceGrant } from "../node/auth.js";
import { authorizeNode, DpopClient, exchangeToken, NodeHttpError, normalizeNodeUrl } from "./transport.js";
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
  private readonly previews = new Map<string, NodeConnectionPreview>();
  private readonly adding = new Map<string, Promise<NodeProfile>>();

  async inspect(address: string): Promise<NodeConnectionPreview> {
    await this.ready;
    if (this.closed) throw new Error("The server client is closed.");
    const node = await discoverNode(address);
    if (this.closed) throw new Error("The server client is closed.");
    const checkedAt = Date.now();
    for (const [id, p] of this.previews) if (p.expiresAt <= checkedAt) this.previews.delete(id);
    if (this.previews.size >= 16) this.previews.delete(this.previews.keys().next().value!);
    const preview = { ...node, previewId: randomUUID(), checkedAt, expiresAt: checkedAt + 5 * 60_000 };
    this.previews.set(preview.previewId, preview);
    return { ...preview };
  }

  async confirmConnection(previewId: string): Promise<NodeProfile> {
    await this.ready;
    const preview = this.previews.get(previewId);
    if (!preview || preview.expiresAt <= Date.now()) throw new Error("Server check expired. Check the address again before connecting.");
    // Recheck even previously saved origins. A stale preview cannot silently
    // replace the node bound to existing credentials. Never auto-open a browser.
    return this.add(preview.baseUrl, preview.nodeId);
  }

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

  async add(address: string, expectedNodeId?: string): Promise<NodeProfile> {
    await this.ready;
    if (this.closed) throw new Error("The server client is closed.");
    const baseUrl = normalizeNodeUrl(address);
    const key = baseUrl;
    let pending = this.adding.get(key);
    if (!pending) {
      pending = this.addVerified(baseUrl, expectedNodeId);
      this.adding.set(key, pending);
    }
    try {
      const profile = await pending;
      if (expectedNodeId && profile.nodeId !== expectedNodeId) throw new Error("The server identity changed since the check. Check it again.");
      return { ...profile };
    }
    finally { if (this.adding.get(key) === pending) this.adding.delete(key); }
  }

  private async addVerified(baseUrl: string, expectedNodeId?: string): Promise<NodeProfile> {
    const node = await discoverNode(baseUrl);
    if (this.closed) throw new Error("The server client is closed.");
    if (expectedNodeId && node.nodeId !== expectedNodeId) throw new Error("The server identity changed since the check. Check it again.");
    const previous = [...this.connections.values()].find(c => c.profile.baseUrl === baseUrl);
    if (previous) {
      if (previous.profile.nodeId !== node.nodeId) throw new Error("The saved server identity changed. Remove the old connection explicitly before adding it again.");
      return { ...previous.profile };
    }
    const profile: NodeProfile = { id: randomUUID(), nodeId: node.nodeId, name: node.name, baseUrl, status: "signed-out" };
    const c: Connection = { profile, reconnectAttempt: 0, generation: 0 };
    this.connections.set(profile.id, c);
    try { await this.save(); } catch (error) { this.connections.delete(profile.id); throw error; }
    this.changed(c);
    return { ...profile };
  }

  private async verifyIdentity(c: Connection, signal?: AbortSignal): Promise<void> {
    const node = await discoverNode(c.profile.baseUrl, signal);
    if (node.nodeId !== c.profile.nodeId) throw new Error("The server identity changed. Remove this connection and add the server again.");
  }

  async login(id: string, deviceName = "BeeBot Desktop"): Promise<void> {
    const c = await this.get(id);
    if (!deviceName.trim() || deviceName.length > 80 || /[\u0000-\u001f\u007f]/.test(deviceName)) throw new Error("Invalid device name.");
    if (c.login) throw new Error("Sign-in is already open in the system browser.");
    this.stopConnection(c);
    const generation = c.generation;
    const abort = new AbortController(); c.login = abort;
    c.profile.status = "connecting"; c.profile.loginStage = "verifying-server"; delete c.profile.error; this.changed(c);
    try {
      await this.verifyIdentity(c, abort.signal);
      if (abort.signal.aborted || c.generation !== generation) throw new Error("Sign-in cancelled.");
      if (!c.device) {
        const key = generateDpopKey(); c.deviceKeyPem = exportDpopKey(key); c.device = new DpopClient(c.profile.baseUrl, key);
        await this.save(); // Persist the key before the browser can grant a session.
      }
      if (abort.signal.aborted || c.generation !== generation) throw new Error("Sign-in cancelled.");
      c.profile.loginStage = "browser-authorization"; this.changed(c);
      const tokens = await authorizeNode(c.profile.baseUrl, this.openExternal, c.device, abort.signal, deviceName);
      if (c.generation !== generation) return;
      await this.storeTokens(c, tokens);
      if (c.generation !== generation) return;
      c.profile.loginStage = "connecting-events"; this.changed(c);
      await this.connect(c);
    } catch (error) {
      if (c.generation === generation) { c.profile.status = "signed-out"; delete c.profile.loginStage; c.profile.error = this.message(error); this.changed(c); }
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
      // The transport opening is not proof that the ticket/device was accepted.
    });
    const readyTimer = setTimeout(() => {
      if (active() && c.profile.status !== "online") { c.profile.error = "The server did not confirm the event session."; socket.terminate(); }
    }, 15_000);
    readyTimer.unref?.();
    socket.once("close", () => clearTimeout(readyTimer));
    socket.on("message", raw => {
      if (!active()) return;
      try {
        const event = JSON.parse(raw.toString());
        if (event.type === "error") throw new Error(typeof event.error === "string" ? event.error : "The event session was rejected.");
        if (event.type === "ready") {
          if (!Number.isSafeInteger(event.cursor) || (event.cursor) < 0) throw new Error("Invalid event readiness response.");
          clearTimeout(readyTimer);
          c.profile.status = "online"; delete c.profile.loginStage; delete c.profile.error; c.reconnectAttempt = 0; this.changed(c);
        }
        // Snapshots are the authoritative projection. Coalescing invalidations avoids replay races.
        if (Number.isSafeInteger(event.seq) || event.type === "reset" || event.type === "resync") this.changed(c);
      } catch (error) { c.profile.error = this.message(error); socket.close(); }
    });
    socket.on("error", error => { if (active()) c.profile.error = this.message(error); });
    socket.on("close", () => { if (active()) { delete c.socket; this.scheduleReconnect(c, new Error(c.profile.error ?? "Connection interrupted.")); } });
  }

  private scheduleReconnect(c: Connection, error: unknown): void {
    if (this.closed || !this.connections.has(c.profile.id) || c.timer) return;
    delete c.profile.loginStage;
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

  async decideDevice(id: string, requestId: string, expectedVersion: number, thumbprint: string, grant?: DeviceGrant): Promise<void> {
    await this.request(await this.get(id), `/v1/security/requests/${encodeURIComponent(requestId)}/${grant ? "approve" : "deny"}`, "POST",
      { expectedVersion, thumbprint, ...(grant ? { grant } : {}) });
  }
  async blockDevice(id: string, thumbprint: string, expectedVersion: number): Promise<void> {
    await this.request(await this.get(id), `/v1/security/devices/${encodeURIComponent(thumbprint)}/block`, "POST", { expectedVersion });
  }
  async blockDeviceAndFreeze(id: string, thumbprint: string, expectedVersion: number, key: string): Promise<unknown> {
    return this.request(await this.get(id), `/v1/security/devices/${encodeURIComponent(thumbprint)}/block-and-freeze`, "POST", { expectedVersion }, key);
  }
  async freezeBotTasks(id: string, botId: string, key: string): Promise<unknown> {
    return this.request(await this.get(id), `/v1/security/bots/${encodeURIComponent(botId)}/freeze`, "POST", {}, key);
  }
  async releaseBotFreeze(id: string, freezeId: string, expectedVersion: number, key: string): Promise<unknown> {
    return this.request(await this.get(id), `/v1/security/task-freezes/${encodeURIComponent(freezeId)}/release`, "POST", { expectedVersion }, key);
  }
  async rotateRecoveryCodes(id: string): Promise<unknown> {
    return this.request(await this.get(id), "/v1/security/recovery-codes", "POST", {});
  }
  async securitySessions(id: string): Promise<unknown> { return this.request(await this.get(id), "/v1/security/sessions"); }
  async securityEvents(id: string): Promise<unknown> { return this.request(await this.get(id), "/v1/security/events"); }
  async revokeSession(id: string, sessionId: string): Promise<void> {
    const c = await this.get(id); await this.request(c, `/v1/security/sessions/${encodeURIComponent(sessionId)}/revoke`, "POST", {});
  }
  async setSessionGrant(id: string, sessionId: string, grant: DeviceGrant): Promise<void> {
    const c = await this.get(id); await this.request(c, `/v1/security/sessions/${encodeURIComponent(sessionId)}/grant`, "POST", grant);
  }

  async cancelLogin(id: string): Promise<void> {
    const c = await this.get(id);
    if (!c.login) return;
    this.stopConnection(c);
    delete c.profile.loginStage;
    c.profile.status = c.refreshToken ? "reconnecting" : "signed-out";
    delete c.profile.error;
    this.changed(c);
    // Local cancellation only: pending browser requests expire at the server.
    // Do not revoke a prior authorized session or cancel accepted server tasks.
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
    c.generation++; c.login?.abort(); delete c.profile.loginStage;
    if (c.timer) clearTimeout(c.timer); delete c.timer;
    const socket = c.socket; delete c.socket; socket?.close();
  }
  close(): void { this.closed = true; for (const c of this.connections.values()) this.stopConnection(c); this.listeners.clear(); }
  private message(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 400); }
}
