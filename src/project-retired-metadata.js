import {materialPartKey} from './material-part-identity.js';
// Source metadata keeps authenticated locations into its adopted project.
// Identical live project metadata shares the retained immutable payload, so
// retirement does not create another permanent copy of the same bytes.
import {withRetiredProjectCatalogue} from './project-retired-records.js';
import {ProjectSourceAuthority,validProjectSourceAuthority} from './project-source-authority.js';
import {adoptedMetadataFact,exclusiveMetadataFact} from './project-metadata-ownership.js';
export {exclusiveMetadataFact} from './project-metadata-ownership.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
const local='observanda-owned-metadata',remote='observanda-retired-metadata';
const hash=value=>digest(serialize(value)),validRevision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export const retainedMetadataSlot=revision=>'project-source-metadata:payload:'+revision;
export function localMetadataLocation(revision){if(!validRevision(revision))throw new AppError('INVALID');return {format:local,version:1,revision};}
export function retiredMetadataLocation(owner,id,revision){if(!validProjectSourceAuthority(owner)||typeof id!=='string'||!id.startsWith('metadata:')||!validRevision(revision))throw new AppError('INVALID');return {format:remote,version:1,id,revision,owner:structuredClone(owner)};}
export const isMetadataLocation=value=>[local,remote].includes(value?.format);
export async function retainedMetadataValue(store,revision,{id=null}={}){
 if(!store.workspace.projectId||store.domain!==undefined||!validRevision(revision))damaged();
 const slot=retainedMetadataSlot(revision),row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
 if(!row){
  // An immutable part is already retained by its content address. Resolve that
  // authenticated object instead of storing a second payload in retained state.
  if(!materialPartKey(id))damaged();const value=await store.object(id);
  if(value===null||isMetadataLocation(value)||hash(value)!==revision)damaged();return value;
 }
 const value=store.decode('state',slot,row.payload);if(isMetadataLocation(value)||hash(value)!==revision)damaged();return value;
}
export async function resolveMetadataValue(store,id,revision,value){
 if(!isMetadataLocation(value))return value;
 if(value.version!==1||value.revision!==revision||!validRevision(revision))damaged();
 if(value.format===local){if(Object.keys(value).sort().join()!=='format,revision,version')damaged();return retainedMetadataValue(store,revision);}
 if(Object.keys(value).sort().join()!=='format,id,owner,revision,version'||value.id!==id||!validProjectSourceAuthority(value.owner)||!id.startsWith('metadata:'))damaged();
 return withRetiredProjectCatalogue(store,value.owner,{kind:'project',id:value.owner.projectId,domain:'research'},async selected=>{
  const fact=await adoptedMetadataFact(selected,value.owner,id);
  if(!exclusiveMetadataFact(fact,value.owner.projectId)||fact.sourceRevision!==revision)damaged();
  return retainedMetadataValue(selected,revision,{id});
 });
}

// Ownership inspection needs the authenticated location, never the foreign
// payload. Larger ordinary metadata cannot be a bounded retirement location.
export async function retiredMetadataSourceLocation(store,id){
 if(store.workspace.projectId||!id.startsWith('metadata:'))return null;
 const row=await store.db.get('SELECT payload FROM objects WHERE id=$1 AND octet_length(payload)<=4096',id);if(!row)return null;
 const value=store.decode('object',id,row.payload);if(value?.format!==remote)return null;
 if(Object.keys(value).sort().join()!=='format,id,owner,revision,version'||value.version!==1||value.id!==id||!validRevision(value.revision)||!validProjectSourceAuthority(value.owner))damaged();
 const index=store.objectIndex(),member=await index.find(await index.head(),id),authority=await new ProjectSourceAuthority(store).receipt(value.owner.projectId);
 if(member?.revision!==value.revision||!authority||hash(authority)!==hash(value.owner)||(await store.snapshot()).metadata.id!==value.owner.sourceNamespace)damaged();
 return value;
}
export async function retiredMetadataSourceOwner(store,id){const value=await retiredMetadataSourceLocation(store,id);return value?{kind:'project',projectId:value.owner.projectId}:null;}


export async function metadataRetiredElsewhere(store,id,projectId){
 const owner=await retiredMetadataSourceOwner(store,id);if(!owner)return false;
 if(owner.projectId===projectId)throw new AppError('PROJECT_RELOCATED',[{projectId}]);return true;
}
