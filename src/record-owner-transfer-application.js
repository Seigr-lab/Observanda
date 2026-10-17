// Routing never accepts a filesystem location or a vault from a client.
// Destination identity is captured once and recovered from the source receipt.
import {RecordOwnerSession} from './record-owner-session.js';
import {validRecordOwner,validRecordOwnerTransferCommand} from './record-owner-transfer-state.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export const recordOwnerTransferCompletionError=result=>result?.phase==='cancelled'?new AppError('RECORD_TRANSFER_CANCELLED'):null;
export function recordOwnerTransferRequest(route,method='POST'){
 const match=/^\/api\/research\/records\/transfer\/(start|status|resume|cancel)$/.exec(route);
 return method==='POST'&&match?{recordTransfer:match[1],operation:'record-transfer/'+match[1],write:match[1]!=='status',limit:16384}:null;
}
function readCommand(data,{optionalId=false}={}){
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(key=>!['workspaceId','recordId','id'].includes(key))||!researchId(data.workspaceId)||!researchId(data.recordId)||!(optionalId&&data.id===undefined||researchId(data.id)))throw new AppError('INVALID');
 return data;
}
export class RecordOwnerTransferApplication{
 constructor(application){this.application=application;}
 async run(client,selected,data,{check=async()=>{},signal,onProgress,checkpoint}={}){
  const app=this.application,operation=selected.recordTransfer;
  let command,targetOwner;
  if(operation==='start'){
   if(!data||typeof data!=='object'||Array.isArray(data))throw new AppError('INVALID');
   const {targetProjectId,targetLabBookId,...input}=data;
   targetOwner={projectId:targetProjectId,labBookId:targetLabBookId,workspaceId:input.targetWorkspaceId};
   if(!validRecordOwner(targetOwner)||!validRecordOwnerTransferCommand(input))throw new AppError('INVALID');command=input;
  }else{if(!['status','resume','cancel'].includes(operation))throw new AppError('INVALID');command=readCommand(data,{optionalId:operation==='status'});}
  const {RecordOwnerTransfer}=await import('./record-owner-transfer.js');
  const sourceOwner={projectId:selected.projectId??null,labBookId:selected.labBookId??null,workspaceId:command.workspaceId};
  const source=new RecordOwnerSession(app,client,sourceOwner,{check});let destination,invoked=false;
  try{return await app.tracked(()=>source.use(async(storage,checkSource)=>{
   signal?.throwIfAborted();
   if(operation!=='start'){
    const pending=await RecordOwnerTransfer.pending(storage,command);
    if(operation==='status')return pending;
    if(!pending)throw new AppError('NOT_FOUND');
    if(pending.id!==command.id)throw new AppError('CONFLICT');
    if(pending.phase==='complete')return pending;
    targetOwner=pending.targetOwner;
   }
   destination=new RecordOwnerSession(app,client,targetOwner,{check});
   return app.tracked(()=>destination.use(async(target,checkTarget)=>{
    const current=async()=>{signal?.throwIfAborted();await checkSource();await checkTarget();};await current();
    const engine=new RecordOwnerTransfer(storage,target,{registry:await app.registry(),sourceOwner,targetOwner});
    invoked=true;return engine[operation](command,{signal,check:current,progress:onProgress,checkpoint});
   }),targetOwner.projectId,targetOwner.labBookId);
  }),sourceOwner.projectId,sourceOwner.labBookId);}
  catch(error){if(operation!=='status'&&!invoked)error.operationNotStarted=true;throw error;}
  finally{try{await destination?.close();}finally{await source.close();}}
 }
}
