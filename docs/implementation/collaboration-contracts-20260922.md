# Message-led work contracts

## C1: real responsibility on a quoted publication

The local Host now accepts optional structured work semantics on `SendMessage`.
Ordinary chat still uses the existing message surface. An `assign` publication
states a deliverable and 1–8 acceptance criteria. Its durable message address is
the task identity. An eligible colleague explicitly `claim`s it with the expected
version; `block` reports a reason to the assigning colleague. These are work
facts, not additional authorization, execution proof, or completion claims.

The validated event and visible text share ONE SQLite transcript entry. The Host
validates and appends synchronously. Projection is reconstructed from that journal;
there is no independently committed work JSON file or fake-success UI update.
This relies on the existing single owning Host, not a cross-server lock protocol.

`intent:update` is visible but does not trigger the whole group, even when it
quotes previous progress. Existing unannotated conversations retain their routing.
An explicit work event supplies validated recipients. Claims are visible without
inviting another round of acknowledgements. Work context is passed into the actual
group runner and direct Bot runner. Cross-owner rooms and external channels cannot
carry these work mutations. Nothing auto-replays after restart.

Verification: pinned Node 26.5.0 source typecheck and 7 targeted tests passed.
Tests use the actual group ingress, scheduler, publication and SQLite transcript;
model and OS execution are controlled. The single-Bot test exercises the real
outgoing update handler. Native Mac interaction and production models are not
covered by those tests. This stage does not yet implement dependencies or review.
