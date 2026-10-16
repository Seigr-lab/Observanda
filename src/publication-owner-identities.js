import {digest} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const kinds=new Set(['project','notebook','record','media']);
// Calculation is separate from collision tracking so bounded readers can rank
// candidates without retaining an identity entry for every skipped record.
export function publicationOwnerId(workspaceId,namespaceId,kind,id){
 if(!researchId(workspaceId)||!researchId(namespaceId)||!researchId(id)||!kinds.has(kind))throw new AppError('INVALID');
 if(namespaceId===workspaceId)return id;
 return publicationSourceIdentity(namespaceId,kind,id);
}
export function publicationSourceIdentity(namespaceId,kind,id){
 if(!researchId(namespaceId)||!researchId(id)||!kinds.has(kind))throw new AppError('INVALID');
 const origin=namespaceId+'/'+kind+'/'+id,bytes=digest('observanda-publication-owner-v1/'+origin).slice(0,32).split('');
 bytes[12]='4';bytes[16]=(8+(parseInt(bytes[16],16)&3)).toString(16);const hex=bytes.join('');
 return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
// Public page/asset identities are derivatives. Originals keep their IDs and
// revisions; namespace-based destinations stay stable when owners move folders.
export class PublicationOwnerIdentities{
 constructor(workspaceId){if(!researchId(workspaceId))throw new AppError('INVALID');this.workspaceId=workspaceId;this.origins=new Map();this.destinations=new Map();}
 identity(namespaceId,kind,id){
  if(!researchId(namespaceId)||!researchId(id)||!kinds.has(kind))throw new AppError('INVALID');
  const origin=namespaceId+'/'+kind+'/'+id;if(this.destinations.has(origin))return this.destinations.get(origin);
  const value=publicationOwnerId(this.workspaceId,namespaceId,kind,id);
  if(this.origins.has(value)&&this.origins.get(value)!==origin)throw new AppError('PUBLICATION_IDENTITY');
  this.origins.set(value,origin);this.destinations.set(origin,value);return value;
 }
 project(owner,id){return this.identity(owner.projectId===id?owner.projectNamespaceId??owner.workspaceId:owner.workspaceId,'project',id);}
}
