// Resolve an immutable revision through its authenticated history index without
// reading the record body or creating a retained material during navigation.
import {AppError} from './errors.js';
export async function recordReferenceLocation(store,id,revision){
 if(!await store.db.get('SELECT 1 FROM records WHERE id=$1 LIMIT 1',id))throw new AppError('NOT_FOUND');
 const index=store.historyIndex(id),found=await index.lookup(await index.head(),'view',revision,{optional:true});
 if(!found)throw new AppError('NOT_FOUND');
 const view=await index.display(found.item),snapshot=await store.snapshot(found.item.snapshotId),row=await store.member(snapshot,id);
 if(view.revision!==revision||row?.revision!==found.item.revision)throw new AppError('CATALOGUE_DAMAGED');
 return {snapshot,row};
}
