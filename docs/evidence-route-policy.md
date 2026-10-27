# Evidence route contracts

`src/material-route-policy.js` declares the evidence commands used by workspace, project and lab-book dispatch. Each contract identifies the HTTP method, input shape and size, owning validator, read/write classification, authenticated owner, admission lane, snapshot eligibility, cancellation boundary and private response type. Referenced evidence reads reuse that contract while requiring authority for the explicitly addressed owner. They cannot dispatch a mutation.

Request admission and workspace snapshot admission consume the same declarations. Integrity verification uses write admission because it can initialize a derived index. Job inspection remains outside snapshot admission because it may activate a worker. Source authorization, immutable revisions and field validation remain enforced by their owning command implementations; the route catalogue does not replace them.

Contract checks enumerate the implemented evidence commands and reject missing declarations. Focused HTTP checks cover malformed selection queries, method mismatches, stale workspace contexts, locked owners and incorrect ownership. Native checks exercise nested lab-book authoring, exact original downloads after relocation, and cancellation of a disconnected queued writer before mutation. This catalogue covers evidence routes, not every application endpoint.

HTTP admission, writer waiting and evidence transports share one response-close subscription. Each layer still decides whether its operation must cancel or may continue durably after disconnection, and unregisters its callback when finished. This avoids redundant listeners without increasing listener-warning thresholds or changing commit recovery.
