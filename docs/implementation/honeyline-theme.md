> 历史实现记录：本页描述的配色、头像和主题名称已由 [中性界面与动态头像](presence-theme.md) 取代。可靠性约束继续有效，本文保留用于审计，不是当前设计规范。

# Honeyline: BeeBot's owned visual layer

Author: BeeBot development · 2026-09-22

## Scope and integration

The Honeyline branch starts at `81812eb13e23e433a33ed4cee1c71e018270ada8`.
It retains the preceding continuous-input, quoted-conversation, responsibility
and publication work. This is an implemented visual-theme increment, **not** a
claim that the upstream runtime has been rewritten, nor a signed release.

The theme is warm white/ink/honey gold with a corresponding warm-dark palette.
`frontend/src/honeyline` owns semantic colors, typography, compact geometry,
original deterministic avatar artwork, reduced-motion behavior and truthful work
labels. The existing native theme preference remains authoritative. Installing or
changing the theme does not replace the composer or create another preference.

The editable renderer imports the theme directly. The actual macOS staging path
also installs the same CSS in its `file://` entry and changes the document title
to BeeBot. Checksum-guarded display-component replacements use the existing React
singleton. They replace the native persona artwork (including live SVG mirrors
and creation/group adapters), add the BeeBot sidebar wordmark and show work
status from actual roster events. Custom photos and group identities keep their
existing dispatch paths. Unknown activity is simply “Working”; idle activity is
not presented as work, and no timer fabricates progress or completion.

Source conversation bubbles expose author identity, align user messages to the
right, preserve inline quotes and publication metadata, use readable links/code
and keep a single visible focus ring around the composer. The shared primitive
is now used for reply icons instead of an empty icon carrier. Existing quote,
queue, file, voice, permission, remote-server and computer behaviors remain in
place. We do not hide management controls to make a screenshot look simpler.

## Packaging and provenance

`build-honeyline.mjs` preserves the entry CSP and original scripts, appending only
a relative CSS resource. The extension manifest records original/patched entry
hashes and the owned CSS inputs. Immutable upstream files are never edited.

`honeyline-package-verification.mjs` regenerates **all** declared renderer
extensions from the authenticated source and this checkout, compares manifests,
then checks the complete ASAR renderer inventory byte-for-byte. Manifest claims
cannot authorize arbitrary extra code: altered CSS, undeclared files and forged
metadata fail verification. The real packaging script invokes that verification
before signing. Existing legacy-package verification remains available for old
artifacts; it is not the validation path for the new theme.

`branding/beebot-app-icon.svg` is owned, reproducible geometry. Native PNG/ICNS
outputs are generated into `.build/app-icon` from that SVG rather than retaining
stale binary branding in source. Packaging regenerates and copies the icon;
macOS repository CI runs the same icon generator, including all ten ICNS sizes.
Technical helper executable, protocol and compatibility identifiers are unchanged.

## Verification

New tests cover light/dark foreground and focus contrast, idempotent installation,
truthful states, deterministic and injection-safe artwork, CSP/anchor guards,
production-patch parsing, immutable input preservation and rebuilt ASAR integrity.
The CI prerequisite test keeps its strict command ordering and now additionally
requires icon generation; no previous check has been removed or made optional.

Local validation used Node 26.5.0 with the locked dependency graph and the
checksum-verified Mac renderer. Both TypeScript projects and the frontend build
passed. The Linux source checkout has Git LFS pointers instead of the preserved
installers; the archive verification belongs to unmodified full macOS CI with
`lfs: true`, not to a substitute fixture. Conditional integration tests still
retain their original conditions.

A local Chromium harness loaded actual sidebar, header, transcript, composer and
quote components with explicitly labeled sample data and controlled callbacks.
The Browser plugin was absent; localhost HTTP was blocked by the environment, so
the compiled components were loaded in memory. Validation covered:

- 1440×900 light/dark, 960×800, and 390×844 with the existing collapsed sidebar;
- first, second and third sends while the component is busy; independent queued
  feedback; IME candidate Enter not submitting;
- theme change preserving the same focused editor and draft; quote opening and
  cancellation; restoration of per-conversation drafts;
- incoming messages not stealing focus or a history-reading scroll position;
- reduced motion, no page-level horizontal overflow and no runtime page errors.

Those browser callbacks are not an LLM, server, or native macOS runtime. Existing
host/group/remote tests provide the separate persistence/queue/permission evidence.
The verification workflow is authoritative for the final submitted Git tree;
local screenshots are component evidence, not screenshots of a signed Mac app.

## Remaining release gates and later increments

A Mac still needs interactive checks for native window chrome, computer streaming,
voice, OS permissions, update/signing behavior and the installed Dock icon. No
signed/notarized build is published by this change. Do not describe CI as those
manual checks having passed.

The broader design roadmap includes a fully owned conversation shell, expanded
contextual member/results navigation, optional sidebar density and a richer
artifact-review experience. This increment themes the existing proven flows; it
does not invent a new task scheduler or claim those later flows are finished.
