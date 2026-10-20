import {hasNestedAttemptContinuations} from './web/attempt-model.js';
import {catalogueFormat,catalogueRequiresNestedAttemptCollections} from './catalogue-format.js';
import {DraftTemplateComparison} from './record-draft-template.js';
// A backup must prove both checkpoint representations agree. Authentication of
// individual envelopes alone cannot establish that their selected fields match.
import {ResearchDrafts} from './research-drafts.js';
import {inspectTransferredDraft} from './record-draft-inspection.js';
import {withDraftDocument} from './record-draft-document.js';
import {sameJSONData} from './web/json-data-equality.js';
import {operationAdvance,operationItem} from './operation-progress.js';
import {AppError} from './errors.js';
import {verifyWritingDraft} from './record-writing-drafts.js';
import {verifyRecordValueDraft} from './record-value-drafts.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};

export async function verifyRetainedDraft(store,draft,{signal}={}){
 if(draft.formatVersion===6){signal?.throwIfAborted();await verifyRecordValueDraft(store,draft);return;}
 if(draft.formatVersion===5){signal?.throwIfAborted();await verifyWritingDraft(store,draft);return;}
 if(![3,4].includes(draft.formatVersion))return;
 const inspect=async document=>{
  const fields=new Set();let collection=null,count=0,template=null;
  const close=async()=>{if(document&&collection!==null&&await document.tree.arrayLength(document.root,[collection])!==count)fail();collection=null;count=0;};
  const inspected=await inspectTransferredDraft(store.workspace,draft.id,draft.content,{signal,ownership:true,part:async(part,{templateScratch}={})=>{
   if(part.kind==='field'&&part.name==='attempt'&&hasNestedAttemptContinuations(part.value)&&!catalogueRequiresNestedAttemptCollections(await catalogueFormat(store.db)))fail();
   if(part.kind!=='item')await close();
   if(part.kind==='change')return;
   if(part.kind==='template'){
    fields.add('template');if(document){template??=new DraftTemplateComparison(document,{signal,scratch:templateScratch});await template.accept(part);if(part.type==='end'&&!part.path.length)template=null;}return;
   }
   if(part.kind==='array'){fields.add(part.name);collection=part.name;return;}
   const path=part.kind==='item'?[part.name,String(part.index)]:[part.name];
   if(part.kind==='item'){if(collection!==part.name||part.index!==count++)fail();}else fields.add(part.name);
   if(document){const stored=await document.field(path,{signal});if(!stored.found||!sameJSONData(stored.value,part.value))fail();}
  }});
  await close();
  if(inspected.base.recordId!==draft.base.recordId||inspected.base.revision!==draft.base.revision||inspected.title!==draft.titles[0])fail();
  if(document){
   const names=await document.tree.propertyNames(document.root);
   if(inspected.notebookId!==draft.document.notebookId||names.length!==fields.size||names.some(name=>!fields.has(name)))fail();
  }
 };
 if(draft.formatVersion===4)await withDraftDocument(store,draft,inspect);else await inspect(null);
}
export async function verifyResearchDrafts(store,{signal}={}){
 const drafts=new ResearchDrafts(store.workspace),workspaceId=(await store.snapshot()).metadata.id;
 for await(const name of store.workspace.metadataNames('.observanda/drafts')){
  signal?.throwIfAborted();if(!/^[a-f0-9-]{36}\.json$/.test(name))fail();
  const result=await drafts.read(name.slice(0,-5),{expand:false,header:true,raw:true});
  if(!result||result.draft.workspaceId!==workspaceId)fail();operationItem(result.draft.titles?.[0]??name);
  await verifyRetainedDraft(store,result.draft,{signal});operationAdvance();
 }
 const {verifyRecordDraftReviews}=await import('./record-draft-review.js');await verifyRecordDraftReviews(store,{signal});
 const {verifyRecordOwnerDrafts}=await import('./record-owner-drafts.js');await verifyRecordOwnerDrafts(store,{signal});
}
