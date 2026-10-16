import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {revisionText} from './web/revision-model.js';
import {researchId} from './web/research-reference.js';
export const comparisonInputHash=command=>digest(revisionText(command));
// Shared by workers serving the same result owner. A claimant can consume only
// the initiating client's exact job capability, never its own source grants.
export class ComparisonJobAccess{
 constructor(){this.pending=new Map();}
 key(namespace,id){if(!researchId(namespace)||!researchId(id))throw new AppError('INVALID');return namespace+':'+id;}
 bind(namespace,id,command,open){
  const key=this.key(namespace,id);if(typeof open!=='function')throw new AppError('ANALYSIS_SOURCE_ACCESS');
  if(this.pending.has(key))throw new AppError('JOB_CHANGED');if(this.pending.size>=128)throw new AppError('LIMIT');
  const grant={hash:comparisonInputHash(command),open};this.pending.set(key,grant);
  return ()=>{if(this.pending.get(key)===grant)this.pending.delete(key);};
 }
 take(namespace,job){
  const key=this.key(namespace,job.id),grant=this.pending.get(key);this.pending.delete(key);
  if(!grant||grant.hash!==comparisonInputHash(job.input.command))throw new AppError('ANALYSIS_SOURCE_ACCESS');return grant.open;
 }
 forget(namespace,id){this.pending.delete(this.key(namespace,id));}
 clear(){this.pending.clear();}
}
