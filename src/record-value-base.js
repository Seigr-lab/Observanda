// The record version a selected value is edited from. A saved record is read at
// one stored version; a new record before its first Save is read from its draft
// at one edit. Both are immutable, so recovery copies verify the same way on each.
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {withRecordDocument,RecordDocument} from './record-document.js';
import {withRecordBlockStore} from './record-block-store.js';
import {RecordDraftEdits} from './record-draft-edits.js';
import {validRecordDraftBase} from './web/record-value-model.js';
import {revisionId} from './web/revision-model.js';
import {digest,serialize} from './storage-format.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const planRevision=plan=>{const {saved,...value}=plan;void saved;return digest(serialize(value));};

// The caller validates its own selection shape (a value field or a writing section);
// consume({document,row,baseRevision}) — row is the saved member, or null for a draft base.
export async function withSelectedValueBase(store,{workspaceId,recordId,selection},consume,{mutable=false}={}){
 if(!researchId(recordId)||!selection||!(revisionId(selection.storageRevision)&&!Object.hasOwn(selection,'recordDraft')||validRecordDraftBase(selection.recordDraft)&&!Object.hasOwn(selection,'storageRevision')))throw new AppError('INVALID');
 if(selection.storageRevision){
  const history=store.historyIndex(recordId),found=await history.lookup(await history.head(),'version',selection.storageRevision);
  const snapshot=await store.recordSnapshot(found.item.snapshotId,recordId),row=await store.member(snapshot,recordId);
  if(snapshot.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  if(!row||row.revision!==found.item.revision)fail();
  const baseRevision=(await history.display(found.item)).revision;
  return withRecordDocument(store,recordId,selection.storageRevision,document=>consume({document,row,baseRevision}),{mutable});
 }
 const edits=new RecordDraftEdits(store),{id,edit}=selection.recordDraft,plan=await edits.plan(id);
 // A draft that was saved or discarded is no longer a base for new edits.
 if(!plan||plan.saved)throw new AppError('DRAFT_CHANGED');
 if((await store.snapshot()).metadata.id!==workspaceId||plan.workspaceId!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
 if(plan.recordId!==recordId)throw new AppError('INVALID');
 const baseRevision=digest(serialize({plan:planRevision(plan),edit}));
 if(edit===null)return withRecordBlockStore(store,plan.notebookId,plan.generation,(blocks,owner)=>consume({document:new RecordDocument(blocks,plan.roots.mine,{mutable:mutable&&owner===store}),row:null,baseRevision}));
 const node=await edits.node(edit);if(!edits.matches(plan,node.owner))fail();
 return edits.document(node,document=>consume({document,row:null,baseRevision}));
}
