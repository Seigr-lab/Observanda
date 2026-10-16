import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {digest,serialize} from './storage-format.js';
import {commitStructureDocuments} from './record-structure-documents.js';
import {reconcileWebsiteMembership} from './website-membership.js';

const fields=['workspaceId','recordId','sourceNotebookId','notebookId','expectedStorageRevision','commandId'];
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.toSorted().join();

// A location command transfers retained blocks under the destination notebook
// key. The original, its revisions and evidence remain independently readable.
export class RecordLocation{
 constructor(workspace){this.workspace=workspace;}
 async move(command,{signal}={}){
  if(!exact(command,fields)||!fields.filter(f=>f!=='expectedStorageRevision').every(f=>researchId(command[f]))||!revisionId(command.expectedStorageRevision)||command.sourceNotebookId===command.notebookId)throw new AppError('INVALID');
  signal?.throwIfAborted();
  return this.workspace.withLock(()=>this.workspace.catalogue(async store=>{
   const etag=await store.head(),current=await store.snapshot(etag);
   if(current.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   if(current.metadata.formatVersion!==21)throw new AppError('FORMAT');
   const file='.observanda/record-locations/'+command.commandId+'.json',fingerprint=digest(serialize(Object.fromEntries(fields.map(key=>[key,command[key]])))),raw=await this.workspace.readMetadata(file,8192);
   if(raw!==null){
    let receipt;try{receipt=JSON.parse(raw);}catch{throw new AppError('CATALOGUE_DAMAGED');}
    if(!exact(receipt,['version','fingerprint','result'])||receipt.version!==1||!revisionId(receipt.fingerprint)||!exact(receipt.result,['etag','saved','recordId','notebookId'])||!revisionId(receipt.result.etag)||receipt.result.saved!==true||!researchId(receipt.result.recordId)||!researchId(receipt.result.notebookId))throw new AppError('CATALOGUE_DAMAGED');
    if(receipt.fingerprint!==fingerprint)throw new AppError('CONFLICT');
    if(receipt.result.recordId!==command.recordId||receipt.result.notebookId!==command.notebookId)throw new AppError('CATALOGUE_DAMAGED');
    return receipt.result;
   }
   const row=await store.member(current,command.recordId);if(!row)throw new AppError('MISSING');
   if(row.revision!==command.expectedStorageRevision||row.notebookId!==command.sourceNotebookId)throw new AppError('RECORD_CHANGED');
   if(!current.metadata.notebooks.some(n=>n.id===command.notebookId))throw new AppError('MISSING');
   const target={id:row.id,notebookId:command.notebookId,share:false},metadata=structuredClone(current.metadata);
   await reconcileWebsiteMembership(metadata,id=>id===row.id?target:store.member(current,id),{moved:[row.id]});
   await store.validateMetadata(current,metadata,{records:[target]});
   await commitStructureDocuments(store,etag,current,metadata,[row],new Map([[row.id,target]]),{signal});
   const result={etag:await store.head(),saved:true,recordId:row.id,notebookId:target.notebookId};
   await this.workspace.writeMetadata(file,serialize({version:1,fingerprint,result}));
   signal?.throwIfAborted();return result;
  }));
 }
}
