import {readProjectModuleDraftTransfer} from './project-module-draft-transfer-read.js';
import {DRAFT_CHUNK_BYTES} from './web/modules/draft-protocol.js';
import {ModuleDrafts} from './modules/drafts.js';
import {ModuleCatalogue} from './modules/catalogue.js';
import {projectSourceModuleOwner} from './project-source-module-owner.js';
import {projectModuleDraftOwnership} from './project-module-draft-ownership.js';
import {AppError} from './errors.js';
export function projectSourceModuleDraftOwner(store,inventory,{signal}={}){
 const drafts=new ModuleDrafts(store.workspace),transfers=new Map();let resolve;
 async function owner(id){resolve??=projectSourceModuleOwner(store,await new ModuleCatalogue(store).head(inventory.namespaceId),inventory.namespaceId,{signal});return resolve(id);}
 return async id=>{
  if(!/^metadata:\.observanda\/module-(?:drafts|draft-list|draft-transfers)(?:[/.])/.test(id))return null;
  return store.workspace.inspectCatalogue(store,async()=>{
   signal?.throwIfAborted();let match;
   if((match=/^metadata:\.observanda\/module-draft-transfers\/([a-f0-9-]{36})\/(manifest|0|[1-9][0-9]*)\.json$/.exec(id))){
    const key=match[1];let entry=transfers.get(key);
    if(!entry){
     const {manifest,value}=await readProjectModuleDraftTransfer(store.workspace,key,inventory.namespaceId,{signal}),items=value?.drafts??(await drafts.read(key,{expand:false}))?.draft.drafts;if(!items)throw new AppError('PROJECT_MIGRATION_OWNERSHIP');
     const fact=await projectModuleDraftOwnership(store.workspace,items,{...inventory,owner},{signal});entry={owner:{kind:'projects',projectIds:fact.projectIds},parts:manifest.etag?0:Math.ceil(manifest.size/DRAFT_CHUNK_BYTES)};
     if(transfers.size>=128)transfers.delete(transfers.keys().next().value);transfers.set(key,entry);
    }
    if(match[2]!=='manifest'&&(!Number.isSafeInteger(Number(match[2]))||Number(match[2])>=entry.parts))throw new AppError('CATALOGUE_DAMAGED');return entry.owner;
   }
   if(id==='metadata:.observanda/module-draft-list.json'){if(!await drafts.index.initialized(inventory.namespaceId))throw new AppError('CATALOGUE_DAMAGED');return {kind:'derived'};}
   if((match=/^metadata:\.observanda\/module-drafts\/([a-f0-9-]{36})\.json$/.exec(id))||(match=/^metadata:\.observanda\/module-draft-list\/[a-z][a-z0-9-]{0,79}\/\d{13}-([a-f0-9-]{36})\.json$/.exec(id))){
    const result=await drafts.read(match[1],{expand:false});if(!result)throw new AppError('CATALOGUE_DAMAGED');
    if(id.startsWith('metadata:.observanda/module-draft-list/')&&id!=='metadata:'+drafts.index.path(result.draft))throw new AppError('CATALOGUE_DAMAGED');
    const fact=await projectModuleDraftOwnership(store.workspace,result.draft.drafts,{...inventory,owner},{signal});return {kind:'projects',projectIds:fact.projectIds};
   }
   return null;
  });
 };
}
