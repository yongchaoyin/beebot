import type { RendererAgent } from "./model";
import type { CommandPaletteCommand } from "./command-palette-model";

// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5465664 (MDn)
// @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5331185 (HOn)
// MDn is the current-agent guard for the three info commands; HOn only forwards
// a caller-owned computer action to its confirmation callback.

export type CommandPaletteInfoSection = "members" | "channels" | "settings";
export type CommandPaletteComputerUpdateAction = "ready" | "busy-override";

export interface CommandPaletteRootCommandInput {
  readonly activeAgent: Pick<RendererAgent, "isGroup" | "raw"> | null;
  readonly hasChannels: boolean;
  readonly openInfoSection: (section: CommandPaletteInfoSection) => void;
  readonly computerUpdateAction: CommandPaletteComputerUpdateAction | null;
  readonly openComputerUpdateConfirm: (action: CommandPaletteComputerUpdateAction) => void;
}

function infoCommand(
  id: string,
  label: string,
  icon: string,
  keywords: readonly string[],
  run: () => void
): CommandPaletteCommand {
  return { id, label, icon, keywords, detail: "Current chat", run };
}

/**
 * Projects the root-dependent palette rows without owning agent, computer, or
 * navigation state. A null agent is fail-closed; every action is injected.
 */
export function commandPaletteRootCommands(input: CommandPaletteRootCommandInput): CommandPaletteCommand[] {
  if (input.activeAgent == null) return [];

  const commands: CommandPaletteCommand[] = [];
  if (input.activeAgent.isGroup && input.activeAgent.raw.isSharedRoom !== true) {
    commands.push(infoCommand(
      "info:members",
      "Members",
      "people",
      ["people", "group", "participants"],
      () => input.openInfoSection("members")
    ));
  }
  if (input.hasChannels) {
    commands.push(infoCommand(
      "info:channels",
      "Channels",
      "chat-bubbles",
      ["messaging", "platforms", "connect"],
      () => input.openInfoSection("channels")
    ));
  }
  commands.push(infoCommand(
    "info:settings",
    "Chat Settings",
    "settings-gear",
    ["details", "notifications"],
    () => input.openInfoSection("settings")
  ));

  if (input.computerUpdateAction != null) {
    const action = input.computerUpdateAction;
    commands.push({
      id: "update:computer",
      label: "Update BeeBot's Computer",
      icon: "device-desktop",
      keywords: ["box", "image", "machine", "recreate", "latest", "shared"],
      detail: "Updates",
      run: () => input.openComputerUpdateConfirm(action)
    });
  }
  return commands;
}
