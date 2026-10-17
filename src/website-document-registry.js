// Website ownership is independent of research snapshots and the shared object
// index. Registration changes this directory; ordinary edits touch one site head.
import {AppError} from './errors.js';
import {ObjectIndex,validIndexRef} from './object-index.js';
import {catalogueFormat,catalogueRequiresWebsites,requireWebsiteDocuments} from './catalogue-format.js';
import {cataloguePrefixExists} from './postgres-indexes.js';
import {projectDomainHandoff,projectDomainLock} from './project-domain-lock.js';
import {researchId} from './web/research-reference.js';
export const WEBSITE_DOCUMENT_PREFIX='website-document:';
export const WEBSITE_DOCUMENT_REGISTRY='website-documents';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export const websiteDirectoryIndex=store=>new ObjectIndex(store,{namespace:WEBSITE_DOCUMENT_PREFIX+'directory:',immutable:true});
export async function readWebsiteDocumentRegistry(store){
 const row=await store.db.get('SELECT payload FROM state WHERE slot=$1',WEBSITE_DOCUMENT_REGISTRY),format=await catalogueFormat(store.db);
 if(!row){if(catalogueRequiresWebsites(format)||await cataloguePrefixExists(store.db,'state',WEBSITE_DOCUMENT_PREFIX))damaged();return null;}
 const value=store.decode('state',WEBSITE_DOCUMENT_REGISTRY,row.payload),workspaceId=(await store.snapshot()).metadata.id;
 if(!catalogueRequiresWebsites(format)||!value||Object.keys(value).sort().join()!=='defaultSiteId,root,version,workspaceId'||value.version!==1||value.workspaceId!==workspaceId||!researchId(value.defaultSiteId)||!validIndexRef(value.root))damaged();
 return value;
}
export async function writeWebsiteDocumentRegistry(store,value){
 await store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',WEBSITE_DOCUMENT_REGISTRY,store.encode('state',WEBSITE_DOCUMENT_REGISTRY,value));
}
export async function initializeWebsiteDocumentRegistry(store,{workspaceId,defaultSiteId}){
 if(!researchId(workspaceId)||!researchId(defaultSiteId)||(await store.snapshot()).metadata.id!==workspaceId)throw new AppError('INVALID');
 if(await readWebsiteDocumentRegistry(store))throw new AppError('EXISTS');
 await requireWebsiteDocuments(store.db);const value={version:1,workspaceId,defaultSiteId,root:null};await writeWebsiteDocumentRegistry(store,value);return value;
}
// Call before reading mutation bases, within the caller's transaction. Every
// participant takes the membership gate before any site lock. No site writer
// acquires the research writer while holding these locks.
export async function websiteDocumentLocks(store,{websiteIds=[],registration=false,membership='shared'}={}){
 if(!Array.isArray(websiteIds)||websiteIds.some(id=>id!==null&&!researchId(id))||new Set(websiteIds).size!==websiteIds.length||typeof registration!=='boolean'||!['shared','exclusive'].includes(membership))throw new AppError('INVALID');
 await projectDomainHandoff(store.db,{shared:true});
 await projectDomainLock(store.db,'Observanda/website-membership/'+store.db.id,{shared:membership==='shared'});
 if(registration)await projectDomainLock(store.db,'Observanda/website-registration/'+store.db.id);
 const registry=websiteIds.length?await readWebsiteDocumentRegistry(store):null;
 if(registry&&websiteIds.includes(registry.defaultSiteId))throw new AppError('INVALID');
 // The established default alias has its own stable lock even before explicit
 // conversion. Initialization holds the exclusive membership gate throughout.
 const ids=websiteIds.map(id=>id??registry?.defaultSiteId??'default');
 if(new Set(ids).size!==ids.length)throw new AppError('INVALID');
 for(const id of ids.sort())await projectDomainLock(store.db,'Observanda/website-document/'+store.db.id+'/'+id);
}
