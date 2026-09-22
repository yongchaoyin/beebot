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
