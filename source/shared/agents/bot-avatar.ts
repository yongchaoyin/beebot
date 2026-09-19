/** Avatar choices exposed by the existing New bot sheet. */
export const BOT_AVATAR_COLORS = ["black", "brown", "red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta", "gray"] as const;
export const BOT_AVATAR_SHAPES = ["blob", "pebble", "squircle", "tablet", "wedge", "hex", "cloud", "teardrop"] as const;

export interface BotAvatar {
  avatarColor?: typeof BOT_AVATAR_COLORS[number] | undefined;
  avatarShape?: typeof BOT_AVATAR_SHAPES[number] | undefined;
}
