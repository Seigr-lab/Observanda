import {projectSourceModuleEntry} from './project-source-module-entry.js';
// Resolve current module ownership by selected entity and declared parents.
// The cache contains small ownership facts for this held read, not entity bodies.
import {ProjectSourceOwner} from './project-source-owner.js';
import {moduleOwnerFact} from './project-module-ownership.js';
import {ModuleCatalogue} from './modules/catalogue.js';
import {workspaceModules} from './modules/index.js';
import {AppError} from './errors.js';
export function projectSourceModuleOwner(store,head,namespaceId,{signal}={}){
 const catalogue=new ModuleCatalogue(store),declarations=new ProjectSourceOwner(store,namespaceId),cache=new Map();
 return async function owner(id,expectedType=null,parents=new Set()){
  signal?.throwIfAborted();if(parents.has(id)||parents.size>=32)throw new AppError('PROJECT_MIGRATION_OWNERSHIP');parents.add(id);
  if(cache.has(id)){const known=cache.get(id);if(expectedType&&known?.type!==expectedType)throw new AppError('PROJECT_MIGRATION_OWNERSHIP');return known;}
  const entry=await projectSourceModuleEntry(catalogue,head,id);if(!entry){if(expectedType)throw new AppError('PROJECT_MIGRATION_OWNERSHIP');return null;}if(expectedType&&entry.type!==expectedType)throw new AppError('PROJECT_MIGRATION_OWNERSHIP');if(entry.retired){const result={...entry.owner,type:entry.type,revision:entry.revision};if(cache.size>=128)cache.delete(cache.keys().next().value);cache.set(id,result);return result;}const entity=entry.value;
  if(expectedType&&entity.type!==expectedType)throw new AppError('PROJECT_MIGRATION_OWNERSHIP');workspaceModules(store.workspace).validateEntity(entity);
  let fact=moduleOwnerFact(entity);
  if(fact.kind==='parent'){const parent=await owner(fact.id,fact.type,parents);fact=parent.kind==='project'?{kind:'project',projectId:parent.projectId}:{kind:'workspace'};}
  if(fact.kind==='undeclared'){const choice=await declarations.resolve('module',id,entity);if(!choice)throw new AppError('PROJECT_MIGRATION_OWNERSHIP');fact=choice.kind==='project'?{kind:'project',projectId:choice.projectId}:{kind:'workspace'};}
  const result={...fact,type:entity.type,revision:entity.revision};if(cache.size>=128)cache.delete(cache.keys().next().value);cache.set(id,result);return result;
 };
}
