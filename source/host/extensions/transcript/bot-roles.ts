import { botRoleQuerySchema, botRoleUpdateSchema, type BotRoleDraft } from "../../../shared/bot-role.js";
import { BotRoleStore } from "../../agents/bot-role-store.js";
import { assertValidSandAgentId } from "../../storage/agent-paths.js";
import type { TranscriptManagerLike } from "./transcript-hub.js";

/** Exposed only on the authenticated user-facing gateway. Agent management and
 * update_state do not receive this service or accept role fields. */
export class BotRoles {
  constructor(readonly tm: TranscriptManagerLike) {}
  private store() { return new BotRoleStore(this.tm.sessionStore.getRootDir()); }
  private assertLocalBot(id: string) {
    assertValidSandAgentId(id);
    if (this.tm.sessions.isAgentGone(id) || !this.tm.sessionStore.agentExists(id)) throw new Error("bot_role_unavailable: This Bot no longer exists.");
    if (this.tm.groupChat.isGroupAgentId(id) || this.tm.groupChat.isRemoteRoomAgentId(id)) throw new Error("bot_role_unsupported: Set a role on an individual local Bot, not a group or remote room.");
  }
  read(id: string) { this.assertLocalBot(id); return this.store().read(id); }
  snapshot(raw: unknown) {
    const {agentId} = botRoleQuerySchema.parse(raw);
    const role = this.read(agentId);
    return {agentId, role, configured: role !== null, legacyDescription:this.tm.sessionStore.getAgentProfileText(agentId)?.description ?? ""};
  }
  async update(raw: unknown) {
    const args = botRoleUpdateSchema.parse(raw); this.assertLocalBot(args.agentId);
    const result = this.store().update(args);
    // The durable edit is already saved. Notification failure must not turn a
    // successful CAS into a fresh edit on retry.
    let notified = true;
    try { this.tm.roster.emitProfileChanged(args.agentId); await this.tm.roster.emitAgentUpdate(args.agentId); }
    catch { notified = false; }
    return {...result, saved:true, notified};
  }
  initialize(id: string, role: BotRoleDraft) {
    // Called before the new session is exposed or its introduction is started.
    return this.store().update({agentId:id,role,expectedRevision:0,requestId:"initial-user-role"});
  }
}
