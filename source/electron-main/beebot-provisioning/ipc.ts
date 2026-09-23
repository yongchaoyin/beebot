import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { ServerPreflight } from "../../client-provisioning/manager.js";
import { PreflightError } from "../../client-provisioning/preflight.js";
import { assertTrustedNodeSender } from "../beebot-node/connection-ipc.js";

type Contents = {
  mainFrame: unknown;
  getURL(): string;
  send(channel: string, value: unknown): void;
  on(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
};
type ElectronPorts = {
  app: { on(event: string, listener: () => void): unknown };
  ipcMain: { handle(channel: string, listener: (event: any, request: unknown) => unknown): void };
  BrowserWindow: { getAllWindows(): Array<{ webContents: Contents }> };
  dialog: { showOpenDialog(options: { title: string; properties: Array<"openFile" | "showHiddenFiles"> }): Promise<{ canceled: boolean; filePaths: string[] }> };
};

/** Separate read-only deployment channel. No modification of Node login, DPoP,
 * tokens, Bot settings, server APIs or the existing beebot:nodes contract. */
export function installServerPreflightIpc(electron: ElectronPorts, rendererHtmlPath: string, create = () => new ServerPreflight()): void {
  type Session = { id: string; manager: ServerPreflight; epoch: number; close: () => void };
  const sessions = new Map<Contents, Session>();
  electron.ipcMain.handle("beebot:server-preflight", async (event, request) => {
    try {
      assertTrustedNodeSender(event, electron.BrowserWindow.getAllWindows(), rendererHtmlPath);
      if (!request || typeof request !== "object" || Array.isArray(request)) throw new PreflightError("INVALID_TARGET");
      const input = request as Record<string, unknown>;
      const owner = event.sender as Contents;
      if (input.action === "open") {
        sessions.get(owner)?.close();
        const session: Session = { id: randomUUID(), manager: create(), epoch: 0, close };
        function close() {
          session.epoch++; session.manager.cancel();
          if (sessions.get(owner) === session) sessions.delete(owner);
          owner.removeListener("destroyed", close); owner.removeListener("did-start-navigation", close);
        }
        sessions.set(owner, session);
        owner.on("destroyed", close); owner.on("did-start-navigation", close);
        return { ok: true, value: { sessionId: session.id } };
      }
      const session = sessions.get(owner);
      if (!session || input.sessionId !== session.id) throw new PreflightError("CANCELLED");
      if (input.action === "close") { session.close(); return { ok: true, value: null }; }
      if (input.action === "cancel") { session.epoch++; session.manager.cancel(); return { ok: true, value: null }; }
      const epoch = ++session.epoch;
      let value: unknown;
      if (input.action === "chooseKey") {
        session.manager.cancel();
        const selection = await electron.dialog.showOpenDialog({ title: "BeeBot · SSH key / SSH 密钥", properties: ["openFile", "showHiddenFiles"] });
        if (sessions.get(owner) !== session || epoch !== session.epoch) throw new PreflightError("CANCELLED");
        if (selection.canceled || !selection.filePaths[0]) return { ok: true, value: { canceled: true } };
        await session.manager.setIdentity(selection.filePaths[0]);
        value = { canceled: false, label: basename(selection.filePaths[0]) }; // No key bytes or absolute path in renderer.
      } else if (input.action === "useAgent") {
        await session.manager.setIdentity(undefined); value = null;
      } else if (input.action === "scan") value = await session.manager.scan(input.target);
      else if (input.action === "inspect") value = await session.manager.inspect(input.challengeId, input.fingerprint);
      else throw new PreflightError("INVALID_TARGET");
      if (sessions.get(owner) !== session || epoch !== session.epoch) throw new PreflightError("CANCELLED");
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: { code: error instanceof PreflightError ? error.code : "CONNECTION_FAILED" } };
    }
  });
  electron.app.on("before-quit", () => { for (const session of [...sessions.values()]) session.close(); });
}
