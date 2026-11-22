// Cancelling a paused command releases its lifecycle reservation. Destination
// files remain owned by their existing folder; cancellation never deletes data.
import path from 'node:path';
import {withProjectLifecycle} from './project-lifecycle.js';
import {withWriterLease} from './writer-lease.js';
import {trackProjectTransfer} from './project-transfer-tasks.js';
import {moveSource} from './workspace-move-state.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export const transferTerminal=phase=>['complete','cancelled'].includes(phase);
export function cancelProjectTransfer(registry,storage,{kind,file,read,save,id}){
 if(!['copy','archive'].includes(kind)||!researchId(id)||!researchId(storage?.projectId))throw new AppError('INVALID');
 return trackProjectTransfer(file,()=>withProjectLifecycle(registry,storage.projectId,kind,()=>withWriterLease(path.join(path.dirname(file),storage.projectId+'.lock'),async()=>{
  const value=await read();if(!value||value.id!==id)throw new AppError('NOT_FOUND');if(value.phase==='cancelled')return value;
  if(value.phase!=='copying')throw new AppError('CONFLICT');
  const entry=await registry.locate(storage.projectId);
  if(value.projectId!==storage.projectId||entry.root!==value.source||storage.root!==value.source||entry.vaultId!==value.vaultId||storage.vault?.id!==value.vaultId)throw new AppError('CONFLICT');
  if(await moveSource(value.source))throw new AppError('STORAGE_PROJECT_BUSY');
  value.phase='cancelled';await save(value);return value;
 })));
}
