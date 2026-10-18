// Operating-system leases coordinate owners; their files contain no research.
// Match only exact internal locations, never arbitrary user attachment names.
const roots=new Set(['.observanda/write.lock','.observanda/project-retention.lock','.observanda/lab-books.lock']);
const bookLease=/^\.observanda\/lab-book-creation\/(?:[a-f0-9-]{36}|book-[a-f0-9-]{36}|name-[a-f0-9]{64})\.lock$/;
const projectLease=/^\.observanda\/(?:lab-book-directory|project-import-addresses|project-imports|project-incoming-owners|project-membership|project-lifecycle|project-copies|project-archives|project-moves|project-deletions)\/[a-f0-9-]{36}\.lock$/;
const projectCreationLease=/^\.observanda\/project-creation\/(?:owner-)?[a-f0-9-]{36}\.lock$/;
const projectRevisionLease=/^\.observanda\/project-owner-revisions\/[a-f0-9-]{36}\.obsv\.lock$/;
export const ownedStorageLeaseFile=relative=>roots.has(relative)||bookLease.test(relative);
// Preserve the established inventory fingerprint. Fresh-key copying alone
// omits these additional plaintext lease controls instead of decrypting them.
export const workspaceOwnerLeaseFile=relative=>ownedStorageLeaseFile(relative)||relative==='.observanda/project-registry.lock'||projectLease.test(relative)||projectCreationLease.test(relative)||projectRevisionLease.test(relative);
