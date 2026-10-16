import {AppError} from './errors.js';
import {serialize} from './storage-format.js';
import {publicationText} from './web/publication-messages.js';

const file=key=>'.observanda/live-check-jobs/'+key+'.json';
export class PublicationVerificationJobs{
 constructor(workspace,publisher,queue){this.workspace=workspace;this.publisher=publisher;this.queue=queue;}
 async current(){
  const saved=await this.publisher.read();if(!saved.configured)return null;
  const raw=await this.workspace.readMetadata(file(this.publisher.destinationKey(saved.config)),4096),job=raw?await this.queue.read(JSON.parse(raw).id):null;
  if(!job||job.input.configEtag!==saved.etag||job.input.commit!==saved.receipt?.commit||job.input.releaseId!==saved.receipt?.releaseId||job.input.deploymentId!==(saved.receipt?.deploymentId??null))return null;
  return job;
 }
 async start({configEtag,commit}={}){
  return this.queue.transaction(async()=>{
   const saved=await this.publisher.read(),receipt=saved.receipt;if(!saved.configured||!receipt)throw new AppError('PUBLISH_CONFIG');
   if(configEtag!==undefined&&configEtag!==saved.etag||commit!==undefined&&commit!==receipt.commit)throw new AppError('PUBLISH_STALE');
   const input={configEtag:saved.etag,commit:receipt.commit,releaseId:receipt.releaseId,deploymentId:receipt.deploymentId??null},current=await this.current();
   if(current&&['queued','running'].includes(current.state)&&Object.entries(input).every(([key,value])=>current.input[key]===value))return current;
   const job=await this.queue.enqueueLocked({type:'publication.verify',scope:(await this.workspace.outline()).metadata.id,input});
   await this.workspace.writeMetadata(file(this.publisher.destinationKey(saved.config)),serialize({id:job.id}));return job;
  });
 }
 async authorize(job){
  await this.workspace.requireStorageKey();const saved=await this.publisher.read();
  if(job.scope!==(await this.workspace.outline()).metadata.id||saved.etag!==job.input.configEtag||saved.receipt?.commit!==job.input.commit||saved.receipt?.releaseId!==job.input.releaseId||(saved.receipt?.deploymentId??null)!==job.input.deploymentId)throw new AppError('PUBLISH_STALE');
 }
 async prepare(job,{signal,progress}){
  await this.authorize(job);
  const held=async()=>{await this.queue.held(job.id,job.lease.token);if((await this.current())?.id!==job.id)throw new AppError('PUBLISH_STALE');};
  await held();return this.publisher.verifyLive({...job.input,signal,progress:counts=>progress({stage:publicationText('liveChecking'),...counts}),beforeCommit:held});
 }
}
export function publicationVerificationDefinitions(workspace,publisher,queue){const service=()=>new PublicationVerificationJobs(workspace,publisher,queue());return {'publication.verify':{authorize:job=>service().authorize(job),prepare:(job,options)=>service().prepare(job,options),commit:async(job,result)=>{await service().authorize(job);return result;}}};}
