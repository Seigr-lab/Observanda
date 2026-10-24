import {scalarDefinitionSequences} from './measurement-scalar-storage.js';
import {scalarTextReference} from './web/measurement-scalar-policy.js';
import {lockRecordOwnerResource as lock} from './record-owner-resource-lock.js';
// Prospective allocations for selected-record transfers. These independently keyed
// authenticated rows never replace the catalogue's shared object-index root.
import {withScratch} from './scratch-work.js';
import {catalogueContext,catalogueCacheEpoch} from './catalogue-context.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import path from 'node:path';
import {lstat,open,unlink} from 'node:fs/promises';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
import {assertRecordOwnerTransferAuthority,readRecordOwnerTransfer} from './record-owner-transfer-state.js';
import {checkpointedFileName} from './checkpointed-file-copy.js';
import {withWriterLease,writerLeaseHeld} from './writer-lease.js';
import {FileContent} from './file-content.js';
import {SEGMENTED_ENVELOPE,SEGMENTED_HEADER_BYTES,readSegmentedHeader} from './segmented-file-format.js';
import {readFilePart} from './segmented-file-io.js';
const suppression=new AsyncLocalStorage(),mutation=new AsyncLocalStorage(),contexts=new WeakMap();
const PREFIX='record-owner-resource:',CLAIM='record-owner-resource-claim:',JOURNAL='record-owner-reclaim:',ACTIVE='record-owner-resources:active';
const hash=value=>digest(serialize(value)),uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value),revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.slice().sort().join();
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const addressKey=address=>hash(address),resourceKey=resource=>hash(resource),stamp=value=>value===null?null:hash(value);
const marker=id=>JOURNAL+id,entries=(id,kind)=>marker(id)+':'+kind+':',ordinal=value=>String(value).padStart(16,'0');
const safeKey=value=>typeof value==='string'&&value.length>0&&value.length<=2048&&!value.includes('\0')&&!value.startsWith('record-owner-resource')&&!value.startsWith(JOURNAL);
function validResource(value){
 if(!value||typeof value!=='object')return false;
 if(['object','state'].includes(value.kind))return exact(value,['kind','key','revision'])&&safeKey(value.key)&&revision(value.revision);
 if(value.kind==='record')return exact(value,['kind','id','revision'])&&uuid(value.id)&&revision(value.revision);
 if(value.kind==='block')return exact(value,['kind','scopeId','generation','nodeKind','revision'])&&uuid(value.scopeId)&&Number.isSafeInteger(value.generation)&&value.generation>0&&['value','index'].includes(value.nodeKind)&&revision(value.revision);
 return value.kind==='file'&&exact(value,['kind','relative','bytes','sha256'])&&integer(value.bytes)&&revision(value.sha256)&&typeof value.relative==='string'&&value.relative.length<=2048&&/^\.observanda\/(?:media|materials)\//.test(value.relative)&&!value.relative.includes('\\')&&!value.relative.split('/').some(part=>!part||part==='.'||part==='..')&&!value.relative.includes(':');
}
function validAddress(value){return exact(value,['kind','key'])&&(['object','state'].includes(value.kind)&&safeKey(value.key)||value.kind==='font'&&/^custom-[a-f0-9]{64}$/.test(value.key));}
async function get(store,slot){const row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot);return row?store.decode('state',slot,row.payload):null;}
async function put(store,slot,value){return mutation.run(store,()=>store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',slot,store.encode('state',slot,value)));}
async function remove(store,slot){return mutation.run(store,()=>store.db.run('DELETE FROM state WHERE slot=$1',slot));}
async function page(store,prefix,{reverse=false,limit=32}={}){return store.db.all('SELECT slot,payload FROM state WHERE slot COLLATE "C">=$1 AND slot COLLATE "C"<$2 ORDER BY slot COLLATE "C" '+(reverse?'DESC':'ASC')+' LIMIT '+limit,prefix,prefix+'~');}
function authority(store){try{return assertRecordOwnerTransferAuthority(store)??null;}catch(error){if(error.code!=='RECORD_TRANSFER_BUSY')throw error;return null;}}
function contextLifetime(store){
 const held=catalogueContext.getStore(),workspace=store.workspace;
 // A connection can outlive many commits. Only the exact writer scope or a
 // fixed reader's cache owns this proof; manually opened stores never cache it.
 if(held?.db===store.db&&held.root===workspace.root&&held.vault===workspace.vault&&(held.projectId??null)===(workspace.projectId??null)&&(held.labBookId??null)===(workspace.labBookId??null))return held;
 return store.readCache??null;
}
function saveContext(store,value,lifetime=contextLifetime(store),epoch=catalogueCacheEpoch(store.db)){
 const allowed=authority(store);
 if(lifetime&&epoch&&contextLifetime(store)===lifetime&&catalogueCacheEpoch(store.db)===epoch)contexts.set(lifetime,{workspace:store.workspace,authorityId:allowed?.id??null,epoch,value});return value;
}
async function context(store){
 const allowed=authority(store),lifetime=contextLifetime(store),epoch=catalogueCacheEpoch(store.db),cached=lifetime&&epoch?contexts.get(lifetime):null;
 if(cached?.workspace===store.workspace&&cached.authorityId===(allowed?.id??null)&&cached.epoch===epoch)return cached.value;
 let found;
 if(allowed){const receipt=await readRecordOwnerTransfer(store,allowed.id);if(!receipt||receipt.command.recordId!==allowed.recordId)fail();found={receipt,active:true};}
 else found={receipt:null,active:await recordOwnerResourcesPending(store)};
 if(found.receipt&&(await store.snapshot()).metadata.id!==found.receipt.targetOwner.workspaceId)found={receipt:null,active:false};
 return saveContext(store,found,lifetime,epoch);
}
export async function recordOwnerResourcesPending(store){const value=await get(store,ACTIVE);if(value!==null&&(!exact(value,['version','pending'])||value.version!==1||!Number.isSafeInteger(value.pending)||value.pending<1))fail();return value!==null;}
export async function recordOwnerResourcesTracking(store){return !suppression.getStore()&&(await context(store)).active;}
export async function recordOwnerResourceReceipt(store){return (await context(store)).receipt;}
export function recordOwnerResourcesReclaiming(){return suppression.getStore()===true;}
export function withoutRecordOwnerResourceAdoption(operation){return suppression.run(true,operation);}
export function assertRecordOwnerResourceMutation(store){if(mutation.getStore()!==store)throw new AppError('RECORD_TRANSFER_BUSY');}
function validJournal(value,id){return exact(value,['version','id','recordId','namespaceId','fingerprint','state','next','removed','retained'])&&value.version===1&&value.id===id&&uuid(value.recordId)&&uuid(value.namespaceId)&&revision(value.fingerprint)&&['staging','cleaning','complete','published','retained'].includes(value.state)&&[value.next,value.removed,value.retained].every(integer);}
async function journal(store,id){const value=await get(store,marker(id));if(value&&!validJournal(value,id))fail();return value;}
async function bound(store,receipt,{cleaning=false}={}){
 const allowed=assertRecordOwnerTransferAuthority(store);if(allowed.id!==receipt.id||allowed.recordId!==receipt.command.recordId)fail();
 const value=await journal(store,receipt.id);if(!value||value.recordId!==receipt.command.recordId||value.namespaceId!==receipt.targetOwner.workspaceId||value.fingerprint!==receipt.fingerprint)fail();
 if(cleaning?value.state!=='cleaning':value.state!=='staging')throw new AppError('RECORD_TRANSFER_BUSY');return value;
}
export async function initializeRecordOwnerReclamation(store,receipt){
 const authority=assertRecordOwnerTransferAuthority(store);if(authority.id!==receipt.id||authority.recordId!==receipt.command.recordId||(await store.snapshot()).metadata.id!==receipt.targetOwner.workspaceId)fail();
 await lock(store,'journal:'+receipt.id);let value=await journal(store,receipt.id);
 if(value){if(value.fingerprint!==receipt.fingerprint||value.recordId!==receipt.command.recordId||value.namespaceId!==receipt.targetOwner.workspaceId)fail();return summary(value);}
 value={version:1,id:receipt.id,recordId:receipt.command.recordId,namespaceId:receipt.targetOwner.workspaceId,fingerprint:receipt.fingerprint,state:'staging',next:0,removed:0,retained:0};
 await put(store,marker(receipt.id),value);await lock(store,'active');const active=await get(store,ACTIVE);if(active&&(!exact(active,['version','pending'])||active.version!==1||!Number.isSafeInteger(active.pending)||active.pending<1))fail();await put(store,ACTIVE,{version:1,pending:(active?.pending??0)+1});saveContext(store,{receipt,active:true});return summary(value);
}
function summary(value){return {version:1,id:value.id,recordId:value.recordId,namespaceId:value.namespaceId,state:value.state,removed:value.removed,retained:value.retained};}
export async function readRecordOwnerReclamation(store,id){if(!uuid(id))throw new AppError('INVALID');const value=await journal(store,id);if(!value)return null;const receipt=await readRecordOwnerTransfer(store,id);if(!receipt||receipt.fingerprint!==value.fingerprint||receipt.command.recordId!==value.recordId||receipt.targetOwner.workspaceId!==value.namespaceId||(await store.snapshot()).metadata.id!==value.namespaceId||['cleaning','complete'].includes(value.state)&&receipt.phase!=='cancelled'||['published','retained'].includes(value.state)&&receipt.phase!=='complete')fail();return summary(value);}
async function allocation(store,key){const value=await get(store,PREFIX+key);if(value&&(!exact(value,['version','resource','claims','parents','retained','state','dependencies'])||value.version!==1||!validResource(value.resource)||resourceKey(value.resource)!==key||![value.claims,value.parents].every(integer)||typeof value.retained!=='boolean'||!['ready','deleting'].includes(value.state)||!Array.isArray(value.dependencies)||value.dependencies.length>128||value.dependencies.some(v=>!revision(v))||new Set(value.dependencies).size!==value.dependencies.length))fail();return value;}
async function permanent(store,key){await lock(store,key);const value=await allocation(store,key);if(!value)return false;if(value.state!=='ready')throw new AppError('LOCKED');if(!value.retained){value.retained=true;await put(store,PREFIX+key,value);}return true;}
export async function adoptRecordOwnerResource(store,resource){
 if(suppression.getStore()||mutation.getStore()===store)return false;if(!validResource(resource))throw new AppError('INVALID');
 const current=await context(store);if(current.receipt||!current.active)return false;return permanent(store,resourceKey(resource));
}
export async function retainRecordOwnerResource(store,resource,{present,receipt=null,dependencies=[]}={}){
 if(!validResource(resource)||typeof present!=='boolean'||!Array.isArray(dependencies)||dependencies.length>128||dependencies.some(v=>!validResource(v)))throw new AppError('INVALID');
 if(suppression.getStore())return false;const current=await context(store);receipt??=current.receipt;
 if(!receipt){if(!current.active)return false;await adoptRecordOwnerResource(store,resource);for(const dependency of dependencies)await adoptRecordOwnerResource(store,dependency);return false;}
 if(current.receipt?.id!==receipt.id)throw new AppError('RECORD_TRANSFER_BUSY');
 const key=resourceKey(resource),keys=[...new Set(dependencies.map(resourceKey))].filter(v=>v!==key).sort();
 await lock(store,'journal:'+receipt.id);const header=await bound(store,receipt);
 for(const item of [...new Set([key,...keys])].sort())await lock(store,item);
 let value=await allocation(store,key);if(value?.state==='deleting')throw new AppError('LOCKED');
 // An untracked existing value predates provisional ownership and is permanent.
 if(!value&&present){for(const child of keys)await permanent(store,child);return false;}
 if(!value){const tracked=[];for(const child of keys){const dependency=await allocation(store,child);if(!dependency)continue;if(dependency.state!=='ready')throw new AppError('LOCKED');dependency.parents++;await put(store,PREFIX+child,dependency);tracked.push(child);}
  value={version:1,resource,claims:0,parents:0,retained:false,state:'ready',dependencies:tracked};await put(store,PREFIX+key,value);
 }
 const claimKey=CLAIM+key+':'+receipt.id,prior=await get(store,claimKey);if(prior){if(prior.recordId!==header.recordId||prior.resourceKey!==key||prior.transferId!==receipt.id)fail();return true;}
 const item={version:1,transferId:receipt.id,recordId:header.recordId,resourceKey:key};value.claims++;await put(store,PREFIX+key,value);await put(store,claimKey,item);
 await put(store,entries(receipt.id,'resource')+ordinal(header.next++),item);await put(store,marker(receipt.id),header);return true;
}
export async function adoptRecordOwnerMutation(store,address,value){
 if(suppression.getStore()||!validAddress(address))return false;const current=await context(store);if(current.receipt||!current.active)return false;
 const selected=await get(store,'record-owner-resource-address:'+addressKey(address)),key=selected?.chain??addressKey(address);await lock(store,'chain:'+key);const slot='record-owner-resource-chain:'+key,chain=await get(store,slot);if(!chain)return false;
 if(selected?selected.after!==stamp(value):chain.after!==stamp(value))return false;chain.retained=true;await put(store,slot,chain);return true;
}
export async function journalRecordOwnerMutation(store,receipt,address,before,after,options){return journalRecordOwnerMutations(store,receipt,[{address,before,after}],options);}
export async function journalRecordOwnerMutations(store,receipt,changes,{dependencies=[],chain=null}={}){
 if(suppression.getStore())return false;const current=await context(store);receipt??=current.receipt;if(!receipt)return false;
 if(current.receipt?.id!==receipt.id||!Array.isArray(changes)||!changes.length||changes.length>32||changes.some(v=>!validAddress(v.address)||!Object.hasOwn(v,'before')||!Object.hasOwn(v,'after'))||chain&&!validAddress(chain)||dependencies.length>128||dependencies.some(v=>!validResource(v)))throw new AppError('INVALID');
 const effective=changes.filter(v=>stamp(v.before)!==stamp(v.after));if(!effective.length)return false;
 await lock(store,'journal:'+receipt.id);const header=await bound(store,receipt),chainAddress=chain??effective.at(-1).address,chainKey=hash({address:chainAddress,transferId:receipt.id});await lock(store,'chain:'+chainKey);
 const slot='record-owner-resource-chain:'+chainKey,previous=await get(store,slot),root=effective.find(v=>v.address.kind===chainAddress.kind&&v.address.key===chainAddress.key);
 if(previous&&(!validAddress(previous.address)||hash({address:previous.address,transferId:receipt.id})!==chainKey))fail();
 await put(store,slot,{version:1,address:chainAddress,transferId:receipt.id,retained:previous?.retained??false,after:root?stamp(root.after):previous?.after??null});
 const item={version:1,transferId:receipt.id,recordId:header.recordId,chain:chainKey,changes:effective.map(v=>({address:v.address,before:v.before,after:stamp(v.after)})),dependencies};
 for(const change of item.changes){const key='record-owner-resource-address:'+addressKey(change.address);await put(store,key,{version:1,transferId:receipt.id,chain:chainKey,after:change.after});await put(store,entries(receipt.id,'proof')+hash(key),{version:1,slot:key,transferId:receipt.id});}
 await put(store,entries(receipt.id,'proof')+hash(slot),{version:1,slot,transferId:receipt.id});
 await put(store,entries(receipt.id,'mutation')+ordinal(header.next++),item);await put(store,marker(receipt.id),header);return true;
}
async function selected(store,address){if(address.kind==='object')return store.object(address.key);if(address.kind==='font'){const value=await store.object('metadata:.observanda/fonts/library.json');return value?JSON.parse(value.text).find(item=>item.id===address.key)??null:null;}return get(store,address.key);}
async function restore(store,address,value){
 if(address.kind==='font'){const key='metadata:.observanda/fonts/library.json',prior=await store.object(key),values=prior?JSON.parse(prior.text):[],next=values.filter(item=>item.id!==address.key);if(value!==null)next.push(value);await store.putObject(key,{text:JSON.stringify(next)});return;}
 if(address.kind==='object'){if(value===null)await store.deleteObject(address.key);else await store.putObject(address.key,value);}
 else if(value===null)await store.db.run('DELETE FROM state WHERE slot=$1',address.key);else await store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',address.key,store.encode('state',address.key,value));
}
async function discardValue(store,resource){
 if(resource.kind==='object'){const value=await store.object(resource.key);if(value===null)return;if(hash(value)!==resource.revision)throw new AppError('CONFLICT');await store.deleteObject(resource.key);return;}
 if(resource.kind==='state'){const value=await get(store,resource.key);if(value===null)return;if(hash(value)!==resource.revision)throw new AppError('CONFLICT');await remove(store,resource.key);return;}
 if(resource.kind==='record'){await store.db.run('DELETE FROM records WHERE id=$1 AND revision=$2',resource.id,resource.revision);return;}
 if(resource.kind==='block'){
  const {RecordBlockStore}=await import('./record-block-store.js'),key=await store.scopeKey(resource.scopeId,resource.generation);try{const blocks=new RecordBlockStore(store,resource.scopeId,resource.generation,key),slot=blocks.slot(resource.nodeKind,resource.revision),row=await get(store,slot);if(row!==null){blocks.decode(slot,row,resource.revision);await remove(store,slot);}}finally{key.fill(0);}return;
 }
 fail();
}
async function queue(store,id,key){const slot=entries(id,'pending')+key;if(!await get(store,slot))await put(store,slot,{version:1,resourceKey:key});}
async function detachDependencies(store,id,value,{retain=false}={}){
 for(const child of value.dependencies){await lock(store,child);const dependency=await allocation(store,child);if(!dependency||dependency.parents<1)fail();dependency.parents--;if(retain)dependency.retained=true;await put(store,PREFIX+child,dependency);if(!dependency.parents&&!dependency.claims)await queue(store,id,child);}
}
async function releaseResource(store,id,key){
 await lock(store,key);const value=await allocation(store,key);if(!value)return 'retained';if(value.claims||value.parents)return 'retained';
 if(value.retained){await detachDependencies(store,id,value,{retain:true});await remove(store,PREFIX+key);return 'retained';}
 if(value.resource.kind==='file'){value.state='deleting';await put(store,PREFIX+key,value);return value.resource;}
 await withoutRecordOwnerResourceAdoption(()=>discardValue(store,value.resource));await remove(store,PREFIX+key);await detachDependencies(store,id,value);return 'removed';
}
async function clearProof(store,row,id){const item=store.decode('state',row.slot,row.payload);if(item.version!==1||item.transferId!==id||typeof item.slot!=='string'||!/^record-owner-resource-(?:chain|address):[a-f0-9]{64}$/.test(item.slot)||row.slot!==entries(id,'proof')+hash(item.slot))fail();const value=await get(store,item.slot);if(value?.transferId===id)await remove(store,item.slot);await remove(store,row.slot);}
async function finishJournal(store,header,state){
 await lock(store,'active');const active=await get(store,ACTIVE);if(!active||active.version!==1||!Number.isSafeInteger(active.pending)||active.pending<1)fail();
 if(active.pending===1){await remove(store,ACTIVE);saveContext(store,{receipt:(await context(store)).receipt,active:false});}else await put(store,ACTIVE,{version:1,pending:active.pending-1});header.state=state;await put(store,marker(header.id),header);return summary(header);
}
async function discardFile(workspace,resource,{signal}={}){
 const file=workspace.metadataPath(resource.relative),relative=path.relative(workspace.root,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw new AppError('UNSAFE');
 const content={size:resource.bytes,sha256:resource.sha256},temp=checkpointedFileName(content,workspace,file),lease=workspace.projectId?path.join(workspace.root,'.observanda','project-transfer.lock'):temp+'.lock';
 const operation=async()=>{signal?.throwIfAborted();let directory=workspace.root;for(const part of path.relative(workspace.root,path.dirname(file)).split(path.sep).filter(Boolean)){directory=path.join(directory,part);const info=await lstat(directory).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(info===null)return;if(!info.isDirectory()||info.isSymbolicLink())throw new AppError('UNSAFE');}
  for(const [selected,partial] of [[temp,true],[file,false]]){signal?.throwIfAborted();const info=await lstat(selected,{bigint:true}).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(info===null)continue;if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n)throw new AppError('UNSAFE');
   const handle=await open(selected,'r');let native=false;try{const magic=await readFilePart(handle,8,0);native=magic.equals(SEGMENTED_ENVELOPE);if(native){const header=readSegmentedHeader(await readFilePart(handle,SEGMENTED_HEADER_BYTES,0),workspace.vault.key,workspace.fileAAD(file));if(header.size!==resource.bytes||header.sha256!==resource.sha256||(partial?info.size>BigInt(header.storedSize):info.size!==BigInt(header.storedSize)))fail();}else if(partial)fail();}finally{await handle.close();}
   if(!native)await new FileContent(workspace,file,resource.bytes,resource.sha256).verify({signal});
   const after=await lstat(selected,{bigint:true});if(after.dev!==info.dev||after.ino!==info.ino||after.size!==info.size||after.mtimeNs!==info.mtimeNs)throw new AppError('UNSAFE');await unlink(selected);
  }
 };return writerLeaseHeld(lease)?operation():withWriterLease(lease,operation);
}
export async function reclaimRecordOwnerResources(workspace,receipt,{signal,write,checkpoint=async()=>{}}={}){
 if(typeof write!=='function'||receipt.phase!=='cancelled')throw new AppError('INVALID');
 await write(async store=>{await lock(store,'journal:'+receipt.id);const header=await journal(store,receipt.id);if(!header||header.fingerprint!==receipt.fingerprint||header.namespaceId!==receipt.targetOwner.workspaceId||header.recordId!==receipt.command.recordId)fail();if(header.state==='staging'){header.state='cleaning';await put(store,marker(receipt.id),header);}});
 for(;;){signal?.throwIfAborted();const done=await write(async store=>{
  await lock(store,'journal:'+receipt.id);const header=await journal(store,receipt.id);if(header.state==='complete')return true;await bound(store,receipt,{cleaning:true});const rows=await page(store,entries(receipt.id,'mutation'),{reverse:true,limit:16});if(!rows.length)return true;
  for(const row of rows){const item=store.decode('state',row.slot,row.payload),chainSlot='record-owner-resource-chain:'+item.chain;await lock(store,'chain:'+item.chain);const chain=await get(store,chainSlot);if(!chain||item.transferId!==receipt.id||item.recordId!==header.recordId)fail();
  let retained=chain.retained;for(const change of item.changes)if(stamp(await selected(store,change.address))!==change.after)retained=true;
  if(retained){chain.retained=true;for(const dependency of item.dependencies)await permanent(store,resourceKey(dependency));header.retained++;}
  else{for(const change of item.changes)await withoutRecordOwnerResourceAdoption(()=>restore(store,change.address,change.before));const root=item.changes.find(v=>v.address.kind===chain.address.kind&&v.address.key===chain.address.key);if(root)chain.after=stamp(root.before);header.removed++;}
  await put(store,chainSlot,chain);await remove(store,row.slot);}
  await put(store,marker(receipt.id),header);return false;
 });if(done)break;await checkpoint('mutations');}
 for(;;){signal?.throwIfAborted();const result=await write(async store=>{
  const step=async()=>{await lock(store,'journal:'+receipt.id);const header=await journal(store,receipt.id);if(header.state==='complete')return {done:true,value:summary(header)};await bound(store,receipt,{cleaning:true});
  let rows=await page(store,entries(receipt.id,'pending'),{limit:1}),row=rows[0],key;
  if(row)key=store.decode('state',row.slot,row.payload).resourceKey;
  else{rows=await page(store,entries(receipt.id,'resource'),{reverse:true,limit:1});row=rows[0];if(!row){const proofs=await page(store,entries(receipt.id,'proof'));if(proofs.length){for(const proof of proofs)await clearProof(store,proof,receipt.id);return {done:false};}return {done:true,value:await finishJournal(store,header,'complete')};}
   const item=store.decode('state',row.slot,row.payload);key=item.resourceKey;await lock(store,key);const claim=await get(store,CLAIM+key+':'+receipt.id),value=await allocation(store,key);if(!claim||!value||value.claims<1||item.transferId!==receipt.id)fail();value.claims--;await put(store,PREFIX+key,value);await remove(store,CLAIM+key+':'+receipt.id);
  }
  const removed=await releaseResource(store,receipt.id,key);
  if(typeof removed==='object'){await queue(store,receipt.id,key);if(!row.slot.startsWith(entries(receipt.id,'pending')))await remove(store,row.slot);return {file:removed,key};}
  removed==='removed'?header.removed++:header.retained++;await remove(store,row.slot);await put(store,marker(receipt.id),header);return {done:false};};
  for(let count=0;count<16;count++){signal?.throwIfAborted();const result=await step();if(result.done||result.file)return result;}return {done:false};
 });if(result.done)return result.value;
  if(result.file){await discardFile(workspace,result.file,{signal});await write(async store=>{await lock(store,'journal:'+receipt.id);const header=await bound(store,receipt,{cleaning:true});await lock(store,result.key);const value=await allocation(store,result.key);if(!value||value.state!=='deleting'||value.parents||value.claims||value.retained||value.dependencies.length)fail();await remove(store,PREFIX+result.key);await remove(store,entries(receipt.id,'pending')+result.key);header.removed++;await put(store,marker(receipt.id),header);});}
  await checkpoint('resources');
 }
}
export async function verifyRecordOwnerResources(store,{signal}={}){
 const namespace=(await store.snapshot()).metadata.id;let pending=0,owner=null;
 for await(const row of store.db.rows('SELECT slot,payload FROM state WHERE slot COLLATE "C">=$1 AND slot COLLATE "C"<$2 ORDER BY slot COLLATE "C"',[JOURNAL,JOURNAL+'~'],{signal})){
  const match=/^record-owner-reclaim:([a-f0-9-]{36})$/.exec(row.slot);
  if(!match){
   // A header sorts immediately before its own subordinate rows. Keep only
   // that selected owner while rejecting rows whose header is absent.
   const child=/^record-owner-reclaim:([a-f0-9-]{36}):(resource|mutation|pending|proof):(.+)$/.exec(row.slot);
   if(!child||owner?.id!==child[1]||['complete','retained'].includes(owner.state))fail();continue;
  }
  owner=await readRecordOwnerReclamation(store,match[1]);if(!owner||owner.namespaceId!==namespace)fail();if(!['complete','retained'].includes(owner.state))pending++;
 }
 const active=await get(store,ACTIVE);if(pending?( !exact(active,['version','pending'])||active.version!==1||active.pending!==pending):active!==null)fail();
 if(!pending){
  // No scratch ledger is needed for an idle owner, but every bookkeeping
  // namespace must be empty; a missing journal cannot hide orphan claims.
  for(const prefix of [PREFIX,CLAIM,'record-owner-resource-chain:','record-owner-resource-address:'])if((await page(store,prefix,{limit:1})).length)fail();return;
 }
 for(const prefix of ['record-owner-resource-chain:','record-owner-resource-address:'])for await(const row of store.db.rows('SELECT slot,payload FROM state WHERE slot COLLATE "C">=$1 AND slot COLLATE "C"<$2',[prefix,prefix+'~'],{signal})){
  const value=store.decode('state',row.slot,row.payload),key=row.slot.slice(prefix.length),chain=prefix==='record-owner-resource-chain:';
  if(!revision(key)||!exact(value,chain?['version','address','transferId','retained','after']:['version','transferId','chain','after'])||value.version!==1||!uuid(value.transferId)||value.after!==null&&!revision(value.after)||
   (chain? !validAddress(value.address)||hash({address:value.address,transferId:value.transferId})!==key||typeof value.retained!=='boolean':!revision(value.chain)))fail();
  const header=await journal(store,value.transferId),proof=await get(store,entries(value.transferId,'proof')+hash(row.slot));
  if(!header||['complete','retained'].includes(header.state)||!exact(proof,['version','slot','transferId'])||proof.version!==1||proof.slot!==row.slot||proof.transferId!==value.transferId)fail();
 }
 await withScratch(async ledger=>{
  for await(const row of store.db.rows('SELECT slot,payload FROM state WHERE slot COLLATE "C">=$1 AND slot COLLATE "C"<$2 ORDER BY slot COLLATE "C"',[JOURNAL,JOURNAL+'~'],{signal})){
   const match=/^record-owner-reclaim:([a-f0-9-]{36}):(resource|mutation|pending|proof):(.+)$/.exec(row.slot);if(!match){if(!/^record-owner-reclaim:[a-f0-9-]{36}$/.test(row.slot))fail();continue;}
   const [,id,kind,suffix]=match,value=store.decode('state',row.slot,row.payload),owner=await journal(store,id);if(!owner||['complete','retained'].includes(owner.state))fail();
   if(kind==='resource'){
    if(!exact(value,['version','transferId','recordId','resourceKey'])||value.version!==1||value.transferId!==id||value.recordId!==owner.recordId||!revision(value.resourceKey)||!/^\d{16}$/.test(suffix)||Number(suffix)>=owner.next||!await ledger.add('claim:'+value.resourceKey+':'+id))fail();
    const claim=await get(store,CLAIM+value.resourceKey+':'+id);if(serialize(claim)!==serialize(value))fail();
   }else if(kind==='mutation'){
    if(!exact(value,['version','transferId','recordId','chain','changes','dependencies'])||value.version!==1||value.transferId!==id||value.recordId!==owner.recordId||!revision(value.chain)||!/^\d{16}$/.test(suffix)||Number(suffix)>=owner.next||!Array.isArray(value.changes)||!value.changes.length||value.changes.length>32||value.changes.some(v=>!exact(v,['address','before','after'])||!validAddress(v.address)||v.after!==null&&!revision(v.after))||!Array.isArray(value.dependencies)||value.dependencies.length>128||value.dependencies.some(v=>!validResource(v)))fail();
    const chain=await get(store,'record-owner-resource-chain:'+value.chain);if(!chain||chain.transferId!==id||!validAddress(chain.address)||hash({address:chain.address,transferId:id})!==value.chain||typeof chain.retained!=='boolean'||chain.after!==null&&!revision(chain.after))fail();
   }else if(kind==='pending'){
    if(!exact(value,['version','resourceKey'])||value.version!==1||value.resourceKey!==suffix||!revision(suffix)||!await allocation(store,suffix))fail();await ledger.add('pending:'+suffix);
   }else if(!exact(value,['version','slot','transferId'])||value.version!==1||value.transferId!==id||typeof value.slot!=='string'||!/^record-owner-resource-(?:chain|address):[a-f0-9]{64}$/.test(value.slot)||hash(value.slot)!==suffix)fail();
  }
  for await(const row of store.db.rows('SELECT slot,payload FROM state WHERE slot COLLATE "C">=$1 AND slot COLLATE "C"<$2 ORDER BY slot COLLATE "C"',[PREFIX,PREFIX+'~'],{signal})){
   const key=row.slot.slice(PREFIX.length);if(!revision(key))fail();const value=await allocation(store,key);let claims=0;
   for await(const claimRow of store.db.rows('SELECT slot,payload FROM state WHERE slot COLLATE "C">=$1 AND slot COLLATE "C"<$2',[CLAIM+key+':',CLAIM+key+':~'],{signal})){
    const claim=store.decode('state',claimRow.slot,claimRow.payload);if(!exact(claim,['version','transferId','recordId','resourceKey'])||claim.version!==1||claim.resourceKey!==key||claimRow.slot!==CLAIM+key+':'+claim.transferId||!await ledger.has('claim:'+key+':'+claim.transferId))fail();claims++;
   }
   if(claims!==value.claims||value.state==='deleting'&&(value.claims||value.parents||value.retained||value.resource.kind!=='file'||!await ledger.has('pending:'+key)))fail();
   for(const child of value.dependencies){if(!await allocation(store,child))fail();await ledger.put('parents:'+child,(await ledger.get('parents:'+child)??0)+1);}
  }
  for await(const row of store.db.rows('SELECT slot,payload FROM state WHERE slot COLLATE "C">=$1 AND slot COLLATE "C"<$2',[PREFIX,PREFIX+'~'],{signal})){const key=row.slot.slice(PREFIX.length),value=await allocation(store,key);if(value.parents!==(await ledger.get('parents:'+key)??0))fail();}
  // An orphan claim may not be concealed by deleting its resource registry.
  for await(const row of store.db.rows('SELECT slot,payload FROM state WHERE slot COLLATE "C">=$1 AND slot COLLATE "C"<$2',[CLAIM,CLAIM+'~'],{signal})){const value=store.decode('state',row.slot,row.payload);if(!await allocation(store,value.resourceKey)||!await ledger.has('claim:'+value.resourceKey+':'+value.transferId))fail();}
 },{signal});
}

export async function journalRecordOwnerObject(store,key,before,after){
 if(suppression.getStore()||mutation.getStore()===store||!safeKey(key)||key==='metadata:.observanda/fonts/library.json')return false;
 const current=await context(store),address={kind:'object',key};
 if(!current.receipt){if(current.active&&before!==null)await adoptRecordOwnerMutation(store,address,before);return false;}
 if(stamp(before)===stamp(after))return false;
 const selected=await get(store,'record-owner-resource-address:'+addressKey(address));if(selected?.transferId===current.receipt.id&&selected.after===stamp(after))return false;
 if(before===null&&after!==null&&await allocation(store,resourceKey({kind:'object',key,revision:hash(after)})))return false;
 return journalRecordOwnerMutation(store,current.receipt,address,before,after);
}
export async function commitRecordOwnerResources(store,receipt){
 await lock(store,'journal:'+receipt.id);const value=await journal(store,receipt.id);if(!value||value.fingerprint!==receipt.fingerprint||value.recordId!==receipt.command.recordId||value.namespaceId!==receipt.targetOwner.workspaceId)fail();
 const authority=assertRecordOwnerTransferAuthority(store);if(authority.id!==receipt.id)fail();if(['published','retained'].includes(value.state))return summary(value);if(value.state!=='staging')throw new AppError('RECORD_TRANSFER_BUSY');value.state='published';await put(store,marker(receipt.id),value);return summary(value);
}
export async function compactRecordOwnerResources(workspace,receipt,{signal,write,checkpoint=async()=>{}}={}){
 if(receipt.phase!=='complete'||typeof write!=='function')throw new AppError('INVALID');
 for(;;){signal?.throwIfAborted();const result=await write(async store=>{await lock(store,'journal:'+receipt.id);const value=await journal(store,receipt.id);if(!value||value.fingerprint!==receipt.fingerprint||!['published','retained'].includes(value.state))fail();if(value.state==='retained')return summary(value);
  // Bound each commit to 128 journal entries so remote owners do not repeat
  // connection and filesystem admission for every small group of resources.
  // Parent edges are detached before their children. A still-provisional
  // claimant retains the dependency receipt until its own bounded completion.
  const pending=await page(store,entries(receipt.id,'pending'),{limit:128});if(pending.length){for(const row of pending){const key=store.decode('state',row.slot,row.payload).resourceKey;await permanent(store,key);await releaseResource(store,receipt.id,key);await remove(store,row.slot);}return null;}
  const rows=await page(store,marker(receipt.id)+':',{reverse:true,limit:128});if(!rows.length)return finishJournal(store,value,'retained');
  for(const row of rows){const item=store.decode('state',row.slot,row.payload);
   if(row.slot.startsWith(entries(receipt.id,'resource'))){await lock(store,item.resourceKey);const resource=await allocation(store,item.resourceKey),claim=CLAIM+item.resourceKey+':'+receipt.id;if(!resource||resource.claims<1||!await get(store,claim))fail();resource.retained=true;resource.claims--;await put(store,PREFIX+item.resourceKey,resource);await remove(store,claim);await releaseResource(store,receipt.id,item.resourceKey);await remove(store,row.slot);}
   else if(row.slot.startsWith(entries(receipt.id,'proof')))await clearProof(store,row,receipt.id);
   else if(row.slot.startsWith(entries(receipt.id,'mutation')))await remove(store,row.slot);else fail();
  }return null;
 });if(result)return result;await checkpoint('compact');}
}
// Admission only in the existing ordinary writer; merely viewing a resource
// cannot convert a provisional copy into permanent retained data.
export async function withRecordOwnerResourceWriter(workspace,operation){
 if(suppression.getStore())return null;const {catalogueContext}=await import('./research-catalogue.js');if(!catalogueContext.getStore())return null;
 return workspace.catalogue(async store=>{const current=await context(store);return current.active&&!current.receipt?operation(store):null;});
}
export async function retainRecordOwnerMetadata(workspace,relative,text,{dependencies=[]}={}){
 const {catalogueContext}=await import('./research-catalogue.js');if(!catalogueContext.getStore())return false;
 return workspace.catalogue(async store=>{const current=await context(store);if(!current.active)return false;const key='metadata:'+relative,prior=await store.object(key),value={text},refs=[];
  for(const name of dependencies){const child=await store.object('metadata:'+name);if(child)refs.push({kind:'object',key:'metadata:'+name,revision:hash(child)});}
  return retainRecordOwnerResource(store,{kind:'object',key,revision:hash(value)},{present:prior!==null,dependencies:refs});
 });
}

export async function recordOwnerMetadataDependencies(store,relative,text){
 const refs=[],value=JSON.parse(text),object=async name=>{const key='metadata:'+name,child=await store.object(key);if(child)refs.push({kind:'object',key,revision:hash(child)});},file=(name,bytes,sha256)=>{const resource={kind:'file',relative:name,bytes,sha256};if(validResource(resource))refs.push(resource);};
 if(relative.startsWith('.observanda/materials/figures/')){
  const {retainedFigureBlockChildren,retainedFigureBlockPath}=await import('./retained-figure-blocks.js'),kind=relative.split('/').at(-2);for(const child of retainedFigureBlockChildren(kind,value))await object(retainedFigureBlockPath(child.kind,child.revision));
 }else if(relative.startsWith('.observanda/materials/sequences/nodes/')){
  if(value.left)await object('.observanda/materials/sequences/nodes/'+value.left.hash+'.json');if(value.right)await object('.observanda/materials/sequences/nodes/'+value.right.hash+'.json');await object('.observanda/materials/sequences/chunks/'+value.revision+'.json');
 }else if(relative.startsWith('.observanda/materials/sequences/chunks/')&&Array.isArray(value.items)){
  if(['columns','columns-policy','calculation-nodes'].includes(value.kind))for(const item of value.items)for(const descriptor of scalarDefinitionSequences(item))if(descriptor.root)await object('.observanda/materials/sequences/nodes/'+descriptor.root.hash+'.json');
  if(value.kind==='domain-components')for(const item of value.items)if(scalarTextReference(item.spelling)&&item.spelling.parts.root)await object('.observanda/materials/sequences/nodes/'+item.spelling.parts.root.hash+'.json');
  for(const item of value.items){for(const descriptor of [item.lineage?.leaves,item.sourcesIndex,item.match?.keysIndex,item.location?.cellsIndex,item.value?.components,item.value?.original?.parts])if(descriptor?.root)await object('.observanda/materials/sequences/nodes/'+descriptor.root.hash+'.json');if(value.kind==='files'&&item.kind==='original')file(item.name,item.bytes,item.sha256);else if(value.kind==='files'&&item.kind==='metadata')await object(item.name);else if(value.kind==='pages'&&revision(item.hash))await object('.observanda/materials/tables/'+item.hash+'.json');else if(value.kind==='cells'&&item.value?.parts?.root)await object('.observanda/materials/sequences/nodes/'+item.value.parts.root.hash+'.json');}
 }else if(relative.startsWith('.observanda/materials/tables/')&&Array.isArray(value)){
  for(const row of value){if(row.cellIndex?.root)await object('.observanda/materials/sequences/nodes/'+row.cellIndex.root.hash+'.json');if(row.calculationLineage?.bindingsIndex?.root)await object('.observanda/materials/sequences/nodes/'+row.calculationLineage.bindingsIndex.root.hash+'.json');}
 }else if(relative.startsWith('.observanda/materials/objects/')&&(value.content?.datasetFormat===3||value.content?.tool==='Observanda calculation graph'||value.content?.figure?.kind==='retained'||value.content?.measurement||value.content?.tool==='Observanda clock synchronization')){
  for(const slot of ['schemaIndex','pageIndex','schemaInputsIndex','inputsIndex','outputsIndex','aggregationMembersIndex','plotPointsIndex','plotMembersIndex','graphBindingsIndex','graphNodesIndex','graphOutputsIndex'])if(value.content[slot]?.root)await object('.observanda/materials/sequences/nodes/'+value.content[slot].root.hash+'.json');
  if(value.content.tool==='Observanda clock synchronization')for(const descriptor of scalarDefinitionSequences(value.content))if(descriptor.root)await object('.observanda/materials/sequences/nodes/'+descriptor.root.hash+'.json');
  if(value.content.measurement)for(const descriptor of scalarDefinitionSequences(value.content.measurement))if(descriptor.root)await object('.observanda/materials/sequences/nodes/'+descriptor.root.hash+'.json');
  if(value.content.figure?.kind==='retained')for(const part of ['data','presentation'])for(const slot of ['root','index'])await object('.observanda/materials/figures/value/'+value.content.figure.document[part][slot]+'.json');
 }else if(relative.startsWith('.observanda/media-assets/')){
  const base='.observanda/media/'+value.id+'/';file(base+(value.kind==='file'?(value.storageId?value.storageId+'.original':'original'):(value.storageId?value.storageId+'.':'')+'public.'+value.extension),value.bytes,value.sha256);
  file(base+(value.storageId?value.storageId+'.original':'original'),value.originalBytes,value.originalSha256);if(value.storageId)await object('.observanda/media-imports/'+value.id+'.json');
 }else if(relative.startsWith('.observanda/media-imports/')&&value.source)file('.observanda/media/'+value.id+'/'+value.source.storageId+'.original',value.source.size,value.source.sha256);
 else if(relative.startsWith('.observanda/materials/records/')&&value.format==='observanda-retained-record')refs.push({kind:'record',id:value.id,revision:value.storageRevision});
 return refs;
}
export async function adoptRecordOwnerMedia(workspace,id,metadata){
 return withRecordOwnerResourceWriter(workspace,async store=>{
  const key='metadata:.observanda/media-assets/'+id+'.json',value=await store.object(key);
  if(value){await adoptRecordOwnerResource(store,{kind:'object',key,revision:hash(value)});for(const resource of await recordOwnerMetadataDependencies(store,'.observanda/media-assets/'+id+'.json',value.text))await adoptRecordOwnerResource(store,resource);return;}
  const base='.observanda/media/'+id+'/',display={kind:'file',relative:base+(metadata.kind==='file'?'original':'public.'+metadata.extension),bytes:metadata.bytes,sha256:metadata.sha256},original={kind:'file',relative:base+'original',bytes:metadata.originalBytes,sha256:metadata.originalSha256};
  for(const resource of [display,original])await adoptRecordOwnerResource(store,resource);
  // Legacy metadata is itself an encrypted original. Its bounded plaintext
  // is authenticated before deriving its exact file ownership identity.
  const raw=await workspace.readFile(workspace.metadataPath(base+'asset.json'));await adoptRecordOwnerResource(store,{kind:'file',relative:base+'asset.json',bytes:raw.length,sha256:digest(raw)});
 });
}
export async function adoptRecordOwnerFont(workspace,id,entry,text){return withRecordOwnerResourceWriter(workspace,async store=>{await adoptRecordOwnerResource(store,{kind:'object',key:'metadata:.observanda/fonts/'+id+'.json',revision:hash({text})});await adoptRecordOwnerMutation(store,{kind:'font',key:id},entry);});}
