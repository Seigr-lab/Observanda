// The storage generation changes in the writer's transaction, together with
// its first new representation. Older applications reject unknown generations.
import {AppError} from './errors.js';
export async function catalogueFormat(db){
 const rows=await db.all('SELECT version FROM catalogue_format');
 if(rows.length!==1||![3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25].includes(rows[0].version))throw new AppError('CATALOGUE_DAMAGED');
 return rows[0].version;
}
export async function requireRecordBlocks(db){
 return requireCatalogueFormat(db,4);
}
export async function requireRecordQueryBlocks(db){return requireCatalogueFormat(db,5);}
export async function requireSearchVocabulary(db){return requireCatalogueFormat(db,16);}
export async function requireJoinedQueryText(db){return requireCatalogueFormat(db,17);}
export async function requireKeyedQueryArrays(db){return requireCatalogueFormat(db,18);}
export async function requireReferenceQueries(db){return requireCatalogueFormat(db,19);}
export async function requireAttemptQueries(db){return requireCatalogueFormat(db,20);}
export async function requireStarterDocuments(db){return requireCatalogueFormat(db,21);}
export async function requireRetiredProjectRecords(db){
 if(await catalogueFormat(db)>=23)return;
 await db.run('CREATE INDEX records_scope_revision ON records(scope_id,generation,id,revision COLLATE \"C\")');
 return requireCatalogueFormat(db,23);
}
export async function requireWorkspaceSettings(db){await requireWorkspaceDomains(db);return requireCatalogueFormat(db,25);}
export async function requireWorkspaceDomains(db){await requireRetiredProjectRecords(db);return requireCatalogueFormat(db,24);}
export async function requireProjectDomains(db){return requireCatalogueFormat(db,22);}
export async function requireDraftDocuments(db){return requireCatalogueFormat(db,5);}
export async function requireMemberCollections(db){return requireCatalogueFormat(db,6);}
export async function requireSelectedValueDrafts(db){return requireCatalogueFormat(db,7);}
export async function requireRetainedRecordDocuments(db){return requireCatalogueFormat(db,8);}
export async function requireRunReceiptStore(db){return requireCatalogueFormat(db,9);}
export async function requireDraftEdits(db){return requireCatalogueFormat(db,10);}
export async function requireAttemptIndexes(db){return requireCatalogueFormat(db,11);}
export async function requireCurrentAttemptIndexes(db){return requireCatalogueFormat(db,12);}
export async function requireRecordTypeDrafts(db){return requireCatalogueFormat(db,13);}
export async function requireRecordMethodIndexes(db){return requireCatalogueFormat(db,14);}
export async function requireFigureCopyDrafts(db){return requireCatalogueFormat(db,15);}
async function requireCatalogueFormat(db,version){
 if(await catalogueFormat(db)>=version)return;
 await db.run('ALTER TABLE catalogue_format DROP CONSTRAINT catalogue_format_version_check');
 await db.run('ALTER TABLE catalogue_format ADD CONSTRAINT catalogue_format_version_check CHECK(version IN (3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25))');
 await db.run('UPDATE catalogue_format SET version=$1 WHERE version<$1',version);
}
