// Legacy envelopes are bounded by their original format. Convert only the
// selected change; streamed checkpoints retain their fields one at a time.
import {AppError} from './errors.js';
import {upgradeRecord} from './web/record-model.js';
import {RecordBlockStore} from './record-block-store.js';
import {RecordDocument} from './record-document.js';
import {withDraftDocument,retainDraftDocument} from './record-draft-document.js';
import {inspectTransferredDraft} from './record-draft-inspection.js';
import {requireDraftDocuments} from './catalogue-format.js';

export const recoveryRecordCount=draft=>[1,2].includes(draft.formatVersion)?draft.changes.length:1;
export function recoveryRecord(draft,position=0){
 if(!Number.isSafeInteger(position)||position<0||position>=recoveryRecordCount(draft)||![1,2,3,4].includes(draft.formatVersion))throw new AppError('INVALID');
 const change=draft.changes?.[position];
 return change?{recordId:change.record.id,revision:change.expectedRevision,title:change.record.title}:{...draft.base,title:draft.titles[0]};
}
export async function recoveryHistoryBase(store,recordId,revision){
 const index=store.historyIndex(recordId),head=await index.head();let found=await index.lookup(head,'view',revision,{optional:true});
 // Earlier history summaries did not cache canonical revisions. Inspect each
 // immutable original through its document reader instead of loading history.
 if(!found&&head.legacy)for(const item of head.legacy){if((await index.display(item)).revision===revision){found={item};break;}}
 if(!found)throw new AppError('RECORD_HISTORY_MISSING');return found.item;
}
export async function withRecoveryDraft(store,draft,position,consume){
 recoveryRecord(draft,position);
 if(draft.formatVersion===4)return withDraftDocument(store,draft,document=>consume(document,null));
 if(draft.formatVersion===3){
  const expected=await inspectTransferredDraft(store.workspace,draft.id,draft.content,{ownership:true});
  if(expected.base.recordId!==draft.base.recordId||expected.base.revision!==draft.base.revision||expected.title!==draft.titles[0])throw new AppError('CATALOGUE_DAMAGED');
  const document=await retainDraftDocument(store.workspace,draft.id,draft.content,expected);
  return withDraftDocument(store,{...draft,document},value=>consume(value,null));
 }
 const change=draft.changes[position],record=upgradeRecord(change.record),generation=1,key=await store.scopeKey(record.notebookId,generation,{create:true});
 try{
  const blocks=new RecordBlockStore(store,record.notebookId,generation,key),tree=blocks.tree();
  const mine=new RecordDocument(blocks,await tree.retain(record));
  const base=draft.formatVersion===1&&change.base?new RecordDocument(blocks,await tree.retain(upgradeRecord(change.base))):null;
  await requireDraftDocuments(store.db);await blocks.flush();return await consume(mine,base);
 }finally{key.fill(0);}
}
