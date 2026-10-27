# Local service health

`GET /api/health` requires an authenticated launch session. Its HTTP status and top-level `ready` describe service liveness so the desktop can distinguish an unavailable service from a locked or unavailable workspace.

Readiness is reported separately:

- `serviceReadiness` describes services dependent on the scratch database.
- `scratch` checks the already opened scratch connection.
- `selectedWorkspace` checks the already opened selected database, its ownership binding, encrypted workspace descriptor, catalogue format and current authenticated metadata snapshot. It does not initialize an owner, repair data or scan records and originals.

Locked workspaces remain `locked`. Current access is checked before connecting and after inspection; expired or revoked access cannot return inspected details. No paths, credentials or underlying database exceptions are returned.

Each probe has a two-second deadline. At most two control connections are admitted in a service process. A filesystem call can outlive cancellation; its slot remains occupied until it drains, preventing timed-out requests from accumulating uncontrolled work. An oversized metadata payload is `incomplete` with `READINESS_LIMIT`, not a claim of corruption. The descriptor limit is 64 KiB and the encrypted head/snapshot payload limit is 2 MiB.

A successful selected probe reports `catalogueIntegrity: selected-metadata-verified`, `retainedContent: not-checked`, and `storageWrites: not-probed`. It is not a complete integrity audit, a write-permission test, a capacity guarantee or proof of storage durability. `filesystemPersistence` reports implemented OS barriers separately; `powerLossQualified` remains false.
