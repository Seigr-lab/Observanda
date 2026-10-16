import {ProjectSourceOwner} from './project-source-owner.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
// Small explicit ownership facts for one pinned catalogue read. References to
// a resource never substitute for a declaration by its owner.
export function projectSourceDeclaredOwner(store,namespaceId,{signal}={}){
 const source=new ProjectSourceOwner(store,namespaceId),facts=new Map();
 return async(domain,id,{required=true}={})=>{
  signal?.throwIfAborted();const key=domain+':'+id;let fact;
  if(facts.has(key))fact=facts.get(key);
  else {
   const value=await source.resolve(domain,id);if(value&&(value.id!==id||value.sourceNamespace!==namespaceId||!['project','workspace'].includes(value.kind)||value.kind==='project'&&!researchId(value.projectId)))throw new AppError('PROJECT_MIGRATION_OWNERSHIP');
   fact=value?.kind==='project'?{kind:'project',projectId:value.projectId}:value?.kind==='workspace'?{kind:'workspace'}:null;
   if(facts.size>=128)facts.delete(facts.keys().next().value);facts.set(key,fact);
  }
  if(!fact&&required)throw new AppError('PROJECT_MIGRATION_OWNERSHIP');return fact;
 };
}
