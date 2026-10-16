import {randomUUID} from 'node:crypto';
import {uuid} from '../modules/validation.js';
import {validRichText} from '../web/rich-text-model.js';
import {identityHash} from './identity.js';
import {liveValid as valid} from './live-protocol.js';
import {organizationTransaction} from './transaction.js';

const prefix='.observanda/collaboration/live/drafts';
const validField=field=>field==='body'||typeof field==='string'&&field.startsWith('section:')&&uuid(field.slice(8));
const label=value=>typeof value==='string'&&value.length<=300;
const summary=({document,...value})=>value;

// Drafts belong to this installation, independently of remote availability or
// permission. A removed connection must never make locally authored text lost.
export class LiveDrafts{
 constructor(workspace){this.workspace=workspace;}
 directory(data){valid(uuid(data.connectionId)&&uuid(data.recordId)&&validField(data.field));return prefix+'/'+data.connectionId+'/'+data.recordId+'/'+identityHash(data.field);}
 validate(value,name){
  valid(value&&uuid(value.clientId)&&uuid(value.revision)&&validField(value.field)&&uuid(value.connectionId)&&uuid(value.recordId)&&label(value.title)&&label(value.fieldTitle)&&Number.isFinite(Date.parse(value.savedAt))&&validRichText(value.document,{maxCharacters:60000}),'COLLABORATION_DAMAGED');
  valid(this.directory(value)+'/'+value.clientId+'.json'===name,'COLLABORATION_DAMAGED');return value;
 }
 async command(data){
  const directory=this.directory(data);valid(uuid(data.clientId));const file=directory+'/'+data.clientId+'.json';
  if(Object.hasOwn(data,'document'))return organizationTransaction(this.workspace,async()=>{
   const raw=await this.workspace.readMetadata(file,2*1024*1024),previous=raw?this.validate(JSON.parse(raw),file):null;
   if(Object.hasOwn(data,'expectedRevision'))valid((previous?.revision??null)===data.expectedRevision,'DRAFT_CHANGED');
   if(data.document===null){if(previous)await this.workspace.removeMetadata(file);return {saved:true};}
   valid(validRichText(data.document,{maxCharacters:60000})&&label(data.title??'')&&label(data.fieldTitle??''));
   const value={connectionId:data.connectionId,recordId:data.recordId,field:data.field,clientId:data.clientId,title:data.title??previous?.title??'',fieldTitle:data.fieldTitle??previous?.fieldTitle??'',document:data.document,revision:randomUUID(),savedAt:new Date().toISOString()},text=JSON.stringify(value);
   valid(Buffer.byteLength(text)<=1024*1024,'LIMIT');await this.workspace.writeMetadata(file,text);return {saved:true,revision:value.revision};
  });
  if(data.readOnly===true){const raw=await this.workspace.readMetadata(file,2*1024*1024);return {draft:raw?this.validate(JSON.parse(raw),file):null};}
  const drafts=[];for await(const name of this.workspace.metadataNames(directory)){
   const raw=await this.workspace.readMetadata(directory+'/'+name,2*1024*1024);if(raw)drafts.push(this.validate(JSON.parse(raw),directory+'/'+name));valid(drafts.length<=128,'LIMIT');
  }
  drafts.sort((a,b)=>b.savedAt.localeCompare(a.savedAt));return {draft:drafts.find(d=>d.clientId===data.clientId)??null,others:drafts.filter(d=>d.clientId!==data.clientId)};
 }
 async list({after=null}={}){
  valid(after===null||typeof after==='string'&&/^[-a-zA-Z0-9/.]+$/.test(after)&&!after.includes('..'));
  const page=await this.workspace.metadataPage(prefix,{after,limit:20});
  return {items:page.items.map(item=>summary(this.validate(JSON.parse(item.text),prefix+'/'+item.name))),next:page.next};
 }
}
