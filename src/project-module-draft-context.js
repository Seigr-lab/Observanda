import {ProjectDraftCatalogue} from './project-draft-catalogue.js';
import {projectModuleHistoryContext} from './project-module-history-context.js';
import {moduleDraftDomain} from './modules/draft-domains.js';
import {ModuleDrafts} from './modules/drafts.js';
import {AppError} from './errors.js';
export async function projectModuleDraftContext(context,moduleId,{writable=false}={}){
 const domain=await context.inspect(moduleDraftDomain(moduleId)),store=new ProjectDraftCatalogue(domain,context.research,moduleId,{writable});
 const key=relative=>{
  if(typeof relative!=='string'||!['.observanda/module-drafts/','.observanda/module-draft-list/','.observanda/module-draft-transfers/'].some(prefix=>relative.startsWith(prefix))&&relative!=='.observanda/module-draft-list.json'||relative.split('/').some(part=>!part||part==='.'||part==='..'))throw new AppError('UNSAFE');return 'metadata:'+relative;
 };
 const workspace={root:context.research.workspace.root,
  storageKind:async()=>'catalogue',catalogue:operation=>operation(store),outline:async()=>({metadata:(await context.research.snapshot()).metadata}),
  withLock:operation=>{if(!writable)throw new AppError('INVALID');return operation();},
  moduleHistory:(id,operation)=>projectModuleHistoryContext(context,id,operation),
  async readMetadata(relative,limit){const value=await store.object(key(relative));if(value===null)return null;if(typeof value.text!=='string')throw new AppError('FORMAT');if(Buffer.byteLength(value.text)>limit)throw new AppError('LIMIT');return value.text;},
  writeMetadata:(relative,text)=>store.putObject(key(relative),{text}),removeMetadata:relative=>store.deleteObject(key(relative)),
  async *metadataNames(relative,{signal}={}){const prefix=key(relative+'/entry').slice(0,-5),index=store.objectIndex(),head=await index.head();let previous=null;for await(const entry of index.entries(head,prefix)){signal?.throwIfAborted();const name=entry.id.slice(prefix.length).split('/')[0];if(name!==previous){previous=name;yield name;}}}
 };
 return {workspace,store,drafts:new ModuleDrafts(workspace)};
}
