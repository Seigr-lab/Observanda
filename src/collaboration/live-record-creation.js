import {materialRecordSummary} from '../material-record-summary.js';
import {ConfigurationCommands} from '../configuration-commands.js';
import {RecordConfigurationSeed} from '../record-configuration-seed.js';
import {RecordDraftReview} from '../record-draft-review.js';
import {MediaStore} from '../media.js';
import {randomUUID} from 'node:crypto';
import {identityHash} from './identity.js';
import {liveValid} from './live-protocol.js';
import {uuid,exact,text,date} from '../modules/validation.js';
import {ResearchRecords} from '../research.js';
import {RECORD_TYPES} from '../web/record-types.js';
import {fieldValueErrors} from '../web/custom-fields.js';

const prefix='.observanda/collaboration/live/creations/';
const valid=(condition,code='INVALID')=>liveValid(condition,code);
const types=()=>RECORD_TYPES.map(type=>({...type,kind:'type',revision:identityHash(type),fields:[]}));

// Called only inside the host's authorization/record transaction. Templates,
// timestamps, privacy and section IDs belong to the host, never the requester.
export class LiveRecordCreation{
 constructor(workspace){this.workspace=workspace;}
 async context(store,access,notebookId,source=null){
  valid(uuid(notebookId));valid(access.notebookIds.includes(notebookId),'COLLABORATION_DENIED');
  const metadata=(await store.snapshot()).metadata,notebook=metadata.notebooks.find(n=>n.id===notebookId);valid(notebook,'COLLABORATION_DENIED');
  const owner={workspaceId:metadata.id,projectId:notebook.projectId,notebookId,slot:'configuration'};
  if(source){valid(source.kind==='template'&&source.configurationPin?.workspaceId===metadata.id&&source.configurationPin.notebookId===notebookId&&source.configurationPin.projectId===notebook.projectId,'RECORD_CHANGED');}
  return new ConfigurationCommands(this.workspace).context(store,{...owner,...(source?{configurationPin:source.configurationPin}:{})});
 }
 async options(store,access,notebookId,{offset=0,limit=20,query=''}={}){
  valid(Number.isSafeInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>0&&limit<=32&&typeof query==='string'&&query.length<=160);
  const context=await this.context(store,access,notebookId),page=await context.reader.window({collection:'sections',available:true,offset,limit,query});
  const choices=page.rows.map(row=>({...row.value,kind:'template',revision:row.revision,configurationPin:context.pin,fieldsCount:row.counts.fields})),general=types().filter(type=>!query||type.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const total=page.total+general.length;
  if(choices.length<limit)choices.push(...general.slice(Math.max(0,offset-page.total),Math.max(0,offset-page.total)+limit-choices.length));
  return {notebookId,choices,total,offset,next:offset+choices.length<total?offset+choices.length:null};
 }
 async selected(store,access,data){
  valid(data.source&&exact(data.source,['kind','id','revision','configurationPin']));
  const context=await this.context(store,access,data.notebookId,data.source),section=await context.reader.item({collection:'sections',key:data.source.id});
  valid(section?.value.enabled&&section.revision===data.source.revision,'RECORD_CHANGED');
  if(section.value.profileId!==null)valid((await context.reader.item({collection:'profiles',key:section.value.profileId}))?.value.enabled,'RECORD_CHANGED');
  return {context,section};
 }
 async window(store,access,data,{choices=false}={}){
  const {context}=await this.selected(store,access,data),page=await context.reader.window({collection:choices?'choices':'fields',sectionId:data.source.id,...(choices?{fieldKey:data.fieldKey}:{}),offset:data.offset??0,limit:data.limit??20,query:data.query??''});
  return {notebookId:data.notebookId,source:data.source,...page,...(choices?{items:page.rows.map(row=>row.value)}:{fields:page.rows.map(row=>({...row.value,schemaRevision:row.revision,choiceCount:row.counts.choices}))})};
 }
 async create(store,access,scope,data,audit){
  valid(exact(data,['id','notebookId','source','title','occurredOn','values'])&&uuid(data.id)&&uuid(data.notebookId));
  valid(access.notebookIds.includes(data.notebookId),'COLLABORATION_DENIED');
  const file=prefix+access.principalId+'/'+data.id+'.json',hash=identityHash(data),raw=await this.workspace.readMetadata(file,4096);
  if(raw){
   const receipt=JSON.parse(raw);valid(receipt.hash===hash,'CONFLICT');
   const member=await store.member(await store.snapshot(),receipt.record.id);
   // Retrying never recreates a deleted record, nor exposes one moved out of scope.
   valid(!member||access.notebookIds.includes(member.notebookId),'COLLABORATION_DENIED');
   return {...receipt,removed:!member};
  }
  valid(data.source&&text(data.title,180,true)&&date(data.occurredOn)&&data.values&&typeof data.values==='object'&&!Array.isArray(data.values));
  let choice;
  if(data.source.kind==='template'){const selected=await this.selected(store,access,data);choice={...selected.section.value,kind:'template'};}
  else{valid(exact(data.source,['kind','id','revision']));choice=types().find(value=>value.kind===data.source.kind&&value.id===data.source.id&&value.revision===data.source.revision);valid(choice,'RECORD_CHANGED');valid(!fieldValueErrors(choice.fields,data.values).length);}
  const now=new Date().toISOString(),record={id:randomUUID(),notebookId:data.notebookId,type:choice.kind==='template'?'note':choice.id,title:data.title,body:'',contributors:[],relations:[],tags:[],occurredOn:data.occurredOn,createdAt:now,updatedAt:now,share:false,figures:[],status:'draft',sections:(choice.sections??[]).map(title=>({id:randomUUID(),title,body:''})),attachments:[]};
  if(choice.kind==='template'){
   const seed=await new RecordConfigurationSeed(this.workspace).seedLocked({id:randomUUID(),workspaceId:scope.workspaceId,recordId:record.id,notebookId:record.notebookId,sectionId:choice.id,configurationPin:data.source.configurationPin,record}),review=new RecordDraftReview(this.workspace,new MediaStore(this.workspace)),base={id:seed.draft.id,workspaceId:scope.workspaceId,expectedRevision:seed.revision};
   let plan=await review.prepareLocked(base);const target=()=>({id:plan.id,workspaceId:scope.workspaceId,expectedRevision:plan.revision});
   for(const [key,value] of Object.entries(data.values)){
    const field='template:'+key,selected=await review.editRead({...target(),field});await review.editWriteLocked({...target(),field,editRevision:selected.editRevision,valueRevision:selected.revision,value:{value},operationId:randomUUID()});
   }
   plan=await review.prepareLocked(base);await review.applyLocked(target());
  }else await new ResearchRecords(this.workspace,{}).saveLocked({workspaceId:scope.workspaceId,changes:[{id:record.id,expectedRevision:null,record}]},{receipt:true});
  const member=await store.member(await store.snapshot(),record.id),saved=await materialRecordSummary(store,member),receipt={hash,record:{id:record.id,notebookId:record.notebookId,title:record.title,status:record.status,revision:saved.revision}};
  await this.workspace.writeMetadata(file,JSON.stringify(receipt));
  await audit(access,record.id,'create',{after:receipt.record.revision,source:data.source});
  return {...receipt,removed:false};
 }
}
