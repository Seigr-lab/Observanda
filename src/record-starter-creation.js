// Instantiate instructions one section at a time. Identity-bearing prose gets
// fresh IDs, while execution/evidence/results never enter the template lane.
import {randomUUID} from 'node:crypto';
import {RecordBlockStore} from './record-block-store.js';
import {RecordDocument} from './record-document.js';
import {RecordContainerBuilder} from './record-tree-values.js';
import {copyRecordValue} from './record-document-copy.js';
import {starterRecord} from './web/record-starter-model.js';
import {validateStarterDocument} from './record-starter-documents.js';
import {validateRecordDocument} from './record-document-validation.js';
import {RecordMemberCollections} from './record-member-collections.js';
import {recordDocumentSummary} from './record-document-summary.js';
import {commitRecordDocument} from './record-document-commit.js';
import {AppError} from './errors.js';
export async function createStarterRecord(workspace,release,command){
 return workspace.catalogue(async store=>{
  const etag=await store.head(),snapshot=await store.snapshot(etag);if(await store.member(snapshot,command.recordId))throw new AppError('RECORD_CHANGED');
  const blueprint=new RecordDocument(release.blocks,await release.reference(['blueprint'])),header=await validateStarterDocument(blueprint),createdAt=new Date().toISOString();
  const initial=starterRecord({...header,sections:[],tags:[]},{id:command.recordId,notebookId:command.notebookId,uuid:randomUUID,now:createdAt}),generation=1,key=await store.scopeKey(command.notebookId,generation,{create:true});
  try{
   const blocks=new RecordBlockStore(store,command.notebookId,generation,key);let document=new RecordDocument(blocks,await blocks.tree().retain(initial),{mutable:true});
   const sections=new RecordContainerBuilder(blocks,'array');
   for await(const item of blueprint.items(['sections'])){const value=await blueprint.tree.read(item.value),fresh=starterRecord({...header,body:'',sections:[value],tags:[]},{id:command.recordId,notebookId:command.notebookId,uuid:randomUUID,now:createdAt}).sections[0];await sections.add({value:await document.tree.retain(fresh)});}
   document=new RecordDocument(blocks,await document.replaceReference(document.root,['sections'],await sections.finish()),{mutable:true});
   document=new RecordDocument(blocks,await document.replaceReference(document.root,['tags'],await copyRecordValue(blueprint,document,await blueprint.reference(['tags']))),{mutable:true});
   const validated=await validateRecordDocument(document,snapshot.metadata),members=new RecordMemberCollections(store);let member={id:command.recordId,collections:{sections:null,contributors:null,relations:null,figures:null,attachments:null}};
   for(const field of Object.keys(member.collections))member=await members.changed(member,field,document);
   member={...member,...await recordDocumentSummary(document,validated,{revision:document.root,memberBytes:0},{collections:member.collections})};
   await commitRecordDocument(store,{etag,snapshot,row:null,document,member});return {number:(await release.field(['number'])).value,name:header.name,createdAt};
  }finally{key.fill(0);}
 });
}
