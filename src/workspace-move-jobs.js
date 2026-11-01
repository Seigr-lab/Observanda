import {readMoveReceipt} from './workspace-move.js';
import {authorizedWorkspaceMove} from './workspace-move-authorization.js';
import {finishWorkspaceProjectMove} from './workspace-project-move.js';
import {readWorkspaceProjectMove} from './workspace-project-move-state.js';
import {AppError} from './errors.js';

const type='storage.move-cleanup';
async function admitted(workspace,job){
 const receipt=await readMoveReceipt(workspace.root);
 if(!receipt||job.id!==receipt.id||job.scope!==workspace.vault?.id||job.input.moveId!==receipt.id||!await authorizedWorkspaceMove(workspace,receipt))throw new AppError('STORAGE_MOVE_STATE');
 return receipt;
}
export function workspaceMoveJobDefinitions(workspace){return {[type]:{
 authorize:job=>admitted(workspace,job),
 async prepare(job,{signal,progress}){
  await admitted(workspace,job);signal.throwIfAborted();await progress({stage:'remove-original',done:0,total:1});
  const result=await finishWorkspaceProjectMove(workspace,{requireAuthorization:true,signal,onProgress:()=>signal.throwIfAborted()});
  signal.throwIfAborted();if(result.phase!=='complete')throw new AppError(result.error?.code??'STORAGE_MOVE_STATE');
  return {phase:'complete'};
 },
 async commit(job){if((await admitted(workspace,job)).phase!=='complete')throw new AppError('STORAGE_MOVE_STATE');return {phase:'complete'};}
}};}

// One small receipt probe on unlock. Ordinary openings perform no inventory or
// job-table scan. Copies do not carry the encrypted source-retirement authority.
export async function recoverWorkspaceMove(workspace,queue){
 const receipt=await readMoveReceipt(workspace.root);
 if(!receipt||!await authorizedWorkspaceMove(workspace,receipt))return null;
 if(receipt.phase==='complete'){const bundle=await readWorkspaceProjectMove(workspace);if(!bundle||bundle.phase==='complete')return null;}
 const intent={id:receipt.id,type,scope:workspace.vault.id,input:{moveId:receipt.id}},previous=await queue.read(receipt.id);
 if(previous){
  if(previous.type!==type||previous.scope!==intent.scope||previous.input.moveId!==receipt.id)throw new AppError('JOB_CHANGED');
  // Cancellation is a user decision. A failed automatic attempt retries once
  // on a later unlock; it does not spin against an unavailable disk or NAS.
  return previous.state==='failed'?queue.control(receipt.id,'retry'):previous;
 }
 return queue.enqueue(intent);
}
