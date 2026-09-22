/** Fail closed when looking up a receipt. A missing, pending, malformed or
 * evicted ledger record is NOT evidence that an external send never happened.
 */
export function verifiedSubmissionOutcome(value: unknown, expected: {
  accountSlot: string; agentId: string; nonce: string;
}): "sent" | "not-sent" | null {
  if (value == null || typeof value !== "object" || !("outcome" in value) || value.outcome !== "found" || !("record" in value)) return null;
  const record = value.record;
  if (record == null || typeof record !== "object" || Array.isArray(record)) return null;
  if (!("accountSlot" in record) || record.accountSlot !== expected.accountSlot
    || !("agentId" in record) || record.agentId !== expected.agentId
    || !("clientNonce" in record) || record.clientNonce !== expected.nonce
    || !("status" in record)) return null;
  return record.status === "accepted" ? "sent" : record.status === "rejected" ? "not-sent" : null;
}

/** Bound a read-only receipt query. Timeout is an unknown outcome, not rejection.
 * A late query may finish on the transport; its answer cannot mutate this result.
 */
export async function lookupSubmissionReceipt(
  lookup: () => Promise<unknown>,
  expected: Parameters<typeof verifiedSubmissionOutcome>[1],
  timeoutMs = 5000,
): Promise<ReturnType<typeof verifiedSubmissionOutcome>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(lookup).then(value => verifiedSubmissionOutcome(value, expected)),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), Math.max(0, timeoutMs)); }),
    ]);
  } catch { return null; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
