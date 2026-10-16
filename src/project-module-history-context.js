import {projectModuleDomainReader} from './project-module-domain-reader.js';
import {ProjectModuleIdentities} from './project-module-identities.js';
import {uuid} from './modules/validation.js';
import {AppError} from './errors.js';
export async function projectModuleHistoryContext({research,registry,inspect},id,operation){
 if(!uuid(id))throw new AppError('INVALID');
 const identities=new ProjectModuleIdentities(research,registry,inspect),route=await identities.locate('entity',id);
 if(!route)throw new AppError('NOT_FOUND');
 const {store,catalogue,head}=await identities.owner(route.domain),binding=registry.projectId+'/'+registry.namespaceId+'/'+route.domain;
 return operation({workspaceId:registry.namespaceId,store,catalogue,head,member:value=>{if(value!==id)throw new AppError('INVALID');return catalogue.member(head,id);},
  encode:value=>store.encode('project-module-history',binding,value).toString('base64url'),decode:value=>store.decode('project-module-history',binding,Buffer.from(value,'base64url'))});
}
// Existing checkpoint readers can resolve their saved base inside their own
// database snapshot. No second transaction or implicit storage conversion.
export async function projectModuleHistoryOwner(research){
 const reader=await projectModuleDomainReader(research);return reader?(id,operation)=>reader.run(context=>projectModuleHistoryContext(context,id,operation)):null;
}
