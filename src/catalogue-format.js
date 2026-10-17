// The storage generation changes in the writer's transaction, together with
// its first new representation. Older applications reject unknown generations.
import {AppError} from './errors.js';
// New representations can be introduced with independent domain, settings
// and website owners. Preserve their requirements in either upgrade order.
export const catalogueRequiresDomains=format=>[22,24,25,27,28,30,31,33,34,36,37,39,40,42,43,45,46,48,49].includes(format);
export const catalogueRequiresSettings=format=>[25,28,31,34,37,40,43,46,49].includes(format);
export const catalogueRequiresWebsites=format=>[29,30,31,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49].includes(format);
export const catalogueRequiresStagedEvidence=format=>[32,33,34,35,36,37,41,42,43,47,48,49].includes(format);
export const catalogueRequiresWebsiteEditor=format=>[38,39,40,41,42,43,44,45,46,47,48,49].includes(format);
export const catalogueRequiresWebsitePresentation=format=>[44,45,46,47,48,49].includes(format);
export async function catalogueFormat(db){
 const rows=await db.all('SELECT version FROM catalogue_format');
 if(rows.length!==1||![3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49].includes(rows[0].version))throw new AppError('CATALOGUE_DAMAGED');
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
export async function requireWorkspaceSettings(db){
 await requireWorkspaceDomains(db);const format=await catalogueFormat(db);
 return requireCatalogueFormat(db,catalogueRequiresWebsitePresentation(format)?catalogueRequiresStagedEvidence(format)?49:46:catalogueRequiresWebsiteEditor(format)?catalogueRequiresStagedEvidence(format)?43:40:catalogueRequiresStagedEvidence(format)?catalogueRequiresWebsites(format)?37:34:format>=29?31:format>=26?28:25);
}
export async function requireWorkspaceDomains(db){
 await requireRetiredProjectRecords(db);const format=await catalogueFormat(db);
 return requireCatalogueFormat(db,catalogueRequiresWebsitePresentation(format)?catalogueRequiresStagedEvidence(format)?48:45:catalogueRequiresWebsiteEditor(format)?catalogueRequiresStagedEvidence(format)?42:39:catalogueRequiresStagedEvidence(format)?catalogueRequiresWebsites(format)?36:33:format>=29?30:format>=26?27:24);
}
export async function requireProjectDomains(db){
 const format=await catalogueFormat(db);
 return requireCatalogueFormat(db,catalogueRequiresWebsitePresentation(format)?catalogueRequiresStagedEvidence(format)?48:45:catalogueRequiresWebsiteEditor(format)?catalogueRequiresStagedEvidence(format)?42:39:catalogueRequiresStagedEvidence(format)?catalogueRequiresWebsites(format)?36:33:format>=29?30:format>=26?27:22);
}
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
export async function requireWebsiteDocuments(db){
 const previous=await catalogueFormat(db),domains=catalogueRequiresDomains(previous)||previous===23&&Boolean(await db.get('SELECT 1 FROM state WHERE slot=$1','project-domains'));await requireRetiredProjectRecords(db);
 return requireCatalogueFormat(db,catalogueRequiresStagedEvidence(previous)?catalogueRequiresSettings(previous)?37:domains?36:35:catalogueRequiresSettings(previous)?31:domains?30:29);
}
export async function requireStagedEvidence(db){
 const previous=await catalogueFormat(db);
 // Generation 23 admitted a retired-record index on either a plain catalogue
 // or an existing project owner. Preserve that older optional domain owner.
 const domains=catalogueRequiresDomains(previous)||previous===23&&Boolean(await db.get('SELECT 1 FROM state WHERE slot=$1','project-domains'));
 await requireRetiredProjectRecords(db);
 const base=catalogueRequiresWebsitePresentation(previous)?47:catalogueRequiresWebsiteEditor(previous)?41:catalogueRequiresWebsites(previous)?35:32;
 return requireCatalogueFormat(db,base+(catalogueRequiresSettings(previous)?2:domains?1:0));
}
// Durable website drafts and keyed collection descriptors must be understood
// before any writer can open their catalogue, including after restore.
export async function requireWebsiteEditor(db){
 await requireWebsiteDocuments(db);const previous=await catalogueFormat(db);
 const base=catalogueRequiresStagedEvidence(previous)?41:38;
 return requireCatalogueFormat(db,base+(catalogueRequiresSettings(previous)?2:catalogueRequiresDomains(previous)?1:0));
}
// Selected presentation collections retain their own indexes and checkpoints.
// Older readers must decline the catalogue before writing those representations.
export async function requireWebsitePresentation(db){
 await requireWebsiteEditor(db);const previous=await catalogueFormat(db);
 const base=catalogueRequiresStagedEvidence(previous)?47:44;
 return requireCatalogueFormat(db,base+(catalogueRequiresSettings(previous)?2:catalogueRequiresDomains(previous)?1:0));
}
export async function requireRecordResultIndexes(db){
 const previous=await catalogueFormat(db);await requireRetiredProjectRecords(db);
 return requireCatalogueFormat(db,catalogueRequiresSettings(previous)?28:catalogueRequiresDomains(previous)?27:26);
}
export async function requireFigureCopyDrafts(db){return requireCatalogueFormat(db,15);}
async function requireCatalogueFormat(db,version){
 if(await catalogueFormat(db)>=version)return;
 await db.run('ALTER TABLE catalogue_format DROP CONSTRAINT catalogue_format_version_check');
 await db.run('ALTER TABLE catalogue_format ADD CONSTRAINT catalogue_format_version_check CHECK(version IN (3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49))');
 await db.run('UPDATE catalogue_format SET version=$1 WHERE version<$1',version);
}
