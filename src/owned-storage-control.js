import {STAGING_NAMESPACE_LEASE,STAGING_ADMISSION_LEASE} from './staging-reservation-files.js';
import {websiteLeaseFile} from './website-upgrade-lease.js';
// Operating-system leases coordinate owners; their files contain no research.
// Match only exact internal locations, never arbitrary user attachment names.
const roots=new Set(['.observanda/write.lock','.observanda/project-retention.lock','.observanda/lab-books.lock','.observanda/.postgresql.runtime-upgrade.lock']);
const bookLease=/^\.observanda\/lab-book-creation\/(?:[a-f0-9-]{36}|book-[a-f0-9-]{36}|name-[a-f0-9]{64})\.lock$/;
const projectLease=/^\.observanda\/(?:lab-book-directory|project-import-addresses|project-imports|project-incoming-owners|project-membership|project-lifecycle|project-copies|project-archives|project-moves|project-deletions)\/[a-f0-9-]{36}\.lock$/;
const projectCreationLease=/^\.observanda\/project-creation\/(?:owner-)?[a-f0-9-]{36}\.lock$/;
const projectRevisionLease=/^\.observanda\/project-owner-revisions\/[a-f0-9-]{36}\.obsv\.lock$/;
const reviewLease=/^\.observanda\/reviews\/leases\/[a-f0-9-]{36}\.lock$/;
// Staging and website leases are defined by their owning modules. They belong
// to the folder that holds them; a copy or move never carries them.
const stagingLeases=new Set(['.observanda/'+STAGING_NAMESPACE_LEASE,'.observanda/staging-reservations/'+STAGING_ADMISSION_LEASE]);
export const ownedStorageLeaseFile=relative=>roots.has(relative)||bookLease.test(relative)||reviewLease.test(relative)||stagingLeases.has(relative)||websiteLeaseFile(relative);
// Native staging and query-cache controls are bound to the folder that holds
// them. Inventories leave them out, so a copied owner never carries them.
const nativeControlDirectories=['.observanda/staging-reservations','.observanda/query-cache'];
export const ownerNativeControl=relative=>relative==='.observanda/'+STAGING_NAMESPACE_LEASE||nativeControlDirectories.some(directory=>relative===directory||relative.startsWith(directory+'/'));
// Preserve the established inventory fingerprint. Fresh-key copying alone
// omits these additional plaintext lease controls instead of decrypting them.
export const workspaceOwnerLeaseFile=relative=>ownedStorageLeaseFile(relative)||relative==='.observanda/project-registry.lock'||projectLease.test(relative)||projectCreationLease.test(relative)||projectRevisionLease.test(relative);
// A runtime transition is not an ordinary encrypted research file. Refuse an
// inventory while these recovery controls exist; never hide or retire them.
export const runtimeUpgradeControlKind=relative=>relative==='.observanda/.postgresql.runtime-upgrade'?'file':/^\.observanda\/\.runtime-(?:upgrade|retired)-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(relative)?'directory':null;
