import {exact,uuid,instant} from '../modules/validation.js';
import {requireOrganization as valid} from './organization-state.js';

const root=organizationId=>'.observanda/organizations/activity/'+organizationId+'/';
async function count(workspace,organizationId){
  const raw=await workspace.readMetadata(root(organizationId)+'head.json',1000);
  if(!raw)return 0;
  const value=JSON.parse(raw);
  valid(exact(value,['count'])&&Number.isSafeInteger(value.count)&&value.count>0,'COLLABORATION_DAMAGED');
  return value.count;
}

// Per-organization sequencing bounds reads to one page without scanning other
// organizations. The caller holds the same transaction as the membership write.
export async function appendOrganizationActivity(workspace,event){
  const sequence=await count(workspace,event.organizationId)+1;
  valid(Number.isSafeInteger(sequence),'LIMIT');
  await workspace.writeMetadata(root(event.organizationId)+sequence+'.json',JSON.stringify({...event,sequence}));
  await workspace.writeMetadata(root(event.organizationId)+'head.json',JSON.stringify({count:sequence}));
}

export async function organizationActivity(workspace,organizationId,before=null){
  valid(uuid(organizationId)&&(before===null||Number.isSafeInteger(before)&&before>0));
  const total=await count(workspace,organizationId);
  valid(before===null||before<=total+1);
  const end=before===null?total:before-1,start=Math.max(1,end-19),events=[];
  for(let sequence=end;sequence>=start;sequence--){
    const raw=await workspace.readMetadata(root(organizationId)+sequence+'.json',200000);
    valid(!!raw,'COLLABORATION_DAMAGED');
    const event=JSON.parse(raw);
    valid(event.sequence===sequence&&event.organizationId===organizationId&&uuid(event.actor)&&Number.isSafeInteger(event.revision)&&event.revision>0&&instant(event.at)&&typeof event.operation==='string'&&event.details&&typeof event.details==='object','COLLABORATION_DAMAGED');
    events.push(event);
  }
  return {events,nextBefore:start>1?start:null,total};
}
