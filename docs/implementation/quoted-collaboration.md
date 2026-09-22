# Quoted colleague collaboration

## Stage 1 — runtime relationships and exact response accounting

A message's direct quote (`reply_to`) is distinct from its optional original
assignment association (`work_on`). Both are validated against quotable messages
in the same conversation. Neither grants permission, claims task completion nor
changes the user's confirmed boundaries. Ordinary discussion remains in the
existing chat; this does not create a separate task dashboard or permanent boss.

Group prompts show each pending request independently and hydrate the directly
quoted messages and their ancestors from authorized room history, including older
assignments outside the normal recent-message window. Context size and traversal
are bounded; unavailable references are stated, not fabricated. Shared rooms
retain their existing restricted history window.

Use `reply_to` on the immediate question when clarifying, and on the original
assignment when delivering its result. `work_on` can preserve the assignment while
the direct quote points to a clarification. General updates may omit a quote;
they are not counted as answers to every request in a coalesced turn. An actual
quoted publication records its durable message ID for the addressed recipient.
Response evidence survives restart separately from work execution. A question or
an acknowledgement is still a response, never proof of delivery or acceptance.

Single-Bot sends use the same explicit-reference validation and bounded quoted
context. A normal response defaults to the current user message rather than an
older quoted ancestor; explicit reply targets and intentional forks take priority.
Invalid user/Bot quotes fail before publication instead of silently becoming an
unquoted new message. Credentials, external-channel entries and unfinished output
are not quote targets.

Validation: 8 new runtime tests use the actual ingress, routing, publication and
SQLite transcript paths with deterministic model/OS substitutes. They cover A
assigning two jobs to B and one each to C/D, clarification followed by a result
quoting the original assignment beyond 24 messages, independent response records,
explicit reviewer mentions, invalid/cross-room targets, bounded cycles, and
single-Bot context. This is not a production-model or native Mac UI acceptance.

## Stage 2 — shared inline quotation UI and same-chat navigation

The readable frontend and the shipped checksum-pinned renderer now render the
same quote components, using the existing React runtime. Quotes show the original
author and a bounded text/file/image label. The composer shows the exact selected
reference; cancelling it clears the quote, not the message or attachments. Names
and excerpts are text, not executable HTML or a request to fetch an arbitrary URL.

Default quotation navigation stays in the current conversation. The pinned
renderer uses its existing paginated transcript-reveal machinery with a separate
quote marker, retained across each page. It does not open a thread or hover
popup. The readable renderer uses a bounded, account/conversation-scoped history
resolver. Late lookup failures cannot contaminate another chat. Missing or not-yet
loaded originals remain explicitly unavailable, not assumed deleted, and retain
their reference. Explicit thread features outside ordinary quoting are retained.

The readable composer's account-scoped persisted draft also retains its quoted
message when no live selection exists after restoration. Selection is persisted
before typing; explicit cancellation updates the stored draft, and submission
uses the displayed identity. Host validation remains authoritative for stale or
unauthorized targets. This is not a new cross-server quote protocol.

Local verification used Node 26.5.0 and locked dependencies: both typechecks and
the frontend build passed. All 14 new quote UI/navigation tests and the 8 runtime
scenarios passed. The full suite ran 328 tests: 318 passed, 9 conditional skips,
and one preserved-installer inventory failure because the Linux export contains
a Git LFS pointer rather than the 155,793,020-byte installer. No test or assertion
was removed; macOS CI must hydrate LFS and verify the submitted tree.

Playwright/Chromium ran 12 rendered checks at 1280x840 and 390x844 in Chinese /
English and light / dark, including cancellation, unavailable original, focus,
late navigation, and single-Bot quotes. Browser plugin was not listed. Managed
Chromium blocked local HTTP, so known fixture bytes were rendered offline on
about:blank without changing that policy. The quote/composer/reference functions
were extracted from the actual patched production renderer, not rewritten mocks;
the outer chat, roster, transcript and navigation host were controlled fixtures.
No page exception or console error/warning was observed. This is component QA,
not a native Mac app, production-model test or distribution-signing gate.

Original-work association is explicit optional metadata, not an inferred task
manager, automatic acceptance or proof of content correctness. Models must use
the real message identities; runtime validates references and response evidence.
Shared-room history and tool authorization boundaries are unchanged. Remote Node
conversations without quote protocol support do not silently acquire local-only
features. Native model/OS and installed application acceptance remain required
before claiming a release.
