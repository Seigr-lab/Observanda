// Starting a configured record retains its selected schema under the book key.
// The normal draft editor and Save command own all subsequent changes.
import {createHash} from 'node:crypto';
import {ConfigurationCommands} from './configuration-commands.js';
import {RecordBlockStore} from './record-block-store.js';
import {RecordDocument} from './record-document.js';
import {RecordContainerBuilder} from './record-tree-values.js';
import {copyRecordValue} from './record-document-copy.js';
import {RecordDraftChunks} from './record-draft-chunks.js';
import {ResearchDrafts} from './research-drafts.js';
import {validDraftRecord} from './record-draft-validation.js';
import {requireDraftEdits} from './catalogue-format.js';
import {RECORD_DRAFT_CHUNK_BYTES as SIZE} from './web/record-draft-protocol.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
const invalid=()=>{throw new AppError('INVALID');};
const receiptFile=id=>'.observanda/record-configuration-seeds/'+id+'.json';
async function* transport(document){
 yield Buffer.from('[{"baseRevision":null,"expectedRevision":null,"record":');
 for await(const text of document.tree.json(document.root))yield Buffer.from(text);
 yield Buffer.from('}]');
}
async function retainTransport(workspace,id,document){
 let bytes=0;const hash=createHash('sha256');
 for await(const chunk of transport(document)){bytes+=chunk.length;if(!Number.isSafeInteger(bytes))invalid();hash.update(chunk);}
 const chunks=new RecordDraftChunks(workspace,id);let content={bytes,sha256:hash.digest('hex'),root:null},pending=Buffer.allocUnsafe(SIZE),filled=0,index=0;
 for await(const chunk of transport(document))for(let offset=0;offset<chunk.length;){
  const length=Math.min(SIZE-filled,chunk.length-offset);chunk.copy(pending,filled,offset,offset+length);offset+=length;filled+=length;
  if(filled===SIZE){content=await chunks.add(content,index++,pending);pending=Buffer.allocUnsafe(SIZE);filled=0;}
 }
 if(filled)content=await chunks.add(content,index,pending.subarray(0,filled));
 return content;
}
export class RecordConfigurationSeed{
 constructor(workspace){this.workspace=workspace;}
 async seed(command){return this.workspace.withLock(()=>this.seedLocked(command));}
 async seedLocked(command){
  if(!command||Object.keys(command).sort().join()!=='configurationPin,id,notebookId,record,recordId,sectionId,workspaceId'||![command.id,command.workspaceId,command.recordId,command.notebookId,command.sectionId].every(researchId)||!validDraftRecord(command.record)||command.record.id!==command.recordId||command.record.notebookId!==command.notebookId||command.record.template!=null)invalid();
  const request=digest(serialize(command)),workspace=this.workspace;
  return workspace.catalogue(async store=>{
   const snapshot=await store.snapshot();if(snapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const drafts=new ResearchDrafts(workspace),rawReceipt=await workspace.readMetadata(receiptFile(command.id),8192);
   if(rawReceipt!==null){
    let prior;try{prior=JSON.parse(rawReceipt);}catch{throw new AppError('CATALOGUE_DAMAGED');}
    if(prior?.version!==1||!revisionId(prior.request)||!revisionId(prior.revision)||prior.draft?.id!==command.id||prior.draft.workspaceId!==command.workspaceId)throw new AppError('CATALOGUE_DAMAGED');
    if(prior.request!==request)throw new AppError('CONFLICT');
    const current=await drafts.read(command.id,{header:true,expand:false});if(current?.revision!==prior.revision)throw new AppError('DRAFT_CHANGED');
    return {draft:prior.draft,revision:prior.revision,record:prior.record,configurationPin:command.configurationPin};
   }
   if(await store.member(snapshot,command.recordId)||await drafts.read(command.id,{header:true,expand:false}))throw new AppError('EXISTS');
   const pin=command.configurationPin;if(pin?.workspaceId!==command.workspaceId||pin.notebookId!==command.notebookId||pin.slot!=='configuration')invalid();
   const context=await new ConfigurationCommands(workspace).context(store,{...pin,configurationPin:pin}),section=await context.reader.sectionReference({id:command.sectionId});
   if(!section||!section.value.enabled)throw new AppError('NOT_FOUND');
   if(section.value.profileId!==null&&!(await context.reader.item({collection:'profiles',key:section.value.profileId}))?.value.enabled)throw new AppError('NOT_FOUND');
   const generation=1,key=await store.scopeKey(command.notebookId,generation,{create:true});
   try{
    const blocks=new RecordBlockStore(store,command.notebookId,generation,key),document=new RecordDocument(blocks,null,{mutable:true}),builder=new RecordContainerBuilder(blocks,'object');
    for(const [name,value] of Object.entries(command.record))if(name!=='template')await builder.add({name,value:await document.tree.retain(value)});
    const fields=await copyRecordValue(context.reader.document,document,section.fields),template=new RecordContainerBuilder(blocks,'object');
    for(const name of ['id','profileId','label','description'])await template.add({name,value:await document.tree.retain(section.value[name])});
    await template.add({name:'fields',value:fields});await template.add({name:'values',value:await document.tree.retain({})});
    await builder.add({name:'template',value:await template.finish()});document.root=await builder.finish();await blocks.flush();
    const content=await retainTransport(workspace,command.id,document),draft={formatVersion:4,id:command.id,workspaceId:command.workspaceId,updatedAt:new Date().toISOString(),count:1,titles:[command.record.title.slice(0,160)],base:{recordId:command.recordId,revision:null},content,document:{notebookId:command.notebookId,generation,root:document.root}};
    await requireDraftEdits(store.db);await drafts.index.ensureLocked(command.workspaceId);
    const raw=serialize(draft),revision=digest(raw);await workspace.writeMetadata('.observanda/drafts/'+command.id+'.json',raw);await drafts.index.putLocked({draft,revision},digest(serialize({text:raw})));
    const header={id:command.recordId,notebookId:command.notebookId,type:command.record.type,title:command.record.title,createdAt:command.record.createdAt,updatedAt:command.record.updatedAt},summary={id:draft.id,workspaceId:draft.workspaceId,updatedAt:draft.updatedAt,count:1,titles:draft.titles};
    await workspace.writeMetadata(receiptFile(command.id),serialize({version:1,request,revision,draft:summary,record:header}));
    return {draft:summary,revision,record:header,configurationPin:pin};
   }finally{key.fill(0);}
  });
 }
}
