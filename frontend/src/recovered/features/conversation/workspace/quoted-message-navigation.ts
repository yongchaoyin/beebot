/** Resolve only within the captured account/conversation. Pagination and reveal
 * remain owned by the existing transcript; no thread or dialog is created. */
export async function locateQuotedMessage(options: {
  targetId: string;
  snapshot(): { scope: string; entries: readonly { id: string }[]; hasOlder: boolean };
  loadOlder(): Promise<void>;
  reveal(targetId: string): boolean | Promise<boolean>;
  isCurrent?(): boolean;
  maxPages?: number;
}): Promise<boolean> {
  if (!options.targetId) return false;
  const first = options.snapshot(), scope = first.scope;
  if (!scope) return false;
  const current = () => options.snapshot().scope === scope && options.isCurrent?.() !== false;
  const limit = Math.min(24, Math.max(1, options.maxPages ?? 12));
  for (let page = 0; page <= limit && current(); page++) {
    const before = options.snapshot();
    if (before.entries.some(entry => entry.id === options.targetId)) {
      if (!current()) return false;
      return await options.reveal(options.targetId);
    }
    if (!before.hasOlder || page === limit) return false;
    await options.loadOlder();
    if (!current()) return false;
    const after = options.snapshot();
    if (after.entries.length === before.entries.length && after.entries[0]?.id === before.entries[0]?.id) return false;
  }
  return false;
}
