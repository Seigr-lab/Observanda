// A new run inherits selected preparation inputs, never the previous result.
// Growing tags and relationships remain stored references throughout creation.
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {createRun,inheritedRunLink} from './web/record-workflow.js';
import {materialRecordSummary} from './material-record-summary.js';
import {ResearchMaterials} from './research-materials.js';
import {withRecordDocument,RecordDocument} from './record-document.js';
import {RecordContainerBuilder} from './record-tree-values.js';
import {RecordMemberCollections} from './record-member-collections.js';
import {recordDocumentSummary} from './record-document-summary.js';
import {validateRecordDocument} from './record-document-validation.js';
import {validateDocumentSources} from './record-document-sources.js';
import {commitRecordDocument} from './record-document-commit.js';
import {digest,serialize} from './storage-format.js';
const prefix='record-run-creation:';
const valid=c=>c&&[c.workspaceId,c.sourceId,c.id].every(researchId)&&c.id!==c.sourceId;
const fail=()=>{throw new AppError('INVALID');};
const validCommand=c=>valid(c)&&Object.keys(c).sort().join()==='expectedRevision,id,sourceId,title,workspaceId'&&revisionId(c.expectedRevision)&&typeof c.title==='string'&&!!c.title.trim()&&c.title.length<=180;
function validateReceipt(receipt,id,workspaceId){if(!validCommand(receipt?.command)||receipt.command.id!==id||receipt.command.workspaceId!==workspaceId||receipt.sourceId!==receipt.command.sourceId||receipt.request!==digest(serialize(receipt.command))||receipt.saved?.recordId!==id||receipt.saved.workspaceId!==workspaceId||!revisionId(receipt.saved.etag))throw new AppError('CATALOGUE_DAMAGED');}
export class RecordRunCreation{
 constructor(workspace){this.workspace=workspace;}
 async context(store,command){
  const etag=await store.head(),snapshot=await store.snapshot(etag);if(snapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  if(snapshot.metadata.formatVersion!==21)throw new AppError('FORMAT');return {etag,snapshot};
 }
 async source(store,snapshot,id){const row=await store.member(snapshot,id);if(!row)throw new AppError('MISSING');return {row,summary:await materialRecordSummary(store,row)};}
 async prepare(command){
  if(!valid(command)||Object.keys(command).sort().join()!=='id,sourceId,workspaceId')fail();
  return this.workspace.catalogue(async store=>{
   const {snapshot}=await this.context(store,command),receipt=await store.object(prefix+command.id);
   if(receipt){validateReceipt(receipt,command.id,command.workspaceId);if(receipt.sourceId!==command.sourceId)throw new AppError('CONFLICT');return {saved:receipt.saved};}
   const {row,summary}=await this.source(store,snapshot,command.sourceId);return {sourceId:row.id,title:summary.title,revision:summary.revision,repeating:row.type==='run'};
  });
 }
 async create(command){
  if(!validCommand(command))fail();
  return this.workspace.withLock(()=>this.workspace.catalogue(async store=>{
   const {etag,snapshot}=await this.context(store,command),request=digest(serialize(command)),receipt=await store.object(prefix+command.id);
   if(receipt){validateReceipt(receipt,command.id,command.workspaceId);if(receipt.request!==request)throw new AppError('CONFLICT');return receipt.saved;}
   if(await store.member(snapshot,command.id))throw new AppError('CONFLICT');
   const {row,summary}=await this.source(store,snapshot,command.sourceId);if(summary.revision!==command.expectedRevision)throw new AppError('RECORD_CHANGED');
   return withRecordDocument(store,row.id,row.revision,async source=>{
    const repeating=row.type==='run',minimal={id:row.id,title:summary.title,type:row.type,notebookId:row.notebookId,relations:[],tags:[],sections:[]};
    if(await source.tree.select(source.root,['attempt','preparations'])){
     const count=await source.tree.arrayLength(source.root,['attempt','preparations']);
     if(count)minimal.attempt={version:1,preparations:[(await source.field(['attempt','preparations',String(count-1)])).value],events:[],assessments:[]};
    }
    const pin=await new ResearchMaterials(this.workspace).retainCurrentRecordLocked(row.id);
    const next=createRun({...snapshot.metadata,entries:[]},minimal,{previous:repeating?minimal:null,revision:pin.revision,title:command.title,uuid:randomUUID});next.id=command.id;
    let document=new RecordDocument(source.blocks,await source.tree.retain(next),{mutable:true});
    document=new RecordDocument(source.blocks,await document.replaceReference(document.root,['tags'],await source.reference(['tags'])),{mutable:true});
    const links=new RecordContainerBuilder(source.blocks,'array'),methodKey=l=>serialize([l.target.workspaceId,l.target.id,l.target.revision]),methodKeys=new Set(next.relations.filter(l=>l.role==='uses-method').map(methodKey));
    for await(const item of source.items(['relations'])){
     const link=await source.tree.read(item.value);if(!inheritedRunLink(link,repeating))continue;
     await links.add({value:await source.tree.retain({...link,id:randomUUID()})});if(link.role==='uses-method')methodKeys.delete(methodKey(link));
    }
    for(const link of next.relations){if(link.role==='uses-method'&&!methodKeys.has(methodKey(link)))continue;await links.add({value:await source.tree.retain(link)});}
    document=new RecordDocument(source.blocks,await document.replaceReference(document.root,['relations'],await links.finish()),{mutable:true});
    if(repeating){
     for await(const item of source.items(['sections']))if((await source.tree.selected(item.value,['title'])).value==='Parameters and conditions'){
      const body=await source.tree.select(item.value,['body']),ref=body.inline?await source.tree.retain(body.value):body.revision,position=next.sections.findIndex(s=>s.title==='Parameters and conditions');
      document=new RecordDocument(source.blocks,await document.replaceReference(document.root,['sections',String(position),'body'],ref),{mutable:true});break;
     }
    }
    const header=await validateRecordDocument(document,snapshot.metadata);await validateDocumentSources(store,snapshot,document,header,null,null);
    const members=new RecordMemberCollections(store);let member={id:command.id,collections:{sections:null,contributors:null,relations:null,figures:null,attachments:null}};
    for(const field of Object.keys(member.collections))member=await members.changed(member,field,document);
    member={...member,...await recordDocumentSummary(document,header,{revision:document.root,memberBytes:0},{collections:member.collections})};
    const result=await commitRecordDocument(store,{etag,snapshot,row:null,document,member}),saved={workspaceId:command.workspaceId,recordId:command.id,etag:result.etag};
    await store.putObject(prefix+command.id,{sourceId:row.id,request,saved,command});return saved;
   },{mutable:true});
  }));
 }
}
export async function verifyRecordRunCreations(store,{signal}={}){
 const workspaceId=(await store.snapshot()).metadata.id;
 for await(const key of store.objectIdEntries(prefix,{signal})){
  signal?.throwIfAborted();const receipt=await store.object(key),id=key.slice(prefix.length);validateReceipt(receipt,id,workspaceId);
  const snapshot=await store.snapshot(receipt.saved.etag),row=await store.member(snapshot,id),source=await store.member(snapshot,receipt.sourceId);
  if(snapshot.metadata.id!==workspaceId||row?.type!=='run'||row.share!==false||!source||row.notebookId!==source.notebookId||(await materialRecordSummary(store,row)).title!==receipt.command.title||(await materialRecordSummary(store,source)).revision!==receipt.command.expectedRevision)throw new AppError('CATALOGUE_DAMAGED');
 }
}
