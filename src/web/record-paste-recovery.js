import {projectApiRoute,researchContext,researchOwner} from './project-context.js';
import {revisionId} from './revision-model.js';
import {validMaterialReference} from './material-reference.js';
import {editorBookText as message} from './text-tools.js';

export function recordPasteRecovery({state,api,base,context,onSaved}){
 const namespace=researchContext(state),owner=researchOwner(state),sessionId=state.storage.contextId,editor=context();
 const {recordId,workspaceId}=base;
 const route=url=>projectApiRoute(url,owner);
 let retained=null,upload=null,intent=null;
 function guard(signal){
  signal.throwIfAborted();
  if(context()!==editor||state.access?.locked||state.book?.id!==workspaceId||researchContext(state)!==namespace)
   throw Error(message('capacityChanged'));
 }
 async function split(sections,signal){
  guard(signal);
  const result=await api('/api/research/records/sections',{action:'append-private',recordId,workspaceId,expectedRevision:base.storageRevision,sections},{signal,owner,adopt:false});
  guard(signal);
  if(!result?.saved||!revisionId(result.storageRevision)||result.sectionIds?.length!==sections.length||
     !sections.every((s,i)=>s.id===result.sectionIds[i]))throw Error(message('capacityRetry'));
  base.storageRevision=result.storageRevision;
  onSaved({workspaceId,recordId,sectionId:sections[0].id});
 }
 async function retain(file,name,signal){
  guard(signal);
  const [{uploadEvidenceChunks},{matchingUploadPrefix,fingerprintFile,singleFileIntakeId}]=await Promise.all([import('./evidence-upload-batch.js'),import('./evidence-fingerprint.js')]);
  const call=async(action,data)=>{
   guard(signal);
   const reply=await api('/api/research/materials/'+action,data,{signal,owner,adopt:false});guard(signal);return reply;
  };
  if(file!==retained){
   const fingerprint=await fingerprintFile(file,{signal});guard(signal);
   retained=file;upload=null;intent={requestId:crypto.randomUUID(),fingerprint,recordId,name,size:file.size};
  }
  const id=await singleFileIntakeId(recordId,intent.requestId);
  const validOriginal=ref=>validMaterialReference(ref)&&ref.kind==='artifact'&&ref.id===id&&ref.workspaceId===undefined;
  function receipt(reply){
   if(reply?.id!==id||reply.recordId!==recordId||reply.name!==name||reply.size!==file.size||reply.requestId!==intent.requestId||
      reply.fingerprint!==intent.fingerprint||reply.completed!==null&&!validOriginal(reply.completed))throw Error(message('capacityChanged'));
   return reply;
  }
  upload=receipt(upload?await call('upload-session',{id}):await call('start',intent));
  function finish(){retained=null;upload=null;intent=null;onSaved({workspaceId,recordId});}
  if(upload.completed){
   // A final reply may have been lost. Resolve its exact immutable revision
   // before releasing the author's only copy of the proposed paste.
   const saved=await call('read',{ref:upload.completed});
   if(saved?.kind!=='artifact'||saved.id!==id||saved.recordId!==recordId||saved.content?.name!==name||saved.content.size!==file.size)throw Error(message('capacityChanged'));
   finish();return;
  }
  if(!await matchingUploadPrefix(file,upload,{signal}))throw Error(message('capacityChanged'));
  async function* chunks(){
   for(let index=upload.receivedChunks;index<Math.ceil(file.size/upload.chunkSize);index++)
    yield {id:upload.id,index,blob:file.slice(index*upload.chunkSize,(index+1)*upload.chunkSize)};
  }
  await uploadEvidenceChunks(chunks(),{route,context:sessionId,signal,check:()=>guard(signal),uploaded:(_frame,reply)=>receipt(reply)});
  async function jobFor(action){
   const {job}=await call(action,{id});
   if(job?.id!==id||job.type!=='evidence.finalize'||job.scope!==recordId)throw Error(message('capacityChanged'));
   return job;
  }
  let job=await jobFor('finish');
  if(['failed','cancelled'].includes(job.state))job=await jobFor('retry-job');
  while(['queued','running'].includes(job.state)){
   await new Promise(resolve=>setTimeout(resolve,350));job=await jobFor('job');
  }
  if(job.state!=='completed')throw Error(job.message||message('capacityRetry'));
  upload=receipt(await call('upload-session',{id}));
  if(!validOriginal(job.result)||job.result.revision!==upload.completed?.revision)throw Error(message('capacityRetry'));
  finish();
 }
 return {split,retain};
}
