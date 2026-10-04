# Conversation library

The Library lives in the existing conversation-details overview for both local
individual Bots and Groups. It collects pages, files and HTTP links from loaded,
durable public `send-message` entries. Public attachment cards and result previews
stay in their original conversations. The same file shared in separate messages
keeps separate source records, including the actual colleague and publication
time. The collection is a delivery index, not a completion or capability judgment.

Private assistant text, streamed previews, pending/failed/uncertain sends,
branched entries, tool results, receipts, unsent drafts and external-channel
messages do not become library items. A published link does not assert that its
target still exists or that an external action succeeded. No task is created or
completed by opening Library. Earlier history is read through the existing
transcript pagination on an explicit click; no new Host RPC or filesystem scan is
introduced. The collection is bounded to 2,000 loaded items.

Opening an item retains its source message and time. Local text/page previews use
the existing attachment bridge after the user clicks. HTML and Markdown are shown
as text; Library does not execute attached HTML. Supported media use the existing
attachment-media bridge and protocol. HTTP links are opened externally only after
an explicit second click; credentials, controls and unsupported URL schemes are
rejected. File URLs are never handed to `openExternal`. Existing attachment owner
and read permissions continue to apply. Unavailable previews retain the selected
conversation and its draft, show a recoverable explanation and never retry
external operations automatically.

The actual shipped renderer contains the adapter in
`scripts/lib/beebot-conversation-library.snippet.js`. The pinned overview receives
a conversation-owned host through `conversation-library-renderer-patch.mjs`.
Selection, connection, transcript-install and pane-lifetime generations discard
late reads. Closing the details view invalidates preview navigation and releases
its UI state without stopping Bot work. Local library subscriptions/items are
cleared and hidden while remote Node selection is active; this stage does not
claim a remote, cross-account library, since that view has separate protocol and
principal boundaries.

Validation uses Node 26.5.0. The new 13-test UI suite and the existing collaboration
and conversation-status suites passed all 42 tests. The composed pinned renderer
and new Library suite passed all 14 tests. `node
scripts/verify-native-conversation-library.mjs` passed 66 checks in isolated macOS
Electron: single/Group, English/Chinese, light/dark, 800/390-DIP windows, safe file
preview, correct delivery filtering, focused controls and preserved drafts across
second/third incoming sends. It uses the exact staged `p3n` overview, Library
adapter and language runtime, with controlled roster/transcript/attachment APIs
and neighboring leaf components. No production profile, paid model, real external
link operation or Node/Host integration is exercised. Screenshots and the native
report remain ignored under `.build/library-verification`. The later combined
Library/proactive-followup run passed 98 checks with no console errors, including
explicit opt-in creation and reuse of the overview across Bot/Group selection.
