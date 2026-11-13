// Database access for a project or sub-project. Its catalogue lives in the
// PostgreSQL cluster of the workspace that contains its folder, under the
// project's own role (owner-postgres.js); a project never runs a cluster.
import {OwnerPostgres,OWNER_NESTED_DATABASE_DIRECTORY,assertOwnerDatabaseFrozen} from './owner-postgres.js';
import {assertCatalogueOwner} from './project-catalogue-owner.js';

// The earlier per-project cluster location; refused when present.
export const PROJECT_DATABASE_DIRECTORY=OWNER_NESTED_DATABASE_DIRECTORY;
export class ProjectPostgres extends OwnerPostgres{
 ownerEnvironment(root,projectId){return {OBSERVANDA_PROJECT_DATABASE_ROOT:root,OBSERVANDA_PROJECT_ID:projectId};}
 assertOwner(binding,projectId){assertCatalogueOwner(binding,projectId);}
 async closeProject(root){await this.closeOwner(root);}
}
// Renames, moves and deletions freeze the project instead of stopping a
// cluster; this proves the freeze (owner-postgres.js).
export async function assertProjectDatabaseStopped(root,projectId,vault){await assertOwnerDatabaseFrozen('project',root,projectId,vault);}
