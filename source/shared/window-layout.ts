/** Native coordinates are DIP; renderer insets divide them by page zoom.
 * Keep the reserved caption strip and BrowserWindow traffic lights together. */
export const MAC_TRAFFIC_LIGHT_POSITION = { x: 16, y: 15 } as const;
export const NATIVE_CAPTION_METRICS = {
  darwin: { height: 44, leading: 88, trailing: 0 },
  win32: { height: 51, leading: 0, trailing: 140 },
  linux: { height: 52, leading: 0, trailing: 140 },
} as const;
