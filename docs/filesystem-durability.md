# Filesystem persistence and recovery

Atomic visibility and persistence across power loss are separate properties. Observanda's shared file writers flush and close a temporary file before replacing its destination. They never delete the destination to bypass a sharing violation.

After replacement, the shared replacement helper syncs the destination directory and, when different, the source directory on platforms with a directory `fsync` interface. Newly created private directories sync their own handle and then their parent before callers publish retained files beneath them. These barriers occur before the writer reports success and before its caller can publish a database reference or completion receipt.

| Storage profile | Implemented sequence | Qualification boundary |
| --- | --- | --- |
| Ubuntu, local filesystem accepting directory `fsync` | Flush temporary file, close, atomic rename, sync destination and source directories | Requires filesystem, virtual machine and hardware crash qualification; syscall success alone is not proof against storage-cache loss. |
| Windows, local filesystem | Flush temporary file, close, atomic rename with bounded sharing retries | Node does not expose a qualified directory persistence primitive here. Atomic replacement is provided; directory-entry persistence across power loss is not guaranteed. |
| Network or removable storage | The corresponding OS sequence above | Server acknowledgements, device caches, disconnects and mount semantics require separate qualification. A successful local flush does not establish remote power-loss durability. |

If a directory barrier fails after a namespace change, the operation returns `DURABILITY_UNCERTAIN` with `commitUncertain: true`. The new destination may already be visible. The original filesystem exception stays private; the client receives no path. Replacement is not retried, and the newly published destination is not deleted as a rollback. Inspect the retained revision or lifecycle receipt before explicitly resuming the operation. Do not automatically repeat a mutation with an uncertain outcome.

PostgreSQL transactions retain their own WAL durability requirements. A database reference must follow successful retained-file finalization. Catalogue archive bytes flush before the read transaction completes and before the archive destination is replaced. Recovery receipts must precede destructive lifecycle transitions; a destination must be verified and registered before source retirement. Keyring changes must retain the old recovery authority until the new files and references have been verified.

Project, lab-book and workspace rename/move paths now use the replacement barrier, including destination publication and source retirement. Resume repeats a failed rename barrier before advancing its receipt. Owner-root and runtime directory creation flush newly created ancestors; deletion completion follows removal of the retired directory and its parent barrier. Local export applies the barrier before recording a replaced or hard-linked file as complete. The guards continue to verify retained directory identities and preserve independently owned children.

These integrations do not establish universal persistence for every supported filesystem or every historical workflow. Full-disk, interrupted key rotation, archive/copy recovery and actual VM/power-loss acceptance remain required. Process termination and injected barrier failures establish recovery behavior only at the injected boundaries.

See the [Linux `fsync` contract](https://www.man7.org/linux/man-pages/man2/fsync.2.html), which requires a separate directory sync for directory entries, and [PostgreSQL's reliability guidance](https://www.postgresql.org/docs/current/wal-reliability.html).
