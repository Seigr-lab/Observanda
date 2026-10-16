// A converted project carries only its own legacy identities. Reopening it
// publishes those locations with membership in the receiving workspace.
import {ProjectReferenceAliases} from './project-reference-aliases.js';
import {validProjectSourceAuthority} from './project-source-authority.js';
import {validTableRef} from './retained-table-index.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
export async function projectPortableReferences(storage,entry){
 const saved=await storage.catalogue(store=>store.object('project:adoption'));
 if(!saved)return null;
 const receipt=saved.receipt;
 if(Object.keys(saved).sort().join()!=='aliases,fingerprint,ready,receipt,version'||saved.version!==1||typeof saved.ready!=='boolean'||!revisionId(saved.fingerprint)||!validProjectSourceAuthority(receipt)||receipt.projectId!==entry.projectId||receipt.namespaceId!==entry.namespaceId||receipt.vaultId!==entry.vaultId||storage.projectId!==entry.projectId||!validTableRef(saved.aliases)||!saved.aliases)throw new AppError('CATALOGUE_DAMAGED');
 if(!saved.ready)throw new AppError('STORAGE_PROJECT_BUSY');
 const owner={version:1,projectId:entry.projectId,sourceNamespace:receipt.sourceNamespace,namespaceId:entry.namespaceId},aliases=new ProjectReferenceAliases(storage);
 return {owner,targets:()=>aliases.targets(saved.aliases,owner)};
}
