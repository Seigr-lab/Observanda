import {requirePublicationDocuments} from './catalogue-format.js';
import {catalogueContext} from './research-catalogue.js';
import {AppError} from './errors.js';
// Only catalogue writers use the new descriptor format. File workspaces keep
// their existing publication representation, understood by their older writers.
export async function requirePublicationDocumentStorage(workspace,{signal}={}){
 signal?.throwIfAborted();if(await workspace.storageKind()!=='catalogue')return false;
 const admit=()=>workspace.catalogue(async store=>{signal?.throwIfAborted();await requirePublicationDocuments(store.db);});
 // catalogue() authenticates the exact owner and vault before reusing this
 // writer; admission then rolls back with the publication mutation itself.
 if(catalogueContext.getStore()?.root===workspace.root)await admit();else await workspace.withLock(admit);
 return true;
}
export async function assertPublicationDocumentStorage(workspace,options){
 if(!await requirePublicationDocumentStorage(workspace,options))throw new AppError('FORMAT');
}
