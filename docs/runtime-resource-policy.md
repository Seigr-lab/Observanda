# Runtime resource policy

Observanda applies admission limits inside each application service. Independent
projects and lab books keep their own encrypted data and database lifecycles.
Capacity limits do not combine their catalogues or keys.

## Foreground work

Ordinary requests share eight active handlers, sixteen waiting slots and 128 MiB
of retained encoded JSON input. Status, cancellation, health and diagnostics use
two separately reserved handlers and four waiting slots. Bootstrap has one active
handler and two waiting slots. Waiting admission expires after five seconds;
this does not interrupt an already executing save. JSON receipt has a fifteen
second inactivity timeout and a two minute total timeout. Streaming originals
use their existing bounded upload workflow.

Each owner permits one foreground writer and eight waiting writers. Waiting
writers across owners share thirty-two slots and a thirty second deadline.
These deadlines do not abort an admitted commit or change durable job leases.

## Databases and native preparation

Database work admits twelve logical connections per endpoint and twenty-four
across the service. Each admission reserves a primary connection and one
auxiliary connection for nested temporary work: at most forty-eight data-plane
connections. Two health-probe connections are separate. Waiting database work
shares 128 slots and a thirty second deadline. Global exhaustion refuses a new
request immediately, so holding a source owner does not require waiting for a
destination slot which that same operation prevents from becoming available.

Managed database launches, the temporary database guardian and media converters
share an estimated-memory budget: one quarter of physical RAM, between 512 MiB
and 8 GiB. At most sixteen managed database runtimes may be admitted. Each
runtime reserves its configured PostgreSQL shared buffers plus 192 MiB; the
default reservation is 256 MiB. New launches also check currently available
memory and preserve 512 MiB for foreground and other applications. Capacity
pressure requests closure of idle owner runtimes; active owners are retained.
An uncertain native shutdown continues to consume its reservation until
lifecycle recovery confirms the stop.

Converters share at most two active slots (one on smaller CPU configurations),
four waiting slots and a ten second waiting deadline. Their separate estimated
memory budget is one eighth of physical RAM, between 256 MiB and 2 GiB, within
the shared native budget. FFmpeg decoder, encoder and filter threads are limited
explicitly. Larger media limits require an explicit positive setting and still
undergo resource admission.

These are launch reservations and concurrency ceilings, **not OS-enforced RSS
limits**. Actual native memory can differ from the estimates. Separate service
processes do not share one coordinator; available-memory checks account for
current host pressure but do not constitute an atomic machine-wide reservation.
Parser confinement and process-tree workload qualification remain separate.

## Media defaults

| Setting | Default |
| --- | --- |
| Original media file | 1 GiB |
| Prepared display file | 2 GiB |
| Recording duration | 6 hours |
| Image dimensions | 64 million pixels |
| Audio channels | 64 |
| Audio sample rate | 384 kHz |
| Preparation execution | 30 minutes |
| Converter inactivity | 5 minutes, excluding output-storage backpressure |
| Free disk reserve | 1 GiB |

Blank or older zero-valued settings select the finite defaults. Original-file
evidence intake is distinct from preparing a display copy. A failed durable
media preparation retains its staged original for retry. Prepared output remains
temporary until conversion exits successfully; cancellation waits for child exit.
Free-space checks do not reserve all future disk growth across other writers.

## Inactive owner workers

Empty workers use jittered backoff up to thirty seconds. An owner unused for a
minute, after an empty claim, suspends normal polling and checks its durable queue
every four to five minutes. This allows its idle runtime to close. Revisiting the
owner or a local enqueue/control notification wakes it promptly. The periodic
check remains necessary for work written by another process and expired leases;
notifications are hints, not the authoritative queue. A running job is not
suspended. Lock, revocation and shutdown still drain workers and credentials.

The authenticated diagnostics view reports admission counters and waiting
intervals. A capacity refusal is retryable after work finishes; it does not mean
the requested owner or its saved data was removed.
