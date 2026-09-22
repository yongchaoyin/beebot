/** Mark the existing document without owning native theme preference, rebuilding
 * React roots, observing message mutations, or accessing conversation storage. */
export function installPresence(document: Document): void {
  if (document.documentElement.dataset.beebotTheme !== "presence") {
    document.documentElement.dataset.beebotTheme = "presence";
  }
}
