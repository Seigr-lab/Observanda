// Task prerequisites retain their declared owner. A string is the historical
// local form; an addressed task never changes the owner of the dependent task.
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const validTaskReference=value=>exact(value,['workspaceId','type','id'])&&uuid(value.workspaceId)&&value.type==='task'&&uuid(value.id);
export const validTaskDependency=value=>uuid(value)||validTaskReference(value);
export const taskDependencyReference=(value,workspaceId)=>typeof value==='string'?{workspaceId,type:'task',id:value}:{...value};
export const taskReferenceKey=reference=>reference.workspaceId+'/'+reference.id;
export const sameTaskReference=(a,b)=>a?.workspaceId===b?.workspaceId&&a?.type===b?.type&&a?.id===b?.id;
export const localTaskDependency=(value,workspaceId)=>typeof value==='string'||value.workspaceId===workspaceId;
export function validTaskDependencies(values,workspaceId){
 return Array.isArray(values)&&values.every(validTaskDependency)&&new Set(values.map(value=>typeof value==='string'&&!workspaceId?'local/'+value:taskReferenceKey(taskDependencyReference(value,workspaceId)))).size===values.length;
}
export function taskConstraintDraft(data){return {status:data.status,dependencies:structuredClone(data.dependencies),checklist:data.checklist.map(item=>({done:item.done}))};}
export function validTaskConstraintDraft(data,workspaceId){
 return exact(data,['status','dependencies','checklist'])&&['todo','doing','done','cancelled'].includes(data.status)&&validTaskDependencies(data.dependencies,workspaceId)&&Array.isArray(data.checklist)&&data.checklist.every(item=>exact(item,['done'])&&typeof item.done==='boolean');
}
export function validTaskConstraintFacts(data,workspaceId){
 return data!==null&&typeof data==='object'&&!Array.isArray(data)&&Object.keys(data).every(key=>['status','dependencies','checklist','prerequisiteObservations'].includes(key))&&validTaskConstraintDraft({status:data.status,dependencies:data.dependencies,checklist:data.checklist},workspaceId)&&validTaskObservations(data,workspaceId);
}
export function sameTaskConstraintDraft(a,b){
 return !!a&&!!b&&a.status===b.status&&a.dependencies.length===b.dependencies.length&&a.dependencies.every((value,index)=>typeof value==='string'?value===b.dependencies[index]:sameTaskReference(value,b.dependencies[index]))&&a.checklist.length===b.checklist.length&&a.checklist.every((item,index)=>item.done===b.checklist[index].done);
}
export function taskPrerequisiteEffect(previous,data,{workspaceId}={}){
 const before=previous?.data??previous;
 const topologyChanged=!before||before.dependencies.length!==data.dependencies.length||before.dependencies.some((value,index)=>!sameTaskReference(taskDependencyReference(value,workspaceId),taskDependencyReference(data.dependencies[index],workspaceId)));
 const foreignReferences=data.dependencies.filter(value=>!localTaskDependency(value,workspaceId)).map(value=>taskDependencyReference(value,workspaceId));
 const completionRequired=data.status==='done'&&(!before||before.status!=='done'||!sameTaskConstraintDraft(before,data));
 return {topologyChanged,completionRequired,foreignReferences,needsAccess:topologyChanged||completionRequired};
}
export function validTaskObservation(value){
 return exact(value,['reference','canonicalReference','revision','hash','constraintHash','observedAt'])&&validTaskReference(value.reference)&&validTaskReference(value.canonicalReference)&&value.reference.id===value.canonicalReference.id&&Number.isSafeInteger(value.revision)&&value.revision>0&&hash(value.hash)&&hash(value.constraintHash)&&instant(value.observedAt);
}
export function validTaskObservations(data,workspaceId){
 if(!validTaskDependencies(data.dependencies,workspaceId))return false;
 const foreign=data.dependencies.filter(value=>!localTaskDependency(value,workspaceId));
 if(!Object.hasOwn(data,'prerequisiteObservations'))return !workspaceId||data.status!=='done'||foreign.length===0;
 const observations=data.prerequisiteObservations;
 if(data.status!=='done'||!Array.isArray(observations)||!observations.length||!observations.every(validTaskObservation)||new Set(observations.map(value=>taskReferenceKey(value.canonicalReference))).size!==observations.length)return false;
 if(workspaceId)return observations.length===foreign.length&&observations.every((value,index)=>sameTaskReference(value.reference,foreign[index]));
 // Selected entity validation has no owner context. It validates each retained
 // observation; the owner constraint audit checks exact foreign-edge coverage.
 let offset=0;
 for(const value of observations){while(offset<foreign.length&&!sameTaskReference(value.reference,foreign[offset]))offset++;if(offset===foreign.length)return false;offset++;}
 return true;
}
export function sameTaskObservations(a,b){
 const left=a?.prerequisiteObservations,right=b?.prerequisiteObservations;
 if(left===undefined||right===undefined)return left===right;
 return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((value,index)=>{const other=right[index];return validTaskObservation(value)&&validTaskObservation(other)&& sameTaskReference(value.reference,other.reference)&&sameTaskReference(value.canonicalReference,other.canonicalReference)&&value.revision===other.revision&&value.hash===other.hash&&value.constraintHash===other.constraintHash&&value.observedAt===other.observedAt;});
}
