import {digest} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const kinds=new Set(['project','notebook','record','media']);
export function publicationSourceIdentity(namespaceId,kind,id){
 if(!researchId(namespaceId)||!researchId(id)||!kinds.has(kind))throw new AppError('INVALID');
 const origin=namespaceId+'/'+kind+'/'+id,bytes=digest('observanda-publication-owner-v1/'+origin).slice(0,32).split('');
 bytes[12]='4';bytes[16]=(8+(parseInt(bytes[16],16)&3)).toString(16);const hex=bytes.join('');
 return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
