import { createHash } from "node:crypto";

const WRITER_SHA256 = "91e3757f9516a522d7ffa7fd3777b69ee37842e26c99ce65e0efe07372f9bf29";

/** Keep profile-owned avatar identity in the existing account-scoped roster cache.
 * Photos remain in their separate versioned cache; no live activity is persisted. */
export function patchPresenceAvatarCache(source) {
  const startAnchor = "function Y0t(n){";
  const endAnchor = "function Ppe(n){";
  const start = source.indexOf(startAnchor);
  const end = source.indexOf(endAnchor, start);
  if (start < 0 || end < 0
    || source.indexOf(startAnchor, start + startAnchor.length) >= 0
    || source.indexOf(endAnchor, end + endAnchor.length) >= 0
    || createHash("sha256").update(source.slice(start, end)).digest("hex") !== WRITER_SHA256) {
    throw new Error("Presence roster identity writer differs from the pinned source");
  }
  const writer = source.slice(start, end).replace(
    "title:n.title,avatarVersion:n.avatarVersion",
    "title:n.title,avatarShape:n.avatarShape,avatarColor:n.avatarColor,avatarVersion:n.avatarVersion",
  );
  return source.slice(0, start) + writer + source.slice(end);
}
