import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId,revisionText} from './web/revision-model.js';
import {validRecordTag} from './web/record-tags-model.js';
import {digest,serialize} from './storage-format.js';
import {withRecordDocument} from './record-document.js';
import {commitRecordDocument} from './record-document-commit.js';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.sort().join();
const natural=v=>Number.isSafeInteger(v)&&v>=0;

// A displayed tag position is guarded by the exact collection revision. A
// durable receipt prevents a retried removal from affecting a later occupant.
export class RecordTagCommands{
 constructor(workspace){this.workspace=workspace;}
 async receipt(file,request){
  const raw=await this.workspace.readMetadata(file,4096);if(raw===null)return null;let saved;
  try{saved=JSON.parse(raw);}catch{throw new AppError('CATALOGUE_DAMAGED');}
  if(!exact(saved,['version','request','result'])||saved.version!==1||!revisionId(saved.request)||!exact(saved.result,['etag','saved','position'])||!revisionId(saved.result.etag)||saved.result.saved!==true||!natural(saved.result.position))throw new AppError('CATALOGUE_DAMAGED');
  if(saved.request!==request)throw new AppError('RECORD_CHANGED');return saved.result;
 }
 async run(command){
  if(!exact(command,['workspaceId','recordId','id','action','position','tag','expectedRevision'])||![command.workspaceId,command.recordId,command.id].every(researchId)||!revisionId(command.expectedRevision)||!['add','rename','remove'].includes(command.action)||(command.action==='add'?command.position!==null:!natural(command.position))||(command.action==='remove'?command.tag!==null:!validRecordTag(command.tag)))throw new AppError('INVALID');
  const request=digest(revisionText(command)),file='.observanda/tag-commands/'+command.id+'.json';
  return this.workspace.withLock(()=>this.workspace.catalogue(async store=>{
   const etag=await store.head(),snapshot=await store.snapshot(etag);if(snapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   if(snapshot.metadata.formatVersion!==21)throw new AppError('FORMAT');const prior=await this.receipt(file,request);if(prior)return prior;
   const row=await store.member(snapshot,command.recordId);if(!row)throw new AppError('MISSING');
   return withRecordDocument(store,row.id,row.revision,async original=>{
    const count=await original.tree.arrayLength(original.root,['tags']);
    if(command.action!=='add'&&(await original.reference(['tags'])!==command.expectedRevision||command.position>=count))throw new AppError('RECORD_CHANGED');
    let document=original,position=command.position??count,duplicate=-1;
    if(command.tag!==null)for await(const item of original.items(['tags']))if(await original.tree.read(item.value)===command.tag){duplicate=item.index;break;}
    if(command.action==='rename'&&duplicate>=0&&duplicate!==position)throw new AppError('TAG_EXISTS');
    if(command.action==='remove')document=await original.splice(['tags'],position,1,[]);
    else if(command.action==='add'&&duplicate>=0)position=duplicate;
    else if(command.action==='add')document=await original.splice(['tags'],count,0,[command.tag]);
    else if(duplicate!==position)document=await original.replace(['tags',String(position)],command.tag);
    const saved=document===original?{etag}:await commitRecordDocument(store,{etag,snapshot,row,document});
    const result={etag:saved.etag,saved:true,position};await this.workspace.writeMetadata(file,serialize({version:1,request,result}));return result;
   },{mutable:true});
  }));
 }
}
