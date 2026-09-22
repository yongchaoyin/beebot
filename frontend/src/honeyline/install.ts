/** Existing callers keep the compatibility import. Native theme preference,
 * draft, scroll, and editor identity remain owned by their original controllers. */
export function installPresence(document: Document): void {
  if (document.documentElement.dataset.beebotTheme !== "presence") document.documentElement.dataset.beebotTheme = "presence";
}
export const installHoneyline = installPresence;
