import {liveFigure} from './live-figures.js';
import {LivePreparations,livePreparationOperations} from './live-preparations.js';
import {ContentAccess} from './content-access.js';
import {LiveDocuments} from './live-documents.js';
import {identityHash} from './identity.js';
import {liveValid as valid} from './live-protocol.js';
import {organizationTransaction} from './transaction.js';
import {ResearchRecords,recordRevision} from '../research.js';
import {MediaStore} from '../media.js';
import {uuid,exact} from '../modules/validation.js';
import {ResearchMaterials} from '../research-materials.js';
import {onlineDetailFieldsFor,onlineDetails,onlineDetailValue,setOnlineDetail} from '../web/online-details-model.js';
import {LiveRecordCreation} from './live-record-creation.js';
import {LiveRelationships} from './live-relationships.js';
import {LiveAttempts} from './live-attempts.js';
import {LiveEvidence} from './live-evidence.js';
import {authorizeLive,liveRecord,liveRecordWithoutAttempt} from './live-access.js';
import {auditLive} from './live-audit.js';

const prefix='.observanda/collaboration/live/';
export class LiveResearch{
 constructor(workspace){this.workspace=workspace;this.access=new ContentAccess(workspace);this.documents=new LiveDocuments(workspace);this.presence=new Map();}
 async authorized(identity,scope,{write=false}={}){
  return authorizeLive(this.workspace,identity,scope,{write});
 }
 async record(store,access,id){
  return liveRecord(store,access,id);
 }
 async audit(access,recordId,operation,detail){
  return auditLive(this.workspace,access,recordId,operation,detail);
 }
 figure(identity,scope,data,options={}){return liveFigure(this,identity,scope,data,options);}
 async dispatch(identity,scope,operation,data={}){
  if(operation==='figure')return this.figure(identity,scope,data);
  valid([...livePreparationOperations,'list','read','details','document','steps','fields','comments','comment','activity','evidence','evidence-read','evidence-page','evidence-uploads','evidence-upload','evidence-start','evidence-chunk','evidence-finish','creation','creationFields','creationChoices','create','link-targets','link-read','link-write','links','attempt','attempt-pin','attempt-read','attempt-page','attempt-append'].includes(operation));
  const write=['preparation-rebase','preparation-change','preparation-save','preparation-remove','steps','fields','comment','creation','creationFields','creationChoices','create','link-write','attempt-pin','attempt-append','evidence-start','evidence-chunk','evidence-finish'].includes(operation);
  // Authorization and the actual access/mutation share a transaction, including
  // grants, current team membership and records moved out of the shared scope.
  return organizationTransaction(this.workspace,()=>this.workspace.catalogue(async store=>{
   const access=await this.authorized(identity,scope,{write});
   if(['creation','creationFields','creationChoices','create'].includes(operation)){
    const creation=new LiveRecordCreation(this.workspace);
    if(operation==='creation')return creation.options(store,access,data.notebookId,data);
    if(operation==='creationFields'||operation==='creationChoices')return creation.window(store,access,data,{choices:operation==='creationChoices'});
    return creation.create(store,access,scope,data,this.audit.bind(this));
   }
   if(operation==='list'){
    valid(data.after===undefined||data.after===null||uuid(data.after));valid(data.notebookId===undefined||access.notebookIds.includes(data.notebookId),'COLLABORATION_DENIED');
    const snapshot=await store.snapshot(),rows=[];
    for await(const row of store.members(snapshot,{notebookIds:new Set(data.notebookId?[data.notebookId]:access.notebookIds)}))if(!data.after||row.id>data.after){rows.push(row);rows.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);if(rows.length>101)rows.pop();}
    const page=rows.slice(0,100),records=[];for(const row of page){const history=store.historyIndex(row.id),found=await history.lookup(await history.head(),'version',row.revision),display=await history.display(found.item);records.push({id:row.id,notebookId:row.notebookId,title:display.title,status:display.status,revision:display.revision});}
    return {role:access.grant.role,notebooks:snapshot.metadata.notebooks.filter(n=>access.notebookIds.includes(n.id)).map(({id,title})=>({id,title})),records,next:rows.length>100?page.at(-1).id:null};
   }
   if(livePreparationOperations.includes(operation))return new LivePreparations(this.workspace,this.record.bind(this)).dispatch(store,access,scope,operation,data,this.audit.bind(this));
   if(operation==='attempt-append'&&['event','assessment'].includes(data.kind))return new LivePreparations(this.workspace,this.record.bind(this)).append(store,access,scope,data,this.audit.bind(this));
   valid(data.pagedAttempt===undefined||data.pagedAttempt===true&&['read','document','steps','comments'].includes(operation));
   const partial=data.pagedAttempt===true?await liveRecordWithoutAttempt(store,access,data.recordId):null,record=partial?.record??await this.record(store,access,data.recordId),revision=partial?.revision??recordRevision(record);
   if(operation.startsWith('evidence-'))return new LiveEvidence(this.workspace).dispatch(store,identity,access,scope,record,operation,data);
   const relationships=new LiveRelationships(this.workspace,this.record.bind(this));
   if(operation==='links')return {relations:record.relations,revision,role:access.grant.role};
   if(operation==='link-targets')return relationships.targets(store,access,data);
   if(operation==='link-read')return relationships.linked(store,access,record,data.linkId);
   if(operation==='link-write')return relationships.write(store,access,scope,record,data,this.audit.bind(this));
   const attempts=new LiveAttempts(this.workspace,this.record.bind(this));
   if(operation==='attempt')return {attempt:record.attempt??null,relations:record.relations,revision,role:access.grant.role};
   if(operation==='attempt-pin')return attempts.pin(store,access,scope,record,data.ref);
   if(operation==='attempt-read')return attempts.read(store,access,record,data.ref,data.trail);
   if(operation==='attempt-page')return attempts.page(store,access,record,data);
   if(operation==='attempt-append')return attempts.append(store,access,scope,record,data,this.audit.bind(this));
   if(operation==='read')return {record,revision,role:access.grant.role,workspaceId:scope.workspaceId,...(partial?{attemptRevision:partial.storageRevision}:{})};
   if(operation==='details')return {values:onlineDetails(record),revision,role:access.grant.role};
   if(operation==='document'||operation==='steps'){
    valid(operation==='steps'||data.steps===undefined);
    const result=await this.documents.update(scope.workspaceId,record,data,partial?{access,revision}:{});
    if(result.saved)await this.audit(access,record.id,'document',{field:data.field,before:revision,after:result.revision});
    const {saved,...response}=result;void saved;
    return {...response,role:access.grant.role,details:onlineDetails(record),relations:record.relations,...(partial?{attemptRevision:(await store.member(await store.snapshot(),record.id)).revision}:{attempt:record.attempt??null}),presence:await this.present(identity,scope,access,record.id,data.clientId)};
   }
   if(operation==='fields'){
    const editable=onlineDetailFieldsFor(record);
    valid(uuid(data.id)&&Array.isArray(data.changes)&&data.changes.length>0&&data.changes.length<=editable.length&&new Set(data.changes.map(c=>c.field)).size===data.changes.length&&data.changes.every(c=>exact(c,['field','before','value'])&&editable.includes(c.field)));
    const receipt=prefix+'receipts/'+access.principalId+'/'+data.id+'.json',hash=identityHash(data),raw=await this.workspace.readMetadata(receipt,2048);
    if(raw){const prior=JSON.parse(raw);valid(prior.hash===hash,'CONFLICT');return prior;}
    const next=structuredClone(record);
    for(const change of data.changes){valid(identityHash(onlineDetailValue(record,change.field))===identityHash(change.before),'RECORD_CHANGED');setOnlineDetail(next,change.field,change.value);}
    next.updatedAt=new Date().toISOString();
    await new ResearchRecords(this.workspace,new MediaStore(this.workspace)).saveLocked({workspaceId:scope.workspaceId,changes:[{id:record.id,expectedRevision:revision,record:next}]},{receipt:true});
    const response={hash,revision:recordRevision(next)};await this.workspace.writeMetadata(receipt,JSON.stringify(response));await this.audit(access,record.id,'fields',{fields:data.changes.map(c=>c.field),before:revision,after:response.revision});return response;
   }
   if(operation==='activity'){
    const raw=await this.workspace.readMetadata(prefix+'activity/'+record.id+'/index.json',1024),count=raw?JSON.parse(raw).count:0,before=data.before??count;valid(Number.isSafeInteger(before)&&before>=0&&before<=count);
    const items=[];for(let i=before-1;i>=Math.max(0,before-50);i--)items.push(JSON.parse(await this.workspace.readMetadata(prefix+'activity/'+record.id+'/'+i+'.json',8192)));
    return {items,before:Math.max(0,before-50)||null};
   }
   if(operation==='comments'||operation==='comment'){
    const file=prefix+'comments/'+record.id+'/index.json',raw=await this.workspace.readMetadata(file,1024);let count=raw?JSON.parse(raw).count:0;
    if(operation==='comment'){
     valid(uuid(data.id)&&typeof data.text==='string'&&data.text.trim().length>0&&data.text.length<=10000);
     const receipt=prefix+'comments/'+record.id+'/ids/'+data.id+'.json',existing=await this.workspace.readMetadata(receipt,32768);
     if(existing){const prior=JSON.parse(existing);valid(prior.principalId===access.principalId&&prior.text===data.text,'CONFLICT');return prior;}
     const comment={id:data.id,text:data.text,at:new Date().toISOString(),principalId:access.principalId,name:access.name,recordRevision:revision,index:count};
     await this.workspace.writeMetadata(receipt,JSON.stringify(comment));await this.workspace.writeMetadata(prefix+'comments/'+record.id+'/'+count+'.json',JSON.stringify(comment));await this.workspace.writeMetadata(file,JSON.stringify({count:++count}));return comment;
    }
    const before=data.before??count;valid(Number.isSafeInteger(before)&&before>=0&&before<=count);const start=Math.max(0,before-50),items=[];
    for(let i=start;i<before;i++)items.push(JSON.parse(await this.workspace.readMetadata(prefix+'comments/'+record.id+'/'+i+'.json',32768)));
    return {items,before:start||null,count};
   }
   const materials=new ResearchMaterials(this.workspace),items=[];await materials.index.ensureLocked();
   const page=await materials.index.page({recordId:record.id,cursor:data.cursor??null,limit:20});
   for(const head of page.items){valid(head?.recordId===record.id,'MATERIAL_MISSING');const doc=await materials.read(head);items.push({id:head.id,kind:head.kind,title:head.title,revision:head.revision,...(head.kind==='artifact'?{name:doc.content.name,size:doc.content.size,sha256:doc.content.sha256,sourcePath:doc.content.sourcePath??null,sourcePurpose:doc.content.sourcePurpose??null,provenance:doc.content.provenance??''}:{})});}
   return {items,next:page.next};
  }));
 }
 async present(identity,scope,access,recordId,clientId){
  valid(uuid(clientId));const now=Date.now();for(const [key,item] of this.presence)if(item.at<now-15000)this.presence.delete(key);
  const key=identity.id+':'+clientId;valid(this.presence.has(key)||this.presence.size<256,'LIMIT');this.presence.set(key,{identity,scope,recordId,name:access.name,at:now});
  const names=new Set();for(const [key,item] of this.presence)if(item.recordId===recordId){try{const current=await this.authorized(item.identity,item.scope);if(current.notebookIds.some(id=>access.notebookIds.includes(id)))names.add(item.name);}catch{this.presence.delete(key);}}
  return [...names];
 }
 async file(identity,scope,{recordId,kind,id,linkId,revision,artifactRevision,attemptRef,attemptTrail,evidenceRef,evidenceTrail}){
  return organizationTransaction(this.workspace,()=>this.workspace.catalogue(async store=>{
   const access=await this.authorized(identity,scope);let record=await this.record(store,access,recordId);valid(uuid(id));
   if(attemptRef!==undefined||evidenceRef!==undefined){
    valid(linkId===undefined&&!(attemptRef!==undefined&&evidenceRef!==undefined));const retained=attemptRef!==undefined?await new LiveAttempts(this.workspace,this.record.bind(this)).read(store,access,record,attemptRef,attemptTrail):await new LiveEvidence(this.workspace).read(store,access,record,evidenceRef,evidenceTrail);
    if(kind==='artifact'){valid(retained.reference.kind==='artifact'&&retained.reference.id===id,'COLLABORATION_DENIED');const {doc,content}=await new ResearchMaterials(this.workspace).artifact(retained.reference);return {content,name:doc.content.name,mime:'application/octet-stream'};}
    valid(kind==='media'&&retained.record,'COLLABORATION_DENIED');record=retained.record;
   }
   if(linkId!==undefined){valid(kind==='media');const linked=await new LiveRelationships(this.workspace,this.record.bind(this)).linked(store,access,record,linkId);valid(linked.revision===revision,'RECORD_CHANGED');record=linked.record;}
   if(kind==='media'){valid(record.attachments.some(a=>a.id===id),'COLLABORATION_DENIED');const value=await new MediaStore(this.workspace).get(id,{streamed:true});return {content:value.bytes,name:id+'.'+value.extension,mime:value.mime};}
   valid(kind==='artifact');const materials=new ResearchMaterials(this.workspace),head=await materials.current(id);valid(head?.recordId===recordId&&head.kind==='artifact','COLLABORATION_DENIED');const {doc,content}=await materials.artifact({...head,revision:artifactRevision??head.revision});valid(doc.recordId===recordId,'COLLABORATION_DENIED');return {content,name:doc.content.name,mime:'application/octet-stream'};
  }));
 }
}
