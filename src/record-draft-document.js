import {hasNestedAttemptContinuations} from './web/attempt-model.js';
import {DraftTemplateBuilder} from './record-draft-template.js';
// A recovery checkpoint retains addressable fields and collection items under
// its notebook key. The original transport remains available for compatibility.
import {RecordBlockStore,withRecordBlockStore} from './record-block-store.js';
import {RecordDocument} from './record-document.js';
import {RecordContainerBuilder} from './record-tree-values.js';
import {inspectTransferredDraft} from './record-draft-inspection.js';
import {catalogueFormat,requireDraftEdits,requireNestedAttemptCollections} from './catalogue-format.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';

export const validDraftDocument=value=>value&&Object.keys(value).sort().join()==='generation,notebookId,root'&&researchId(value.notebookId)&&Number.isSafeInteger(value.generation)&&value.generation>0&&revisionId(value.root);
export async function retainDraftDocument(workspace,id,content,expected,{signal}={}){
 return workspace.catalogue(async store=>{
  // A notebook may have been removed in another window while the user was
  // typing. Preserve that unfinished work; a research save resolves ownership.
  const generation=1,key=await store.scopeKey(expected.notebookId,generation,{create:true});
  try{
   const blocks=new RecordBlockStore(store,expected.notebookId,generation,key),tree=blocks.tree(),record=new RecordContainerBuilder(blocks,'object');let collection=null,template=null;
   const close=async()=>{if(collection){await record.add({name:collection.name,value:await collection.builder.finish()});collection=null;}};
   const inspected=await inspectTransferredDraft(workspace,id,content,{signal,ownership:true,part:async part=>{
    if(part.kind==='field'&&part.name==='attempt'&&hasNestedAttemptContinuations(part.value))await requireNestedAttemptCollections(store.db);
    if(part.kind!=='item')await close();
    if(part.kind==='template'){
     template??=new DraftTemplateBuilder(blocks);const root=await template.accept(part);if(root){await record.add({name:'template',value:root});template=null;}return;
    }
    if(part.kind==='array')collection={name:part.name,builder:new RecordContainerBuilder(blocks,'array')};
    else if(part.kind==='item'){
     if(collection?.name!==part.name||collection.builder.count!==part.index)throw new AppError('INVALID');
     await collection.builder.add({value:await tree.retain(part.value)});
    }else if(part.kind==='field')await record.add({name:part.name,value:await tree.retain(part.value)});
   }});
   if(inspected.base.recordId!==expected.base.recordId||inspected.base.revision!==expected.base.revision||inspected.title!==expected.title||inspected.notebookId!==expected.notebookId)throw new AppError('DRAFT_CHANGED');
   await close();const root=await record.finish();await requireDraftEdits(store.db);await blocks.flush();
   return {notebookId:expected.notebookId,generation,root};
  }finally{key.fill(0);}
 });
}
export async function withDraftDocument(store,draft,consume){
 if(!validDraftDocument(draft.document))throw new AppError('FORMAT');
 if(await catalogueFormat(store.db)<5)throw new AppError('CATALOGUE_DAMAGED');
 const {notebookId,generation,root}=draft.document;
 return withRecordBlockStore(store,notebookId,generation,async blocks=>{
  const document=new RecordDocument(blocks,root);
  for(const [field,value] of [['id',draft.base.recordId],['notebookId',notebookId]])if((await document.field([field])).value!==value)throw new AppError('CATALOGUE_DAMAGED');
  return await consume(document);
 });
}
