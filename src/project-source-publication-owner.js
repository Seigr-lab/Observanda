import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
// Website containers retain their project scope even after a site is removed.
// Root-workspace publishing has a separate owner and is not a project transfer.
export function projectSourcePublicationOwner(store,inventory,{signal}={}){
 async function owner(id){const site=await inventory.website(id);if(!researchId(id)||!site||site.ambiguous||!researchId(site.projectId))throw new AppError('PROJECT_MIGRATION_OWNERSHIP');return {kind:'project',projectId:site.projectId};}
 return async id=>{
  signal?.throwIfAborted();let match;
  if((match=/^metadata:\.observanda\/websites\/([a-f0-9-]{36})\//.exec(id)))return owner(match[1]);
  if(/^metadata:\.observanda\/website-editions\/[a-f0-9]{64}\.json$/.test(id)){
   const object=await store.object(id);let value;try{value=JSON.parse(object.text);}catch{throw new AppError('CATALOGUE_DAMAGED');}
   if(!value||Object.keys(value).join()!=='websiteId')throw new AppError('CATALOGUE_DAMAGED');return owner(value.websiteId);
  }
  return null;
 };
}
