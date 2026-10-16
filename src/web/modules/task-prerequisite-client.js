import {taskConstraintDraft,taskDependencyReference,sameTaskReference,validTaskReference,taskPrerequisiteEffect,sameTaskConstraintDraft} from '../task-prerequisite-model.js';
import {validReferenceOwner} from './reference-client.js';
const aborted=()=>new DOMException('Task prerequisites changed','AbortError');
const locked=code=>['ACCESS_LOCKED','ACCESS_DENIED','DEVICE_UNKNOWN'].includes(code);
const revision=value=>Number.isSafeInteger(value)&&value>0;
const invalid=()=>{throw new Error('TASK_READINESS_RESPONSE');};
export function taskPrerequisiteClient({state,api,access=run=>run(),current}){
 let epoch=0;const requests=new Set();
 const active=()=>state.page==='module'&&state.moduleId==='planning'&&!state.access?.locked&&!state.storageUnavailable;
 const identity=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.projectOwner,state.modulePath]);
 function capture(draft=current()){
  if(!draft||draft.type!=='task'||!active())throw aborted();
  const key=identity(),version=epoch,data=taskConstraintDraft(draft.data),signature=JSON.stringify(data),expectedRevision=draft.expectedRevision;
  return {draft,data,expectedRevision,workspaceId:state.book.id,valid:()=>active()&&version===epoch&&key===identity()&&current()===draft&&expectedRevision===draft.expectedRevision&&signature===JSON.stringify(taskConstraintDraft(draft.data))};
 }
 function cancel(){epoch++;for(const request of requests)request.abort();requests.clear();}
 async function readiness({offset=0,unlock=false,signal}={}){
  const captured=capture(),{draft,data,workspaceId,expectedRevision}=captured,controller=new AbortController();requests.add(controller);
  const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal,valid=()=>captured.valid()&&!combined.aborted,limit=25;
  const run=async()=>{
   if(!valid())throw aborted();
   try{
    const result=await api('/api/modules/planning/readiness',{workspaceId,id:draft.id,expectedRevision,data,offset,limit},{adopt:false,signal:combined});
    if(!valid())throw aborted();
    const selected=data.dependencies.slice(offset,offset+limit),size=selected.length;
    if(result?.workspaceId!==workspaceId||result.id!==draft.id||result.scope!=='page'||!/^([a-f0-9]{64})$/.test(result.draftFingerprint)||result.total!==data.dependencies.length||result.offset!==offset||result.checked!==size||result.previousOffset!==(offset?Math.max(0,offset-limit):null)||result.nextOffset!==(offset+size<result.total?offset+size:null)||!Array.isArray(result.items)||result.items.length!==size)invalid();
    for(let index=0;index<size;index++){
     const item=result.items[index],reference=taskDependencyReference(selected[index],workspaceId);
     if(!validTaskReference(item?.reference)||!sameTaskReference(item.reference,reference)||!['available','unavailable'].includes(item.status)||item.observedRevision!==undefined&&!revision(item.observedRevision))invalid();
     if(item.status==='available'){if(typeof item.title!=='string'||!['todo','doing','done','cancelled'].includes(item.taskStatus)||!revision(item.revision)||item.owner!==undefined&&!validReferenceOwner(item.owner)||item.changed!==undefined&&typeof item.changed!=='boolean')invalid();}
     else if(typeof item.code!=='string'||['title','taskStatus','revision','owner'].some(key=>Object.hasOwn(item,key)))invalid();
    }
    if(unlock){const unavailable=result.items.find(item=>item.status==='unavailable'&&locked(item.code)&&item.projectId);if(unavailable)throw {code:unavailable.code,projectId:unavailable.projectId,...(unavailable.labBookId?{labBookId:unavailable.labBookId}:{})};}
    return result;
   }catch(error){if(!valid())throw aborted();throw error;}
  };
  try{const result=await (unlock?access(run):run());if(!valid())throw aborted();return result;}finally{requests.delete(controller);}
 }
 async function commandRequest(run,{action,payload,context}){
  if(action!=='task.save')return run();
  const captured=capture(context.current);
  if(payload.id!==captured.draft.id||payload.expectedRevision!==captured.expectedRevision||!sameTaskConstraintDraft(payload.data,captured.data))throw aborted();
  const effect=taskPrerequisiteEffect(captured.draft.base,payload.data,{workspaceId:captured.workspaceId});
  const guarded=async()=>{
   if(!captured.valid())throw aborted();
   try{return await run();}catch(error){if(!captured.valid())throw aborted();throw error;}
  };
  // A successful write receipt still belongs to its captured source owner even
  // if the view changed while it committed. The workbench owns reconciliation.
  return effect.needsAccess?access(guarded):guarded();
 }
 return {readiness,commandRequest,cancel};
}
