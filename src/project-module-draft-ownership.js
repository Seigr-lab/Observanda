// Draft values may be unfinished. Their saved/base/current ownership must
// still agree before a transfer can include them or a source check ignore them.
import {moduleOwnerFact} from './project-module-ownership.js';
import {ModuleHistory} from './modules/history.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const ownership=id=>{throw new AppError('PROJECT_MIGRATION_OWNERSHIP',[{kind:'module-draft',id}]);};
export async function projectModuleDraftOwnership(workspace,items,inventory,{signal}={}){
 if(!Array.isArray(items))damaged();let selected=null;const projectIds=new Set();
 async function resolved(fact,id){
  if(fact.kind==='parent'){const parent=await inventory.owner(fact.id);if(!parent||parent.type!==fact.type)ownership(id);fact=parent;}
  if(!['project','workspace'].includes(fact.kind)||fact.kind==='project'&&!researchId(fact.projectId))ownership(id);return fact;
 }
 for(const item of items){
  signal?.throwIfAborted();if(!researchId(item.id)||typeof item.type!=='string'||!item.data||typeof item.data!=='object')damaged();
  const stored=await inventory.owner(item.id);if(stored&&stored.type!==item.type)damaged();
  const fact=await resolved(stored??moduleOwnerFact({type:item.type,data:item.data}),item.id),ownerId=fact.kind==='project'?fact.projectId:null;
  if(ownerId!==null)projectIds.add(ownerId);const belongs=ownerId===inventory.projectId;if(selected!==null&&selected!==belongs)ownership(item.id);selected=belongs;
  let base=item.base;
  if(Object.hasOwn(item,'baseRevision')&&item.baseRevision!==null){
   if(!stored||!Number.isSafeInteger(item.baseRevision)||item.baseRevision<1||item.baseRevision!==item.expectedRevision||item.baseRevision>stored.revision)damaged();
   const saved=await new ModuleHistory(workspace).read({id:item.id,revision:item.baseRevision});if(saved.entity.type!==item.type)damaged();base=saved.entity.data;
  }
  for(const data of [item.data,base])if(data){
   const declared=moduleOwnerFact({type:item.type,data});if(declared.kind==='undeclared')continue;
   const value=await resolved(declared,item.id);if((value.kind==='project'?value.projectId:null)!==ownerId)ownership(item.id);
  }
 }
 return {selected,projectIds:[...projectIds]};
}
