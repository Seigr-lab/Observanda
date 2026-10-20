// Discard only a command-owned, unpublished destination. The normal deletion
// engine supplies durable fencing, stopped databases and retired-path recovery.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile,readdir,opendir,realpath} from 'node:fs/promises';
import {OwnedStorageDeletions} from './owned-storage-deletion.js';
import {workspaceFile,assertRegular,atomicWrite,privateDirectory,serialize,digest} from './storage.js';
import {catalogueBinding} from './postgres-activation.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {clearVault} from './encryption.js';
import {databaseProvider} from './workspace-database-context.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {assertProjectDatabaseStopped} from './project-postgres.js';
import {assertLabBookDatabaseStopped} from './lab-book-postgres.js';
import {DELETE_MARKER,workspaceDeletion,deletionScope} from './workspace-delete-state.js';
import {validateStorageName} from './storage-names.js';
import {researchId} from './web/research-reference.js';
import {projectImportOwners} from './project-import-state.js';
import {NativePortabilityCollection,createPortabilityCollection,portabilityCollection,validPortabilityCollection,releasePortabilityCollection} from './portability-collection.js';
import {AppError} from './errors.js';
const hash=async file=>await assertRegular(file,{missing:true})?digest(await readFile(file)):digest('absent');
const identity=stat=>({dev:String(stat.dev),ino:String(stat.ino)});
const native=value=>!Array.isArray(value.owners);
const ownerFields=entry=>({kind:entry.kind,relative:entry.relative,projectId:entry.projectId,...(entry.labBookId?{labBookId:entry.labBookId}:{}),vaultId:entry.vaultId});
const sameOwner=(left,right)=>['kind','relative','projectId','labBookId','vaultId'].every(key=>left?.[key]===right?.[key]);
const validKey=key=>typeof key==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(key);
const validOwner=entry=>{
 if(!entry||!['project','lab-book'].includes(entry.kind)||!researchId(entry.projectId)||!researchId(entry.vaultId)||entry.kind==='lab-book'&&!researchId(entry.labBookId)||typeof entry.relative!=='string'||entry.relative.includes('\\'))return false;
 try{if(entry.relative)entry.relative.split('/').forEach(part=>validateStorageName(part));}catch{return false;}return true;
};
export class ImportDiscard extends OwnedStorageDeletions{
 constructor(owner,id){if(!researchId(id))throw new AppError('INVALID');super(path.join(owner.root,'.observanda/import-discard',id));this.owner=owner;this.id=id;this.receiptLimit=16*1024*1024;}
 file(id){if(id!==this.id)throw new AppError('INVALID');return path.join(this.owner.root,'.observanda/import-discard',id+'.obsv');}
 text(file){return this.owner.readFile(file,'utf8');}
 owners(value){return projectImportOwners({workspace:this.owner},value);}
 async save(value){
  await privateDirectory(this.owner.root,'.observanda/import-discard');
  if(value.phase==='complete'){
   if(!native(value))value={...value,owners:value.owners.map(({key,...entry})=>entry)};
   else if(value.keyOwners){
    // Persist completion before removing keys; a restart repeats this cleanup
    // without needing the destination or dereferencing the discarded key root.
    await this.owner.writeFile(this.file(value.id),serialize(value));
    await releasePortabilityCollection(this.owner,value.keyOwners);delete value.keyOwners;
   }
  }
  await this.owner.writeFile(this.file(value.id),serialize(value));
 }
 validBinding(value){return value===null||!!value&&['project','lab-book'].includes(value.placement)&&researchId(value[value.placement==='project'?'projectId':'labBookId']);}
 validReceipt(value){
  if(value.preparing!==undefined&&(value.preparing!==true||value.phase!=='prepared'||!native(value)||value.owners?.count!==0||value.keyOwners?.count!==0))return false;
  if(value.discarding!==undefined&&(value.discarding!==true||value.phase!=='prepared'))return false;
  if(value.id!==this.id||!value.identity||Object.keys(value.identity).sort().join()!=='dev,ino'||Object.values(value.identity).some(part=>typeof part!=='string'))return false;
  if(native(value))return validPortabilityCollection(value.owners)&&(value.owners.count>0||value.preparing===true)&&(value.phase==='complete'&&!value.keyOwners||validPortabilityCollection(value.keyOwners)&&value.keyOwners.count===value.owners.count&&value.keyOwners.id!==value.owners.id);
  if(!value.owners.length||value.owners.length>8192||value.owners[0].relative!=='')return false;
  const paths=new Set();return value.owners.every(entry=>{if(!validOwner(entry)||paths.has(entry.relative))return false;paths.add(entry.relative);return value.phase==='complete'||validKey(entry.key);});
 }
 async read(id){
  const value=await super.read(id);if(!native(value)||value.discarding||value.preparing)return value;
  const owners=this.owners(value),root=await owners.get('');if(!validOwner(root))throw new AppError('STORAGE_DELETE_STATE');
  const keys=value.phase==='complete'?null:portabilityCollection(this.owner,value.keyOwners).entries()[Symbol.asyncIterator]();let count=0;
  try{for await(const entry of owners.entries()){
   if(!validOwner(entry)||typeof entry.stopped!=='boolean'||count++===0&&entry.relative!=='')throw new AppError('STORAGE_DELETE_STATE');
   if(keys){const next=await keys.next(),key=next.value;if(next.done||!sameOwner(entry,key)||!validKey(key.key))throw new AppError('STORAGE_DELETE_STATE');}
  }
  if(count!==owners.count||keys&&!(await keys.next()).done)throw new AppError('STORAGE_DELETE_STATE');
  }finally{await keys?.return?.();}
  if(value.phase==='complete'&&value.keyOwners)await this.save(value);return value;
 }
 async needsKeys(){const receipt=await this.pending();return !receipt||receipt.phase==='prepared'&&!await workspaceDeletion(receipt.source);}
 async pending(){return await assertRegular(this.file(this.id),{missing:true})?this.read(this.id):null;}
 binding(root){return catalogueBinding(root);}
 async frozen(value){
  const retired=path.join(path.dirname(value.source),'.observanda-delete-'+value.id),root=await assertRegular(retired,{directory:true,missing:true})?retired:value.source;
  const stat=await assertRegular(root,{directory:true});if(await realpath(root)!==root||serialize(identity(stat))!==serialize(value.identity))throw new AppError('STORAGE_DELETE_STATE');
 }
 async ownedDirectory(root,value){
  await this.frozen({...value,source:root});const owners=this.owners(value);
  for await(const entry of owners.entries()){
   if(!validOwner(entry))throw new AppError('STORAGE_DELETE_STATE');
   const folder=path.join(root,...entry.relative.split('/'));if(!await assertRegular(folder,{directory:true,missing:true}))continue;
   const descriptor=path.basename(await workspaceFile(folder));
   for await(const child of await opendir(folder)){
    if(child.name==='.observanda'||child.name===descriptor)continue;
    const relative=entry.relative?entry.relative+'/'+child.name:child.name,owned=await owners.get(relative);
    if(!owned||owned.relative!==relative)throw new AppError('STORAGE_DELETE_CONTENTS');
   }
  }return value.descriptor;
 }
 async prepare(value,keys,{check=async()=>{},checkpoint=async()=>{}}={}){
  if(value.source===value.destination||!value.destinationIdentity)throw new AppError('INVALID');
  const incoming=this.owners(value),root=value.destination,descriptor=path.basename(await workspaceFile(root));
  if(!incoming.count||!validOwner(await incoming.get('')))throw new AppError('STORAGE_DELETE_STATE');
  // Validate the destination before retaining any credentials. Key lookup can
  // be lazy, so even very large imports need only one unlocked owner at a time.
  await this.ownedDirectory(root,{...value,source:root,identity:value.destinationIdentity,descriptor});await check();
  // The small authenticated journal owns both namespaces before any native
  // block can retain credentials. Empty roots suffice for idempotent cleanup
  // if a collection commit or its acknowledgement is interrupted.
  const record={version:1,id:this.id,source:root,title:'',phase:'prepared',preparing:true,databaseRemoved:false,identity:value.destinationIdentity,descriptor,descriptorHash:await hash(path.join(root,descriptor)),accessHash:await hash(path.join(root,'.observanda/access.json')),binding:await catalogueBinding(root),owners:new NativePortabilityCollection(null,randomUUID()).empty(),keyOwners:new NativePortabilityCollection(null,randomUUID()).empty()};
  await this.save(record);await checkpoint('cancel-journalled',record);
  const metadata=async function*(){let count=0;for await(const entry of incoming.entries()){if(!validOwner(entry)||count++===0&&entry.relative!=='')throw new AppError('STORAGE_DELETE_STATE');yield {...ownerFields(entry),stopped:false};}};
  const owners=await createPortabilityCollection(this.owner,metadata(),{id:record.owners.id});await checkpoint('cancel-owners-prepared',record);
  const credentials=async function*(){for await(const entry of incoming.entries()){const vault=await keys.get(entry.relative);if(vault?.id!==entry.vaultId||!Buffer.isBuffer(vault.key)||vault.key.length!==32)throw new AppError('ACCESS_DENIED');yield {...ownerFields(entry),key:vault.key.toString('base64')};}};
  const keyOwners=await createPortabilityCollection(this.owner,credentials(),{id:record.keyOwners.id});await checkpoint('cancel-keys-prepared',record);
  record.owners=owners;record.keyOwners=keyOwners;delete record.preparing;
  await this.ownedDirectory(root,record);await check();
  if(await hash(path.join(root,descriptor))!==record.descriptorHash||await hash(path.join(root,'.observanda/access.json'))!==record.accessHash||serialize(await catalogueBinding(root))!==serialize(record.binding))throw new AppError('CONFLICT');
  await privateDirectory(root,'.observanda');await this.save(record);await checkpoint('cancel-prepared',record);
  await atomicWrite(path.join(root,DELETE_MARKER),serialize({version:1,id:this.id,source:root}));record.phase='frozen';await this.save(record);await checkpoint('cancel-frozen');return record;
 }
 async discard(id){
  const value=await this.read(id);if(value.phase!=='prepared'||await workspaceDeletion(value.source))throw new AppError('STORAGE_DELETE_STATE');
  if(native(value)){value.discarding=true;await this.save(value);if(value.keyOwners)await releasePortabilityCollection(this.owner,value.keyOwners);await releasePortabilityCollection(this.owner,value.owners);}
  await super.discard(id);
 }
 async stopDatabase(root,value,_vault,id,{checkpoint=async()=>{}}={}){
  const provider=databaseProvider();if(!provider)throw new AppError('DATABASE_LOCATION');const owners=this.owners(value),keys=native(value)?portabilityCollection(this.owner,value.keyOwners):null;
  await deletionScope(id,async()=>{for await(const entry of owners.entries({reverse:true})){
   const folder=path.join(root,...entry.relative.split('/'));if(!await assertRegular(path.join(folder,'.observanda/postgresql'),{directory:true,missing:true}))continue;
   const marker={version:1,id,source:folder},prior=await workspaceDeletion(folder);if(prior&&serialize(prior)!==serialize(marker))throw new AppError('STORAGE_DELETE_STATE');if(!prior)await atomicWrite(path.join(folder,DELETE_MARKER),serialize(marker));
   const database=path.join(folder,'.observanda/postgresql');
   if(!await assertRegular(path.join(database,'service.observanda'),{missing:true})){
    const lease=await workspaceDatabaseLease(database);try{if((await readdir(database)).some(name=>name!=='owner.lock'))throw new AppError('DATABASE_RUNTIME');}finally{await lease.close();}continue;
   }
   const retained=keys?await keys.get(entry.relative):entry;if(!sameOwner(entry,retained)||!validKey(retained.key))throw new AppError('STORAGE_DELETE_STATE');const vault={id:entry.vaultId,key:Buffer.from(retained.key,'base64')};
   try{const access=await readAccess(folder);authenticateKeyring(access.value,vault);
    if(!entry.stopped){if(entry.kind==='project')await provider.stopProjectForDeletion(folder,entry.projectId,vault,id);else await provider.stopLabBookForDeletion(folder,entry.labBookId,vault,id);}
    const lease=await workspaceDatabaseLease(database);try{await (entry.kind==='project'?assertProjectDatabaseStopped:assertLabBookDatabaseStopped)(folder,entry.kind==='project'?entry.projectId:entry.labBookId,vault);}finally{await lease.close();}
    if(native(value)&&!entry.stopped){await owners.update(entry.relative,{stopped:true});await this.save(value);}
    await checkpoint('cancel-owner-stopped',entry.relative);
   }finally{clearVault(vault);}
  }});
 }
 async run(value,keys,options={}){
  let receipt=await this.pending();
  if(receipt?.phase==='prepared'&&!await workspaceDeletion(receipt.source)){await this.discard(this.id);receipt=null;}
  if(!receipt)receipt=await this.prepare(value,keys,options);
  return deletionScope(this.id,()=>this.finish(this.id,{checkpoint:async(stage,...args)=>options.checkpoint?.('cancel-'+stage,...args),onProgress:options.onProgress}));
 }
}
