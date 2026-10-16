import {liveValid as valid} from './live-protocol.js';
import {identityHash} from './identity.js';
import {exact,uuid} from '../modules/validation.js';
import {revisionId} from '../web/revision-model.js';
import {RELATION_TYPES,validRelations} from '../web/record-model.js';
import {workflowRole} from '../web/record-workflow.js';
import {ResearchMaterials} from '../research-materials.js';
import {ResearchRecords,recordRevision} from '../research.js';
import {MediaStore} from '../media.js';

// Called within LiveResearch's authorized transaction. A link is patched by
// identity, so concurrent writing or edits to other links cannot be overwritten.
export class LiveRelationships{
 constructor(workspace,readRecord){this.workspace=workspace;this.readRecord=readRecord;this.materials=new ResearchMaterials(workspace);}
 async targets(store,access,data){
  valid(typeof data.query==='string'&&data.query.length<=180&&(data.after===null||uuid(data.after)));
  valid(data.notebookId===null||access.notebookIds.includes(data.notebookId),'COLLABORATION_DENIED');
  const snapshot=await store.snapshot(),rows=[],query=data.query.trim().toLowerCase();
  for await(const row of store.members(snapshot,{notebookIds:new Set(data.notebookId?[data.notebookId]:access.notebookIds)})){
   if(row.id===data.recordId||data.after&&row.id<=data.after)continue;
   const record=await store.record(row.id,row.revision);if(!record.title.toLowerCase().includes(query))continue;
   rows.push({id:row.id,title:record.title,type:record.type,notebookId:row.notebookId,revision:recordRevision(record)});rows.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);if(rows.length>51)rows.pop();
  }
  return {records:rows.slice(0,50),next:rows.length>50?rows[49].id:null,notebooks:snapshot.metadata.notebooks.filter(n=>access.notebookIds.includes(n.id)).map(({id,title})=>({id,title}))};
 }
 async linked(store,access,source,linkId){
  valid(uuid(linkId));const link=source.relations.find(r=>r.id===linkId);
  valid(link?.target.kind==='record'&&link.target.workspaceId===(await store.snapshot()).metadata.id,'COLLABORATION_DENIED');
  // Both today's membership and the historical book must be shared. Retaining
  // a method never grants continued access after its owner removes that access.
  const current=await this.readRecord(store,access,link.target.id);
  const record=link.target.revision?await this.materials.read(link.target):current;
  valid(access.notebookIds.includes(record.notebookId),'COLLABORATION_DENIED');
  return {record,revision:recordRevision(record),currentRevision:recordRevision(current)};
 }
 async write(store,access,scope,record,data,audit){
  valid(exact(data,['recordId','id','linkId','before','value'])&&uuid(data.id)&&uuid(data.linkId));
  valid(data.before===null||validRelations([data.before])&&data.before.id===data.linkId);
  const receipt='.observanda/collaboration/live/receipts/'+access.principalId+'/'+data.id+'.json',hash=identityHash(data),raw=await this.workspace.readMetadata(receipt,2048);
  if(raw){const prior=JSON.parse(raw);valid(prior.hash===hash,'CONFLICT');return prior;}
  const previous=record.relations.find(r=>r.id===data.linkId)??null;
  valid(identityHash(previous)===identityHash(data.before),'RECORD_CHANGED');
  valid(previous!==null||data.value!==null);
  let link=null;
  if(data.value!==null){
   const v=data.value;
   valid(exact(v,['type','role','target'])&&RELATION_TYPES.includes(v.type)&&(v.role===null||!!workflowRole(v.role))&&exact(v.target,['id','revision'])&&uuid(v.target.id)&&v.target.id!==record.id&&(v.target.revision===null||revisionId(v.target.revision)));
   if(v.role){const role=workflowRole(v.role);valid(role.exact?!!v.target.revision:v.target.revision===null);if(['run-of','follows-run'].includes(v.role))valid(record.type==='run');}
   const current=await this.readRecord(store,access,v.target.id);
   if(v.role==='run-of')valid(current.type!=='run'&&!record.relations.some(r=>r.id!==data.linkId&&r.role==='run-of'),'RECORD_CHANGED');
   let targetRecord=current;
   if(v.target.revision){
    if(previous?.target.id===v.target.id&&previous.target.revision===v.target.revision)targetRecord=(await this.linked(store,access,record,previous.id)).record;
    else {valid(recordRevision(current)===v.target.revision,'RECORD_CHANGED');await this.materials.retainRecord(current);}
   }
   link={id:data.linkId,type:v.type,...(v.role?{role:v.role}:{}),label:targetRecord.title,target:{workspaceId:scope.workspaceId,kind:'record',id:v.target.id,...(v.target.revision?{revision:v.target.revision}:{})}};
  }
  const next=structuredClone(record),index=next.relations.findIndex(r=>r.id===data.linkId);
  if(index<0)next.relations.push(link);else if(link)next.relations[index]=link;else next.relations.splice(index,1);
  valid(next.relations.length<=1000,'LIMIT');next.updatedAt=new Date().toISOString();
  await new ResearchRecords(this.workspace,new MediaStore(this.workspace)).saveLocked({workspaceId:scope.workspaceId,changes:[{id:record.id,expectedRevision:recordRevision(record),record:next}]},{receipt:true});
  const response={hash,revision:recordRevision(next)};await this.workspace.writeMetadata(receipt,JSON.stringify(response));
  await audit(access,record.id,'relationship',{linkId:data.linkId,before:recordRevision(record),after:response.revision});return response;
 }
}
