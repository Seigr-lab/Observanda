// Live prerequisite admission is separate from owner-only integrity. The caller
// holds the selected owners' task admission gates; this walk never writes them.
import {withScratch} from '../scratch-work.js';
import {requireValue} from './validation.js';
import {validTaskReference,taskDependencyReference,taskReferenceKey,localTaskDependency,taskConstraintDraft,validTaskConstraintDraft,validTaskConstraintFacts} from '../web/task-prerequisite-model.js';
const pageSize=32,blocked='Complete checklist and dependencies before finishing this task';
export async function evaluateTaskPrerequisites({workspaceId,id,data},read,{signal,onOwner=async()=>{},observedAt=new Date().toISOString()}={}){
 const root={workspaceId,type:'task',id},rootKey=taskReferenceKey(root),owners=new Set(),observations=[];
 requireValue(validTaskReference(root)&&validTaskConstraintDraft(taskConstraintDraft(data),workspaceId),'Task prerequisites');
 if(data.status==='done')requireValue(data.checklist.every(item=>item.done),blocked,'TASK_BLOCKED');
 const owner=async namespace=>{if(owners.has(namespace))return;requireValue(owners.size<32,'Task prerequisite owners','TASK_DEPENDENCY_OWNER_LIMIT');owners.add(namespace);await onOwner(namespace);};
 await owner(workspaceId);
 return withScratch(async work=>{
  const edgeKey=(key,page)=>'edges:'+key+':'+page;
  async function enter(reference,facts,metadata,parent){
   if(facts.status==='done')requireValue(facts.checklist.every(item=>item.done),blocked,'TASK_BLOCKED');
   const key=taskReferenceKey(reference),dependencies=facts.dependencies,state={reference,status:facts.status,visited:dependencies.length===0,...metadata};
   await work.put('task:'+key,state);
   if(!dependencies.length)return {state,frame:null};
   let pages=[];
   for(let offset=pageSize;offset<dependencies.length;offset+=pageSize){pages.push([edgeKey(key,offset/pageSize),dependencies.slice(offset,offset+pageSize)]);if(pages.length===32){await work.putMany(pages);pages=[];}}
   await work.putMany(pages);
   return {state,frame:{key,reference,status:facts.status,parent,total:dependencies.length,page:0,offset:0,dependencies:dependencies.slice(0,pageSize)}};
  }
  await work.put('alias:'+rootKey,rootKey);
  let frame=(await enter(root,data,{},null)).frame;
  while(frame){
   signal?.throwIfAborted();
   if(frame.offset===frame.dependencies.length&&(frame.page+1)*pageSize<frame.total){const key=edgeKey(frame.key,++frame.page);frame.dependencies=await work.get(key);frame.offset=0;requireValue(Array.isArray(frame.dependencies)&&frame.dependencies.length>0,'Task traversal state');await work.remove(key);}
   if(frame.offset===frame.dependencies.length){
    const state=await work.get('task:'+frame.key);state.visited=true;await work.put('task:'+frame.key,state);
    const parent=frame.parent;await work.remove('frame:'+frame.key);frame=parent===null?null:await work.get('frame:'+parent);requireValue(parent===null||!!frame,'Task traversal state');continue;
   }
   const declared=frame.dependencies[frame.offset++],requested=taskDependencyReference(declared,frame.reference.workspaceId),requestedKey=taskReferenceKey(requested);
   let key=await work.get('alias:'+requestedKey),state=key?await work.get('task:'+key):null,child=null;
   if(!state){
    const selected=await read(requested);signal?.throwIfAborted();
    requireValue(selected&&validTaskReference(selected.reference)&&selected.reference.id===requested.id&&selected.constraint?.id===requested.id&&selected.constraint.type==='task','Task dependency');
    const facts=selected.constraint.data,canonical=selected.reference;
    requireValue(validTaskConstraintFacts(facts,canonical.workspaceId),'Task prerequisite facts');
    requireValue(Number.isSafeInteger(selected.revision)&&selected.revision>0&&[selected.hash,selected.constraintHash].every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)),'Task prerequisite revision');
    await owner(canonical.workspaceId);key=taskReferenceKey(canonical);state=await work.get('task:'+key);
    if(state&&key!==rootKey)requireValue(state.revision===selected.revision&&state.hash===selected.hash&&state.constraintHash===selected.constraintHash,'Task prerequisite changed','TASK_PREREQUISITE_CHANGED');
    await work.put('alias:'+requestedKey,key);
    if(!state){const entered=await enter(canonical,facts,{revision:selected.revision,hash:selected.hash,constraintHash:selected.constraintHash},frame.key);state=entered.state;child=entered.frame;}
   }
   if(frame.status==='done'&&localTaskDependency(declared,frame.reference.workspaceId))requireValue(state.status==='done',blocked,'TASK_BLOCKED');
   if(frame.key===rootKey){
    requireValue(await work.add('direct:'+key),'Duplicate task prerequisite');
    if(data.status==='done'){
     requireValue(state.status==='done',blocked,'TASK_BLOCKED');
     if(!localTaskDependency(declared,workspaceId))observations.push({reference:requested,canonicalReference:state.reference,revision:state.revision,hash:state.hash,constraintHash:state.constraintHash,observedAt});
    }
   }
   if(!child)requireValue(state.visited,'Task dependencies form a cycle');
   else{await work.put('frame:'+frame.key,frame);frame=child;}
  }
  return {owners:[...owners],observations};
 },{signal});
}
