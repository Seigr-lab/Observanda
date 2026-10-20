import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
// A queued publication job retains only its initiating session's source resolver.
// Credentials are neither serialized into jobs nor shared between jobs.
export class PublicationSourceAccess {
 constructor(){this.pending=new Map();}
 bind(id,sourceReader){
  if(!researchId(id))throw new AppError('INVALID');
  if(typeof sourceReader!=='function')throw new AppError('ACCESS_LOCKED');
  if(!this.pending.has(id)&&this.pending.size>=128)throw new AppError('LIMIT');
  const grant={sourceReader};this.pending.set(id,grant);
  return ()=>{if(this.pending.get(id)===grant)this.pending.delete(id);};
 }
 take(id){const grant=this.pending.get(id);this.pending.delete(id);return grant?.sourceReader;}
 forget(id){this.pending.delete(id);}
 clear(){this.pending.clear();}
}
