import { createHash } from "node:crypto";

/** A storage codec is constructed only by trusted control-plane code.
 * It is not an authorization grant and must never be supplied by a renderer. */
export interface RecordCodec {
  readonly binding: string;
  encode(table: string, id: string, value: unknown): string;
  decode<T>(table: string, id: string, stored: string): T;
  fingerprint(value: string): string;
}

/** Existing single-owner format only. Tenant databases never fall back to this. */
export const plaintextRecords: RecordCodec = Object.freeze({
  binding: "single-owner-json-v2",
  encode: (_table: string, _id: string, value: unknown) => JSON.stringify(value),
  decode: <T>(_table: string, _id: string, stored: string): T => JSON.parse(stored) as T,
  fingerprint: (value: string) => createHash("sha256").update(value).digest("hex"),
});
