import {RecordWriting} from '../record-writing.js';
import {liveRecordWithoutAttempt} from './live-access.js';
import {randomUUID} from 'node:crypto';
import {Step} from 'prosemirror-transform';
import {schema} from '../editor/schema.js';
import {proseDocument} from '../web/prose-model.js';
import {validRichText} from '../web/rich-text-model.js';
import {identityHash} from './identity.js';
import {liveValid as valid} from './live-protocol.js';
import {ResearchRecords,recordRevision} from '../research.js';
import {MediaStore} from '../media.js';
import {uuid} from '../modules/validation.js';

export function documentField(record,field){
 if(field==='body')return record;
 valid(typeof field==='string'&&field.startsWith('section:')&&uuid(field.slice(8)));
 const section=record.sections.find(s=>s.id===field.slice(8));valid(section,'NOT_FOUND');return section;
}
// Versioned ProseMirror steps and the resulting research revision commit in
// one transaction. Ordinary record edits start a new epoch, never an overwrite.
export class LiveDocuments{
 constructor(workspace){this.workspace=workspace;this.records=new ResearchRecords(workspace,new MediaStore(workspace));}
 async state(record,field){
  const document=schema.nodeFromJSON(proseDocument(documentField(record,field).body)).toJSON(),hash=identityHash(document),file='.observanda/collaboration/live/documents/'+record.id+'/'+identityHash(field)+'.json',raw=await this.workspace.readMetadata(file,4*1024*1024);
  let state=raw?JSON.parse(raw):null;
  if(!state||state.hash!==hash){state={epoch:randomUUID(),version:0,from:0,steps:[],clients:[],hash};await this.workspace.writeMetadata(file,JSON.stringify(state));}
  return {state,document,file};
 }
 async update(workspaceId,record,data,{access=null,revision=null}={}){
  const {state,document,file}=await this.state(record,data.field);
  valid(data.version===undefined||Number.isSafeInteger(data.version)&&data.version>=0);
  const reset=data.epoch!==state.epoch||data.version<state.from||data.version>state.version;
  let saved=null;
  if(data.steps!==undefined){
   valid(Array.isArray(data.steps)&&data.steps.length>0&&data.steps.length<=250&&uuid(data.clientId));
   if(!reset&&data.version===state.version){
    let doc=schema.nodeFromJSON(document);try{for(const value of data.steps){const result=Step.fromJSON(schema,value).apply(doc);valid(!result.failed);doc=result.doc;}}catch{valid(false);}
    valid(validRichText(doc.toJSON(),{maxCharacters:60000}));
    const next=structuredClone(record);documentField(next,data.field).body=doc.toJSON();next.updatedAt=new Date().toISOString();
    if(access){const writing=new RecordWriting(this.workspace),target={workspaceId,recordId:record.id,sectionId:data.field==='body'?null:data.field.slice(8)},selected=await writing.read(target);await writing.saveLocked({...target,expectedRevision:selected.revision,value:{...selected.value,body:doc.toJSON()}});revision=await this.workspace.catalogue(async store=>(await liveRecordWithoutAttempt(store,access,record.id)).revision);}
    else await this.records.saveLocked({workspaceId,changes:[{id:record.id,expectedRevision:recordRevision(record),record:next}]},{receipt:true});
    state.steps.push(...data.steps);state.clients.push(...data.steps.map(()=>data.clientId));state.version+=data.steps.length;state.hash=identityHash(doc.toJSON());
    // Keep a bounded rebase window. Older clients keep their unsent document
    // for comparison and explicitly reopen the latest authoritative revision.
    while(state.steps.length>2000||Buffer.byteLength(JSON.stringify(state))>2*1024*1024){state.steps.shift();state.clients.shift();state.from++;}
    await this.workspace.writeMetadata(file,JSON.stringify(state));saved=next;
   }
  }
  const index=Math.max(0,(data.version??0)-state.from),needsReset=reset||data.version===undefined||data.version<state.from;
  return {epoch:state.epoch,version:state.version,reset:needsReset,...(needsReset?{document:saved?documentField(saved,data.field).body:document}:{steps:state.steps.slice(index),clients:state.clients.slice(index)}),revision:access?revision:recordRevision(saved??record),saved};
 }
}
