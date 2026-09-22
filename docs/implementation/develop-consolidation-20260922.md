# Develop consolidation — September 22, 2026

The user explicitly requested integration of the recent BeeBot work into
`develop`. The first parent is its original `f713067e8773d0e53af661784d04e4a288531fb6`.
This is a semantic merge of all recorded product tips, not the union of every
prototype's schemas. The source histories remain reachable; no source branch is
force-pushed, deleted or rewritten. Tooling/export/candidate branches are not
merged. No private profiles, credentials, build evidence, `.dev-submit` payloads
or generated applications are placed in the product tree.

## Consolidation decisions

| Product branch | Pinned tip | Resolution |
| --- | --- | --- |
| `feat/bot-group-colleagues-20260921` | `5217957de163d5e6ca23f90582031e2d69945e98` | Earlier P0/P1 alternative superseded by current durable continuous-message implementation; no second delivery ledger. |
| `feat/collaboration-contracts-20260922` | `cfb86c91c9e450c52cec5a6c39aadcffb2f12bac` | Task responsibilities/dependencies/review/closure retained in primary format-1 journal. Alternative collaboration-schema/projection is superseded, not co-installed. |
| `feat/colleague-continuity-p0-p2-20260922` | `ccb44556ed97a1298492f7005a5518b085f315ab` | Included through its descendant integration history; existing product functionality and tests retained. |
| `feat/colleague-responsibilities-20260922` | `7fd68b49b214bd30854faf7be2be4740b6d08c70` | Included through its descendant integration history; existing product functionality and tests retained. |
| `feat/honeyline-theme-20260922` | `49880795f1ae4aa3db9a7051df212a90ffe0f102` | Included through its descendant integration history; existing product functionality and tests retained. |
| `feat/message-work-contracts-20260922` | `c157b10c435152401291ee72d6a541b88a347a7d` | Task-scoped questions and human review retained through primary CollaborationControls. Exact feedback notes, unavailable-evidence previews and uncertain-execution follow-up guard forward-ported. Separate work tables/RPCs are not co-installed. |
| `feat/natural-colleague-attention-20260922` | `253a460e8f1c0c6f735237f3334ebb3c67a517f6` | Included through its descendant integration history; existing product functionality and tests retained. |
| `feat/neutral-presence-avatars-20260922` | `276ba91f0c1f2496638787a8957e7cee35e0f7d6` | Neutral visual intent retained with the later eight-shape/eleven-color palette. Shared document motion coordinator forward-ported; six-shape replacement superseded. |
| `feat/node-installation-20260922` | `7fab604ebbc926150e64964c0d79aeb2d3860acf` | Included through its descendant integration history; existing product functionality and tests retained. |
| `feat/quoted-colleague-replies-20260922` | `02be4fec11cd4eb01a8e9f3864eb359427784c44` | Included through its descendant integration history; existing product functionality and tests retained. |
| `feat/remote-entry-reliability-20260921` | `da6e152bc0a8d6a181f80ab87ffe0dbe592c95f8` | Included through its descendant integration history; existing product functionality and tests retained. |
| `feat/work-review-closure-20260922` | `ec7384d1246ed45e46c7668ad13b2f49f0078019` | Task-scoped questions and human review retained through primary CollaborationControls. Exact feedback notes, unavailable-evidence previews and uncertain-execution follow-up guard forward-ported. Separate work tables/RPCs are not co-installed. |
| `feature/dev` | `c4f38ebc8c72863f761a3a9bcfb30d024a6439d9` | Provider selection, missing-vendor refusal, atomic settings recovery, secret handling and research documents integrated. Older forced-ack and removed-mention UI conflicts resolved to current continuous-chat behavior. |
| `feature/group-chat-ux` | `fb4691fea7ddd32ace83f9e3a6bbed815e1b611e` | Included through its descendant integration history; existing product functionality and tests retained. |
| `feature/optimization` | `c37a73fa4e5eff99809bbb6130331dc643737fae` | Included through its descendant integration history; existing product functionality and tests retained. |
| `fix/collaboration-regression-20260922` | `ddd0d0f6715b35cca04f126b3ef9a8b7041bef5d` | Durable publication, source/attempt evidence and synchronous navigation-stop fences forward-ported to primary collaboration journal with adapted regressions. |
| `fix/honeyline-reliability-20260922` | `976bb53d4bbac0c87e87169ca48b3b958ee38293` | Included through its descendant integration history; existing product functionality and tests retained. |
| `fix/honeyline-send-feedback-20260922` | `6ca9d5ecc8ce1f01f376e730909f4b2892c218d1` | Included through its descendant integration history; existing product functionality and tests retained. |

## One canonical runtime and UI

- Use `source/shared/collaboration.ts` and the transcript `collaborationEvent`
  journal, `getCollaboration`/`reviewCollaboration`, and its inline review adapter.
  Do not also register the abandoned `collaboration-work` tables or duplicate
  `getWorkReview`/`submitWorkReview` protocol. Human judgments remain trusted,
  quoted user control receipts with their complete criterion notes, not Bot
  self-approval. Parallel prototype runtime code remains available in its Git
  history for reference.
- This merge does not convert personal databases created by alternative
  experimental branches. No background migration or destructive schema cleanup
  is performed. Such profiles must be backed up and explicitly migrated before
  using those prototype task records with the canonical journal; their existence
  is not claimed as compatible merely because the merge is clean.
- Keep the latest neutral Presence design, original 8 silhouettes and 11 colors,
  live avatar picker and existing Presence actions. Preserve the role editor,
  independent app icon and separate remote/local creation drafts. Standalone
  shared motion coordination was ported so separately bundled surfaces do not
  double the animation budget. The earlier six-shape/color-remapping prototype
  is intentionally not restored.
- Provider settings durability from the older feature/dev line is retained.
  Missing configured providers fail explicitly instead of falling back to Cursor.
  Its mandatory opening acknowledgements and removal of scoped mentions conflict
  with the subsequently approved natural chat behavior and are superseded by
  the actual quoted publication, continuous-send and model-context regressions.
  Research notes remain historical snapshots, not current behavior promises.

## Unique safety fixes ported during conflict resolution

- Active and off-screen outgoing messages persist before UI publication and
  acknowledgement. Failed group preview persistence leaves it streaming and
  registered for cleanup, rather than promoting an unsaved result.
- New work submissions require task-linked evidence after the active attempt's
  boundary. Revisions/rework cannot reuse old result IDs. Separate review reports
  must follow the exact submission and belong to the same task. The primary
  protocol still permits reviewers to inspect the pinned submitted material;
  that is an explicit judgment, not a claim of a newly generated test report.
- Local stop controls invalidate synchronously on local or remote navigation,
  including an away/back sequence before rendering. Late responses cannot
  reactivate obsolete confirmation controls.
- Changed evidence is not previewed as its submitted version. Human feedback
  keeps its specific notes and never automatically resumes uncertain work.

## Validation and release boundary

Both pinned-toolchain typechecks, source regressions, actual renderer composition,
Node installation tests, creation/role/avatar regressions and the publication
export are required against the final tree. A dedicated macOS workflow also runs
real Host/Shell integration with deterministic model responses. Evidence and exact
counts are retained in workflow logs, not claimed by this file in advance.

Linux source-only checks can fail the preserved-installer assertion when only
Git LFS pointers are mounted; the final macOS gate must hydrate LFS, without
skipping or weakening that assertion. CI and deterministic model results do not
constitute production-model collaboration quality, native Mac UI, signed package
or release acceptance. This merge does not publish or automatically install an app.
