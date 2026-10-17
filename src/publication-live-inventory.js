import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {MaterialSequence} from './material-sequence.js';
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {withWorkspaceMetadataBatch} from './metadata-batch.js';
import {safeLivePath} from './publication-live-manifest.js';

const fail=()=>{throw new AppError('JOB_DAMAGED');};
const identity=value=>digest(serialize(value));
const member=path=>digest('Observanda/live-path/v1/'+path);
const file=key=>{if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))throw new AppError('INVALID');return '.observanda/publication-live/'+key+'.json';};
const validSet=ref=>ref&&Object.keys(ref).sort().join()==='root,version'&&ref.version===1&&validTableRef(ref.root);
const equal=(a,b)=>identity(a)===identity(b);
export class LivePathIndex{
 constructor(workspace,{write}={}){
  this.sequences=new MaterialSequence(workspace);this.write=write??(fn=>workspace.withLock(()=>withWorkspaceMetadataBatch(workspace,fn)));this.reader=this.tree();
 }
 tree(){return new RetainedTableIndex({read:(kind,id)=>this.sequences.read(kind,id,262144),put:(kind,value)=>this.sequences.put(kind,value)},{namespace:'live-inventory-nodes'});}
 validate(ref){if(!validSet(ref))fail();return ref;}
 check(entry){if(!entry||!safeLivePath(entry.id)||entry.revision!==member(entry.id))fail();return entry.id;}
 async has(ref,path){this.validate(ref);const entry=await this.reader.find(ref,path);if(entry)this.check(entry);return !!entry;}
 async *paths(ref){this.validate(ref);for await(const entry of this.reader.entries(ref))yield this.check(entry);}
 async page(ref,{offset=0,limit=64}={}){
  this.validate(ref);if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>128)throw new AppError('INVALID');
  const paths=[],total=ref.root?.count??0;for(let at=offset;at<Math.min(total,offset+limit);at++)paths.push(this.check(await this.reader.entryAt(ref,at)));
  return {paths,total,offset,next:offset+paths.length<total?offset+paths.length:null};
 }
 builder(){
  const owner=this,tree=this.tree();let root=null,pending=new Set(),finished=false,failed=false;
  const flush=async()=>{
   if(!pending.size)return;
   try{await owner.write(async()=>{for(const path of pending)root=await tree.change(root,path,member(path));await tree.flush(root);});}
   catch(error){failed=true;throw error;}pending=new Set();
  };
  return {
   async add(path){if(finished||failed)throw new AppError('INVALID');if(!safeLivePath(path))throw new AppError('INVALID');if(pending.has(path)||await tree.find({root},path))return;pending.add(path);if(pending.size===32)await flush();},
   async finish(){if(finished||failed)throw new AppError('INVALID');await flush();finished=true;return owner.validate({version:1,root});}
  };
 }
}
export function validateDeploymentInventory(value){
 if(!value||typeof value.commit!=='string'||!value.commit||typeof value.releaseId!=='string'||!value.releaseId)fail();
 if(value.version===1){if(![value.files,value.removed].every(a=>Array.isArray(a)&&a.every(safeLivePath)))fail();}
 else if(value.version!==2||!validSet(value.files)||!validSet(value.removed))fail();return value;
}
export async function deploymentInventory(workspace,key){
 const raw=await workspace.readMetadata(file(key),16*1024*1024);if(raw===null)return null;
 let value;try{value=JSON.parse(raw);}catch{fail();}return validateDeploymentInventory(value);
}
export async function* deploymentInventoryPaths(workspace,inventory,kind){
 if(!['files','removed'].includes(kind))throw new AppError('INVALID');if(!inventory)return;validateDeploymentInventory(inventory);
 if(inventory.version===1)yield* inventory[kind];else yield* new LivePathIndex(workspace).paths(inventory[kind]);
}
// Prepare immutable pages before the provider's branch/directory switch. Each
// bounded metadata batch releases the workspace writer; only the final small
// inventory header is published with the confirmed deployment receipt.
export async function prepareDeploymentInventory(workspace,key,files,{removed=[],guard=async()=>{},signal,write=operation=>workspace.withLock(operation)}={}){
 signal?.throwIfAborted();await guard();const before=await deploymentInventory(workspace,key);
 const index=new LivePathIndex(workspace,{write:operation=>write(async()=>{signal?.throwIfAborted();await guard();return withWorkspaceMetadataBatch(workspace,operation);})}),current=index.builder();
 for await(const path of files){signal?.throwIfAborted();await current.add(path);}const desired=await current.finish(),retired=index.builder();
 const consider=async path=>{signal?.throwIfAborted();if(!await index.has(desired,path))await retired.add(path);};
 for(const kind of ['removed','files'])for await(const path of deploymentInventoryPaths(workspace,before,kind))await consider(path);
 for await(const path of removed)await consider(path);
 const result={version:1,before:identity(before),files:desired,removed:await retired.finish()};await guard();return result;
}
export async function assertDeploymentInventory(workspace,key,prepared,receipt=null){
 validatePreparedInventory(prepared);
 const current=await deploymentInventory(workspace,key);
 const repeated=receipt&&current?.version===2&&current.commit===receipt.commit&&current.releaseId===receipt.releaseId&&equal(current.files,prepared.files)&&equal(current.removed,prepared.removed);
 if(identity(current)!==prepared.before&&!repeated)throw new AppError('PUBLISH_STALE');
}
function validatePreparedInventory(prepared){if(!prepared||prepared.version!==1||typeof prepared.before!=='string'||!/^[a-f0-9]{64}$/.test(prepared.before)||!validSet(prepared.files)||!validSet(prepared.removed))fail();}
export async function verifyPreparedInventory(workspace,prepared,{signal,files}={}){
 validatePreparedInventory(prepared);const index=new LivePathIndex(workspace);
 if(files&&files.size!==(prepared.files.root?.count??0))fail();
 for await(const path of index.paths(prepared.files)){signal?.throwIfAborted();if(files&&!await files.has(path))fail();}
 for await(const path of index.paths(prepared.removed)){signal?.throwIfAborted();if(await index.has(prepared.files,path))fail();}
}
export async function recordDeploymentInventory(workspace,key,receipt,prepared){
 await assertDeploymentInventory(workspace,key,prepared,receipt);
 const value=validateDeploymentInventory({version:2,commit:receipt.commit,releaseId:receipt.releaseId,files:prepared.files,removed:prepared.removed});
 await workspace.writeMetadata(file(key),serialize(value));return value;
}
export async function verifyDeploymentInventories(workspace){
 for await(const name of workspace.metadataNames('.observanda/publication-live')){
  if(!/^[a-f0-9]{64}\.json$/.test(name))fail();const inventory=await deploymentInventory(workspace,name.slice(0,-5));if(!inventory)fail();
  if(inventory.version===1){const files=new Set(inventory.files);if(inventory.removed.some(path=>files.has(path)))fail();continue;}
  const index=new LivePathIndex(workspace);for await(const path of index.paths(inventory.files))void path;
  for await(const path of index.paths(inventory.removed))if(await index.has(inventory.files,path))fail();
 }
 // A stopped deployment may reference pages that have not become the current
 // inventory yet. Backup qualification includes those resumable roots too.
 for await(const name of workspace.metadataNames('.observanda/deployments')){
  if(!/^[a-f0-9-]{36}\.json$/.test(name))fail();let value;
  const raw=await workspace.readMetadata('.observanda/deployments/'+name,16*1024*1024);try{value=JSON.parse(raw);}catch{fail();}if(!value)fail();
  if(value?.journal?.liveInventory)await verifyPreparedInventory(workspace,value.journal.liveInventory);
 }
}
