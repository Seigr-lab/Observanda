// Operating-system leases coordinate owners; their files contain no research.
// Match only exact internal locations, never arbitrary user attachment names.
const roots=new Set(['.observanda/write.lock','.observanda/project-retention.lock','.observanda/lab-books.lock']);
const bookLease=/^\.observanda\/lab-book-creation\/(?:[a-f0-9-]{36}|book-[a-f0-9-]{36}|name-[a-f0-9]{64})\.lock$/;
export const ownedStorageLeaseFile=relative=>roots.has(relative)||bookLease.test(relative);
