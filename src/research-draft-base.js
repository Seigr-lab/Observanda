import {AppError} from './errors.js';
import {historicalBook,recordRevision} from './research.js';
// Resolve one immutable base. A checkpoint never needs a duplicate of every
// saved body, nor a current record that may have changed since editing began.
export async function researchDraftBase(workspace,workspaceId,change,{read=true}={}){
 if(change.baseRevision===null)return null;
 if(await workspace.storageKind()!=='catalogue')throw new AppError('FORMAT');
 return workspace.catalogue(async store=>{
  if((await store.snapshot()).metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  const index=store.historyIndex(change.record.id);
  if(!await index.get(index.root))throw new AppError('RECORD_HISTORY_MISSING');
  const head=await index.head();
  let found=await index.lookup(head,'view',change.baseRevision,{optional:true});
  // Old summaries may not cache the canonical display revision. Inspect them
  // individually, keeping only the requested original if it matches.
  if(!found&&head.legacy)for(const item of head.legacy){if((await index.display(item)).revision===change.baseRevision){found={item};break;}}
  if(!found)throw new AppError('RECORD_HISTORY_MISSING');
  if(!read)return null;
  const source=await store.historyItem(change.record.id,found.item);
  if(source.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  const base=historicalBook(source.metadata,source.record).entries[0];
  if(recordRevision(base)!==change.baseRevision)throw new AppError('CATALOGUE_DAMAGED');
  return base;
 });
}
