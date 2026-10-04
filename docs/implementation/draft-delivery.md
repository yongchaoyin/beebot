# Editable external drafts

The pinned 0.18 renderer's Email and Slack cards had empty send/discard callbacks.
BeeBot now shares one editable card implementation between readable production
and the actual patched lazy renderer. A card publishes a proposal through
SendMessage; creating a draft never performs the external send.

## Production path and ownership

`SendMessage` accepts `email-draft` and `slack-draft`, with a strictly validated
`draft` payload. Existing encoding, transcript shaping and local Group publication
retain those shapes. External `channel` dispatch and forged draft status/receipt
fields are rejected. Shared cross-user rooms retain their existing text-only rule.

Local Group publication gives Email/Slack proposals a fixed, nonempty history title:
“draft proposal for user confirmation. Publishing the proposal does not send it
externally.” The title describes the publication event, so it does not claim that
a later sent/discarded draft is still awaiting confirmation. The editable
contents remain on the card. Targets, subjects, bodies, `@` text and links inside
the draft cannot route peer work or enter the conversation Library. A proposal is
awaiting user confirmation and does not wake peers. Its real durable SendMessage
receipt confirms only that the proposal reached the conversation; external
delivery still requires the separate connector receipt below. A human can quote
the proposal to address its actual Bot author, with the normal current-member
checks.

The card first calls `getDraftDelivery({agentId, entryId})`. Host resolves the
actual durable entry, verifies the conversation and author, and checks local
Group membership. Sending uses the draft author as the routed MCP executor owner;
opening a background session does not change the selected conversation. Remote
room cards and remote-active renderer views fail closed.

`resolveDraftDelivery` takes `agentId`, `entryId`, a secure stable `requestId`,
`expectedVersion`, `expectedHash`, `action`, and edited `message` when sending.
Sending also requires `expectedSenderHash`; the card passes the selected
connection's `senderId`. Users may edit Email To/Cc/subject/body or Slack body.
The proposed Email From and Slack workspace/channel/thread cannot silently change.

Snapshot sender fingerprints include the exact live tool descriptor and known
installed connection identity (account key, plugin, server and status). Host checks
that the reviewed fingerprint still matches its first live lookup and verifies
it again immediately before starting. Changing account A to B between loading
and confirmation fails even if both later lookups see B. Multiple compatible
providers require an explicit selection. Known account keys are connection
metadata: they do not prove the authenticated principal, and this implementation
does not claim isolation when the connector cannot expose that identity.

## Supported sending contracts

The reference MCP Slack server is an explicit verified adapter, based on the
[official archived MCP Slack implementation](https://github.com/modelcontextprotocol/servers-archived/blob/main/src/slack/index.ts).
Its live schema must contain exactly these required string fields:

| Tool | Fields | BeeBot mapping |
| --- | --- | --- |
| `slack_post_message` | `channel_id`, `text` | draft target, edited body |
| `slack_reply_to_thread` | `channel_id`, `thread_ts`, `text` | target, thread timestamp, edited body |

The target must already be a confirmed Slack channel ID. BeeBot does not guess
IDs from `#channel` names. Extra/unhandled required properties and differently
shaped similarly named tools are unsupported. Only an MCP success result carrying
Slack JSON with `ok: true`, the requested channel, a real timestamp, and matching
message text when present confirms sent. Generic tool transport success is
insufficient.

Email presently supports only an explicitly declared BeeBot v1 MCP contract:
input schema metadata `x-beebot-draft-delivery: {version: 1, kind: "email"}`,
object properties To/Cc arrays of strings and From/subject/body strings, requiring
To/subject/body. Only edited draft fields are passed. A successful result must
contain `structuredContent: {sent: true, messageId: <nonempty string>}`.
The same declared contract may use `kind: "slack"` with target/body and optional
workspace/thread. No Gmail or Outlook provider adapter, current installed Email
account, real Email send, or live Slack send was verified in this stage. Existing
providers without either supported contract remain visibly unavailable; their
presence or description is never inferred to be a sending capability.

## Durable outcomes and recovery

Before external execution, Host saves the edited content and `sending` state in
the real conversation SQLite database. Failed persistence prevents execution.
Only a verified receipt transitions to `sent`. Discard saves `discarded` without
calling a connector; it never pretends to retract an external effect.

Unrecognized receipts, tool errors and thrown/unknown execution results become
`needs-review`. A receipt persistence failure leaves durable `sending`, which
recovers to `needs-review` after restart. Legacy `sent` without a durable delivery
record is also unconfirmed. These drafts cannot automatically replay. The same
request ID and identical payload reuse one in-flight or persisted attempt;
changing contents under the same ID is rejected. Transcript versions, connector
fingerprints and request deduplication are separate checks.

The renderer binds reads and acknowledgements to selection and connection
versions, and observes asynchronous remote-active body changes. Stale responses
never appear in another conversation. Disconnection clears view busy state so a
read-only reload remains possible; it does not cancel a server send. Bounded
requests retain edited input when the outcome is uncertain. No card claims sent
from raw legacy entry metadata.

## Validation

Pinned Node 26.5 tests bundle the actual modified Host service and use the real
`SandAgentSessionStore`/SQLite transcript database. Controlled MCP executors cover
Bot/Group ownership, edited contents, second/third sends while another is in
flight, duplicate clicks, stable request IDs, stale entries and accounts,
unsupported schemas, wrong/unknown receipts, durable-write failures, restart
recovery, and selected-transcript updates. `createHostGatewayApi` is exercised
with the real routed executor argument conversion and installed-account catalog.

The actual lazy wrapper patches run with the shared React card and real Host
storage in component tests; native frames are controlled fixture wrappers.
`verify-native-draft-delivery.mjs` stages the real renderer adapter, verifies the
exact shared module is injected, and runs both actual staged lazy wrappers in
checksum-verified Electron 42.1.0. Its 32 combinations cover Bot/Group,
Email/Slack, English/Chinese, light/dark, 800/390 px windows; 385 checks include
edited first/second/third sends, focus, discard, uncertain receipts, layout and
chat-draft preservation. Native RPC results are controlled fixtures, not a live
Node/provider integration. No user profile, credential, real external send or
whole installed-app send was used.

The merge-stage `group-draft-publication.test.mjs` adds five actual Group pipeline
regressions using the real SendMessage tool, Group orchestrator/Glue and SQLite
conversation harness. They cover three distinct proposals while second/third
human messages arrive, real proposal receipts, safe history, no peer wake, Library
exclusion, human quotes, failed persistence and a removed author. The focused
draft/quote/peer/local-routine/Library suite passes 67/67 with no skips under Node
26.5.0. Model/OS/connector I/O remain controlled; no external send is attempted.
