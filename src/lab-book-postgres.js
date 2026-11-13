// Database access for a lab book. Its catalogue lives in the PostgreSQL
// cluster of the workspace that contains its folder, under the lab book's own
// role (owner-postgres.js). Moving the book changes its location, not its
// cryptographic identity, and a lab book never runs a cluster.
import {OwnerPostgres,OWNER_NESTED_DATABASE_DIRECTORY,assertOwnerDatabaseFrozen} from './owner-postgres.js';
import {assertLabBookCatalogueOwner} from './lab-book-catalogue-owner.js';

// The earlier per-book cluster location; refused when present.
export const LAB_BOOK_DATABASE_DIRECTORY=OWNER_NESTED_DATABASE_DIRECTORY;
export class LabBookPostgres extends OwnerPostgres{
 ownerEnvironment(root,labBookId){return {OBSERVANDA_LAB_BOOK_DATABASE_ROOT:root,OBSERVANDA_LAB_BOOK_ID:labBookId};}
 assertOwner(binding,labBookId){assertLabBookCatalogueOwner(binding,labBookId);}
 async closeLabBook(root){await this.closeOwner(root);}
}
// Renames, moves and deletions freeze the book instead of stopping a
// cluster; this proves the freeze (owner-postgres.js).
export async function assertLabBookDatabaseStopped(root,labBookId,vault){await assertOwnerDatabaseFrozen('lab-book',root,labBookId,vault);}
