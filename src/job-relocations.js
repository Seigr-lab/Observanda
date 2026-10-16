// A relocated job retains its original source document. Its separate durable
// receipt removes execution authority without pretending the task was cancelled.
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {digest,serialize} from './storage-format.js';
import {catalogueContext} from './research-catalogue.js';
import {AppError} from './errors.js';
const fields='namespaceId,operationId,projectId,sourceRevision,version';
export const jobFingerprint=job=>digest(serialize(job));
export function validJobRelocation(value){return value&&Object.keys(value).sort().join()===fields&&value.version===1&&['namespaceId','operationId','projectId'].every(key=>researchId(value[key]))&&revisionId(value.sourceRevision);}
export class JobRelocations{
 constructor(workspace){this.workspace=workspace;}
 file(id){if(!researchId(id))throw new AppError('INVALID');return '.observanda/jobs/relocations/'+id+'.json';}
 async read(id){
  const text=await this.workspace.readMetadata(this.file(id),4096);if(text===null)return null;let value;
  try{value=JSON.parse(text);}catch{throw new AppError('JOB_DAMAGED');}
  if(!validJobRelocation(value))throw new AppError('JOB_DAMAGED');return value;
 }
 async writable(id){if(await this.read(id))throw new AppError('JOB_RELOCATED');}
 async fence(queue,id,receipt){
  const held=catalogueContext.getStore();
  if(held?.root!==this.workspace.root||held.vault!==this.workspace.vault||queue.workspace!==this.workspace||!validJobRelocation(receipt))throw new AppError('INVALID');
  const prior=await this.read(id);
  if(prior){if(jobFingerprint(prior)!==jobFingerprint(receipt))throw new AppError('CONFLICT');return prior;}
  const job=await queue.read(id);if(!job||jobFingerprint(job)!==receipt.sourceRevision)throw new AppError('JOB_CHANGED');
  // The caller's writer transaction owns both queue membership and the fence.
  // A failed commit leaves the old worker and queue intact.
  await queue.membership.update({...job,state:'relocated',lease:null});
  await this.workspace.writeMetadata(this.file(id),JSON.stringify(receipt));
  await queue.announce(await queue.read(id));
  return receipt;
 }
}
