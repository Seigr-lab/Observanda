// The stored location of an original file inside the materials folder.
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
export function artifactRelative(doc){
 const c=doc?.content,original=c?.originalId??doc?.id;
 if(doc?.kind!=='artifact'||!researchId(original)||c.storageId!==undefined&&!researchId(c.storageId)||!Number.isSafeInteger(c.size)||c.size<0||!revisionId(c.sha256))throw new AppError('MATERIAL_MISSING');
 return '.observanda/materials/originals/'+original+'/'+(c.storageId?c.storageId+'.original':'original');
}
