// Both sides of a module edit retain their owner. Changing a parent or an
// explicit project field cannot revive an entity in a retired source.
import {ProjectSourceAuthority} from './project-source-authority.js';
import {moduleOwnerFact} from './project-module-ownership.js';
import {ProjectSourceOwner} from './project-source-owner.js';
import {AppError} from './errors.js';
export async function assertProjectSourceModuleWrite(catalogue,previous,entities){
 const store=catalogue.store;if(store.workspace.projectId)return;
 const authority=new ProjectSourceAuthority(store);if(!await authority.active())return;
 const declared=new ProjectSourceOwner(store,previous.workspaceId),changed=new Map(entities.map(entity=>[entity.id,entity]));
 async function owner(entity,proposed,seen=new Set()){
  if(seen.has(entity.id)||seen.size>=32)throw new AppError('PROJECT_MIGRATION_OWNERSHIP');seen.add(entity.id);
  const fact=moduleOwnerFact(entity);
  if(fact.kind==='project')return authority.writable(fact.projectId);
  if(fact.kind==='parent'){
   const parent=proposed&&changed.has(fact.id)?changed.get(fact.id):await catalogue.selected(previous,fact.id);
   if(!parent||parent.type!==fact.type)throw new AppError('PROJECT_MIGRATION_OWNERSHIP');return owner(parent,proposed,seen);
  }
  if(fact.kind==='undeclared'){
   const retained=proposed?await catalogue.selected(previous,entity.id):entity;
   const choice=await declared.resolve('module',entity.id,retained??entity);
   if(choice?.kind==='project')await authority.writable(choice.projectId);
  }
 }
 for(const entity of entities){const old=await catalogue.selected(previous,entity.id);if(old)await owner(old,false);await owner(entity,true);}
}
