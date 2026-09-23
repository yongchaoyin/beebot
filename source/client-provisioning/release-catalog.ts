import { verifyNodeRelease, type ReleasePolicy, type VerifiedRelease } from "./release-manifest.js";

/** Release maintainers add independently approved public signing keys and signed
 * manifests in a reviewed client release. No runtime env/renderer/file-picker
 * input may add a trust root. Empty means unavailable, NEVER latest/unsigned.
 * The repository currently has no published Node release; do not invent one. */
const policy: ReleasePolicy = Object.freeze({ keys: Object.freeze({}), minimumSequence: 1, repositories: Object.freeze([]) });
const envelopes: readonly string[] = Object.freeze([]);

export type ReleaseCatalog = (now: number) => readonly VerifiedRelease[];
export const packagedNodeReleases: ReleaseCatalog = now => envelopes.map(text => verifyNodeRelease(text, policy, now));
