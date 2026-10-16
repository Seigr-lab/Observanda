import {randomUUID} from 'node:crypto';
import {identityHash} from './identity.js';
import {liveValid} from './live-protocol.js';
import {uuid,exact,text,date} from '../modules/validation.js';
import {ResearchRecords,recordRevision} from '../research.js';
import {RECORD_TYPES} from '../web/record-types.js';
import {configurationOf,templateFrom} from '../web/notebook-schema.js';
import {availableSections} from '../web/laboratory/catalog.js';
import {fieldValueErrors} from '../web/custom-fields.js';

const prefix='.observanda/collaboration/live/creations/';
const valid=(condition,code='INVALID')=>liveValid(condition,code);
const summary=record=>({id:record.id,notebookId:record.notebookId,title:record.title,status:record.status,revision:recordRevision(record)});
const types=()=>RECORD_TYPES.map(type=>({...type,kind:'type',revision:identityHash(type),fields:[]}));

// Called only inside the host's authorization/record transaction. Templates,
// timestamps, privacy and section IDs belong to the host, never the requester.
export class LiveRecordCreation{
 constructor(workspace){this.workspace=workspace;}
 async options(store,access,notebookId){
  valid(uuid(notebookId));valid(access.notebookIds.includes(notebookId),'COLLABORATION_DENIED');
  const notebook=(await store.snapshot()).metadata.notebooks.find(n=>n.id===notebookId);valid(notebook,'COLLABORATION_DENIED');
  const templates=availableSections(configurationOf(notebook)).map(section=>({...templateFrom(section),kind:'template',revision:identityHash(section)}));
  return {notebookId,choices:[...templates,...types()]};
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
  valid(exact(data.source,['kind','id','revision'])&&text(data.title,180,true)&&date(data.occurredOn));
  const options=await this.options(store,access,data.notebookId),choice=options.choices.find(c=>c.kind===data.source.kind&&c.id===data.source.id);
  valid(choice&&choice.revision===data.source.revision,'RECORD_CHANGED');
  valid(!fieldValueErrors(choice.fields,data.values).length);
  const now=new Date().toISOString(),record={id:randomUUID(),notebookId:data.notebookId,type:choice.kind==='template'?'note':choice.id,title:data.title,body:'',contributors:[],relations:[],tags:[],occurredOn:data.occurredOn,createdAt:now,updatedAt:now,share:false,figures:[],status:'draft',sections:(choice.sections??[]).map(title=>({id:randomUUID(),title,body:''})),attachments:[]};
  if(choice.kind==='template'){const {id,profileId,label,description,fields}=choice;record.template={id,profileId,label,description,fields,values:structuredClone(data.values)};}
  await new ResearchRecords(this.workspace,{}).saveLocked({workspaceId:scope.workspaceId,changes:[{id:record.id,expectedRevision:null,record}]},{receipt:true});
  const member=await store.member(await store.snapshot(),record.id),saved=await store.record(record.id,member.revision);
  const receipt={hash,record:summary(saved)};
  await this.workspace.writeMetadata(file,JSON.stringify(receipt));
  await audit(access,record.id,'create',{after:receipt.record.revision,source:data.source});
  return {...receipt,removed:false};
 }
}
