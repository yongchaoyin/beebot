import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeConnectionManager } from "../../client-connections/manager.js";
import { createConnectionPersistence } from "../../client-connections/secure-store.js";
import type { SecureStorageCodec } from "../secrets/secret-store.js";
import { BOT_AVATAR_COLORS, BOT_AVATAR_SHAPES } from "../../shared/agents/bot-avatar.js";

export interface NodeConnectionElectron {
  app: { getPath(name: "userData"): string; on(event: string, listener: () => void): unknown };
  ipcMain: { handle(channel: string, listener: (event: any, request: unknown) => unknown): void };
  safeStorage: SecureStorageCodec;
  shell: { openExternal(url: string): Promise<unknown> };
  BrowserWindow: { getAllWindows(): Array<{ webContents: { mainFrame: unknown; getURL(): string; send(channel: string, value: unknown): void } }> };
}

function text(value: unknown, name: string, max = 16_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${name}.`);
  return value.trim();
}

function choice<T extends string>(value: unknown, choices: readonly T[], name: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new Error(`Invalid ${name}.`);
  return value as T;
}

export function assertTrustedNodeSender(event: any, windows: ReturnType<NodeConnectionElectron["BrowserWindow"]["getAllWindows"]>, rendererHtmlPath: string): void {
  const owner = windows.find(window => window.webContents === event?.sender && window.webContents.mainFrame === event?.senderFrame);
  if (!owner) throw new Error("Server access is limited to the main BeeBot window.");
  const url = new URL(owner.webContents.getURL());
  url.hash = ""; url.search = "";
  if (url.protocol !== "file:" || resolve(fileURLToPath(url)) !== resolve(rendererHtmlPath)) throw new Error("Untrusted server client page.");
}

export function installNodeConnectionIpc(electron: NodeConnectionElectron, rendererHtmlPath: string): NodeConnectionManager {
  const manager = new NodeConnectionManager(createConnectionPersistence(join(electron.app.getPath("userData"), "beebot-node-connections.json"), electron.safeStorage), url => electron.shell.openExternal(url));
  manager.subscribe(id => {
    for (const window of electron.BrowserWindow.getAllWindows()) {
      try {
        assertTrustedNodeSender({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, [window], rendererHtmlPath);
        window.webContents.send("beebot:nodes:changed", { id });
      } catch { /* Other app windows do not receive connection data. */ }
    }
  });
  electron.ipcMain.handle("beebot:nodes", async (event, request) => {
    assertTrustedNodeSender(event, electron.BrowserWindow.getAllWindows(), rendererHtmlPath);
    if (!request || typeof request !== "object") throw new Error("Invalid server request.");
    const input = request as Record<string, unknown>;
    const action = text(input.action, "action", 40);
    if (action === "list") return manager.list();
    if (action === "add") return manager.add(text(input.address, "server address", 2048));
    const id = text(input.id, "connection", 100);
    if (action === "login") return manager.login(id);
    if (action === "logout") return manager.logout(id);
    if (action === "remove") return manager.remove(id);
    if (action === "resume") return manager.resume(id);
    if (action === "securitySessions") return manager.securitySessions(id);
    if (action === "securityEvents") return manager.securityEvents(id);
    if (action === "revokeSession") return manager.revokeSession(id, text(input.sessionId, "device session", 100));
    if (action === "setSessionGrant") {
      const role = choice(input.role, ["admin", "operator", "viewer"] as const, "device permission");
      const botIds = input.botIds;
      if (!(botIds === "*" || Array.isArray(botIds) && botIds.length <= 500 && botIds.every(id => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id)))) throw new Error("Invalid Bot permission scope.");
      return manager.setSessionGrant(id, text(input.sessionId, "device session", 100), { role, botIds });
    }
    if (action === "rotateRecoveryCodes") return manager.rotateRecoveryCodes(id);
    if (["approveDevice", "denyDevice", "blockDevice"].includes(action)) {
      if (!Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 1) throw new Error("Invalid device version.");
      const thumbprint = text(input.thumbprint, "device fingerprint", 43);
      if (!/^[A-Za-z0-9_-]{43}$/.test(thumbprint)) throw new Error("Invalid device fingerprint.");
      if (action === "blockDevice") return manager.blockDevice(id, thumbprint, input.expectedVersion as number);
      const requestId = text(input.requestId, "device request", 36);
      if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(requestId)) throw new Error("Invalid device request.");
      if (action === "denyDevice") return manager.decideDevice(id, requestId, input.expectedVersion as number, thumbprint);
      const role = choice(input.role, ["admin", "operator", "viewer"] as const, "device permission"), botIds = input.botIds;
      if (!(botIds === "*" || Array.isArray(botIds) && botIds.length <= 500 && botIds.every(id => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id)))) throw new Error("Invalid Bot permission scope.");
      return manager.decideDevice(id, requestId, input.expectedVersion as number, thumbprint, { role, botIds });
    }
    if (action === "snapshot") return manager.snapshot(id);
    if (action === "goal") return manager.goal(id, text(input.goalId, "goal", 100));
    const key = text(input.key, "request identifier", 128);
    if (action === "createBot") return manager.createBot(id, {
      name: text(input.name, "Bot name", 100), description: typeof input.description === "string" ? input.description.slice(0, 4000) : "",
      ...(input.avatarColor === undefined ? {} : { avatarColor: choice(input.avatarColor, BOT_AVATAR_COLORS, "avatar color") }),
      ...(input.avatarShape === undefined ? {} : { avatarShape: choice(input.avatarShape, BOT_AVATAR_SHAPES, "avatar shape") }),
    }, key);
    if (action === "submitGoal") return manager.submitGoal(id, { botId: text(input.botId, "Bot", 100), prompt: text(input.prompt, "goal") }, key);
    if (action === "cancel") return manager.cancel(id, text(input.goalId, "goal", 100), key);
    if (action === "accept" || action === "reconcile") {
      if (!Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 1) throw new Error("Invalid goal version.");
      if (action === "reconcile") {
        const note = text(input.note, "verification note", 4000);
        if (note.length < 8) throw new Error("Describe what you verified before restoring this Bot.");
        return manager.reconcile(id, text(input.goalId, "goal", 100), input.expectedVersion as number, note, key);
      }
      return manager.accept(id, text(input.goalId, "goal", 100), input.expectedVersion as number, key);
    }
    throw new Error("Unknown server operation.");
  });
  electron.app.on("before-quit", () => manager.close());
  return manager;
}
