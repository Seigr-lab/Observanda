import {assertSpectralMethodsFormat} from './spectral-methods-format.js';
import {validCusumExecutionCursor} from './dataset-cusum-kernel.js';
import {validCusumRecipe} from './web/dataset-cusum-model.js';
import {NumericalExecutionWork} from './numerical-execution-work.js';
import {validSpectrumExecutionCursor} from './dataset-spectrum-kernel.js';
import {validSpectrumRecipe} from './web/dataset-spectrum-model.js';
import {projectJobDiscoveryOwner} from './project-job-discovery.js';
import {AggregationWork} from './dataset-aggregation-work.js';
import {ResearchMaterials} from './research-materials.js';
import {DurableJobs} from './jobs.js';
import {projectJobOwner} from './project-job-ownership.js';
import {ProjectSourceOwner} from './project-source-owner.js';
import {digest} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const root='metadata:.observanda/jobs/',derived=Object.freeze({kind:'derived'});
const damaged=()=>{throw new AppError('JOB_DAMAGED');};
export function projectSourceJobOwner(store,inventory,record,{signal}={}){
 const queue=new DurableJobs(store.workspace,{}),declarations=new ProjectSourceOwner(store,inventory.namespaceId),owner=projectJobOwner(store.workspace,{...inventory,record:async id=>{const value=await record(id);return {...value,selected:value.projectId===inventory.projectId};},mediaImport:id=>declarations.resolve('mediaImport',id)}),owners=new Map();
 async function job(id){
  signal?.throwIfAborted();if(!researchId(id))damaged();if(owners.has(id))return owners.get(id);
  const value=await queue.read(id);if(!value)damaged();const fact=await owner(value),result=fact.projectId?{kind:'project',projectId:fact.projectId}:fact.kind==='workspace'?{kind:'workspace'}:null;if(!result)throw new AppError('PROJECT_MIGRATION_OWNERSHIP');
  if(owners.size>=128)owners.delete(owners.keys().next().value);owners.set(id,result);return result;
 }
 return async id=>{
  if(id.startsWith('metadata:.observanda/dataset-jobs/'))return store.workspace.inspectCatalogue(store,()=>projectJobDiscoveryOwner(store,queue,record,id));
  const aggregation=/^metadata:\.observanda\/materials\/aggregation-work\/([a-f0-9-]{36})\.json$/.exec(id);
  const numerical=/^metadata:\.observanda\/materials\/numerical-work\/([a-f0-9-]{36})\.json$/.exec(id);
  if(!id.startsWith(root)&&!aggregation&&!numerical)return null;
  return store.workspace.inspectCatalogue(store,async()=>{
   signal?.throwIfAborted();
   if(numerical){const current=await queue.read(numerical[1]),command=current?.input?.command,kind=command?.cusum===undefined?'spectrum':'cusum',recipe=command?.[kind];if(current?.type!=='dataset.prepare'||(kind==='cusum'?command.spectrum!==undefined||!validCusumRecipe(recipe):![2,3].includes(recipe?.version)||!validSpectrumRecipe(recipe)))damaged();if(kind==='spectrum'&&recipe.version===3)await assertSpectralMethodsFormat(store.workspace);const validCursor=kind==='cusum'?validCusumExecutionCursor:validSpectrumExecutionCursor,work=new NumericalExecutionWork(new ResearchMaterials(store.workspace),command,{kind,jobId:current.id,signal,validCursor:value=>validCursor(value,recipe.range.count,kind==='spectrum'&&recipe.version===3?{version:3,method:recipe.method,window:recipe.window,frequencyCount:recipe.frequencyGrid?.count,missing:recipe.missing,excluded:recipe.excluded}:undefined)});if(!await work.read())damaged();return job(current.id);}
   if(aggregation){const current=await queue.read(aggregation[1]);if(current?.type!=='dataset.prepare'||!current.input.command?.aggregation)damaged();const materials=new ResearchMaterials(store.workspace),source=await materials.read(current.input.command.aggregation.source),work=await new AggregationWork(materials,current.input.command,{jobId:current.id,signal}).open(source.content.rowCount);if(!work.saved)damaged();return job(current.id);}
   const tail=id.slice(root.length);let match;
   if((match=/^([a-f0-9-]{36})\.json$/.exec(tail)))return job(match[1]);
   if((match=/^relocations\/([a-f0-9-]{36})\.json$/.exec(tail))){const receipt=await queue.relocations.read(match[1]);if(!receipt)damaged();return {kind:'project',projectId:receipt.projectId};}
   if(tail==='queue.json'){await queue.membership.head();return derived;}
   if((match=/^types\/([a-f0-9]{64})\.json$/.exec(tail))){const value=await queue.membership.json(id.slice(9));if(!value||typeof value.type!=='string'||digest(value.type)!==match[1])damaged();await queue.membership.typeCount(value.type);return derived;}
   if((match=/^(members|pending|leases)\/([^/]+)\.json$/.exec(tail))){
    const value=await queue.membership.json(id.slice(9));if(!queue.membership.valid(value))damaged();
    const expected=match[1]==='members'?queue.membership.memberFile(value.id):queue.membership.path(value);if(expected!==id.slice(9))damaged();
    const stored=await queue.read(value.id);if(!stored||stored.type!==value.type||!['queued','running'].includes(stored.state)||value.until!==(stored.state==='running'?stored.lease.until:null))damaged();
    return job(value.id);
   }
   return null;
  });
 };
}
