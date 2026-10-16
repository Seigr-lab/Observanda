// Discard only a command-owned, unpublished destination. The normal deletion
// engine supplies durable fencing, stopped databases and retired-path recovery.
import path from 'node:path';
import {readFile,readdir,realpath} from 'node:fs/promises';
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
import {AppError} from './errors.js';
const hash=async file=>await assertRegular(file,{missing:true})?digest(await readFile(file)):digest('absent');
const identity=stat=>({dev:String(stat.dev),ino:String(stat.ino)});
export class ImportDiscard extends OwnedStorageDeletions{
 constructor(owner,id){if(!researchId(id))throw new AppError('INVALID');super(path.join(owner.root,'.observanda/import-discard',id));this.owner=owner;this.id=id;this.receiptLimit=16*1024*1024;}
 file(id){if(id!==this.id)throw new AppError('INVALID');return path.join(this.owner.root,'.observanda/import-discard',id+'.obsv');}
 text(file){return this.owner.readFile(file,'utf8');}
 async save(value){await privateDirectory(this.owner.root,'.observanda/import-discard');if(value.phase==='complete')value={...value,owners:value.owners.map(({key,...entry})=>entry)};await this.owner.writeFile(this.file(value.id),serialize(value));}
 validBinding(value){return value===null||!!value&&['project','lab-book'].includes(value.placement)&&researchId(value[value.placement==='project'?'projectId':'labBookId']);}
 validReceipt(value){
  if(value.id!==this.id||!value.identity||Object.keys(value.identity).sort().join()!=='dev,ino'||Object.values(value.identity).some(part=>typeof part!=='string')||!Array.isArray(value.owners)||!value.owners.length||value.owners.length>8192||value.owners[0].relative!=='')return false;
  const paths=new Set();return value.owners.every(entry=>{
   if(!['project','lab-book'].includes(entry.kind)||!researchId(entry.projectId)||!researchId(entry.vaultId)||entry.kind==='lab-book'&&!researchId(entry.labBookId)||typeof entry.relative!=='string'||entry.relative.includes('\\')||paths.has(entry.relative))return false;
   try{if(entry.relative)entry.relative.split('/').forEach(part=>validateStorageName(part));}catch{return false;}paths.add(entry.relative);
   return value.phase==='complete'||typeof entry.key==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(entry.key);
  });
 }
 async needsKeys(){const receipt=await this.pending();return !receipt||receipt.phase==='prepared'&&!await workspaceDeletion(receipt.source);}
 async pending(){return await assertRegular(this.file(this.id),{missing:true})?this.read(this.id):null;}
 binding(root){return catalogueBinding(root);}
 async frozen(value){
  const retired=path.join(path.dirname(value.source),'.observanda-delete-'+value.id),root=await assertRegular(retired,{directory:true,missing:true})?retired:value.source;
  const stat=await assertRegular(root,{directory:true});if(await realpath(root)!==root||serialize(identity(stat))!==serialize(value.identity))throw new AppError('STORAGE_DELETE_STATE');
 }
 async ownedDirectory(root,value){
  await this.frozen({...value,source:root});
  for(const entry of value.owners){const folder=path.join(root,...entry.relative.split('/'));if(!await assertRegular(folder,{directory:true,missing:true}))continue;const children=value.owners.filter(item=>item.relative!==entry.relative&&path.posix.dirname(item.relative)===(entry.relative||'.')).map(item=>path.posix.basename(item.relative)),descriptor=path.basename(await workspaceFile(folder));
   for(const name of await readdir(folder))if(!['.observanda',descriptor,...children].includes(name))throw new AppError('STORAGE_DELETE_CONTENTS');
  }return value.descriptor;
 }
 async prepare(value,keys,{check=async()=>{},checkpoint=async()=>{}}={}){
  if(value.source===value.destination||!value.destinationIdentity)throw new AppError('INVALID');
  for(const entry of value.owners)if(keys.get(entry.relative)?.id!==entry.vaultId)throw new AppError('ACCESS_DENIED');
  const root=value.destination,descriptor=path.basename(await workspaceFile(root)),record={version:1,id:this.id,source:root,title:'',phase:'prepared',databaseRemoved:false,identity:value.destinationIdentity,descriptor,descriptorHash:await hash(path.join(root,descriptor)),accessHash:await hash(path.join(root,'.observanda/access.json')),binding:await catalogueBinding(root),owners:value.owners.map(entry=>({kind:entry.kind,relative:entry.relative,projectId:entry.projectId,...(entry.labBookId?{labBookId:entry.labBookId}:{}),vaultId:entry.vaultId,key:keys.get(entry.relative).key.toString('base64')}))};
  await this.ownedDirectory(root,record);await check();await privateDirectory(root,'.observanda');await this.save(record);await checkpoint('cancel-prepared');
  await atomicWrite(path.join(root,DELETE_MARKER),serialize({version:1,id:this.id,source:root}));record.phase='frozen';await this.save(record);await checkpoint('cancel-frozen');return record;
 }
 async stopDatabase(root,value,_vault,id,{checkpoint=async()=>{}}={}){
  const provider=databaseProvider();if(!provider)throw new AppError('DATABASE_LOCATION');
  await deletionScope(id,async()=>{for(const entry of [...value.owners].reverse()){
   const folder=path.join(root,...entry.relative.split('/'));if(!await assertRegular(path.join(folder,'.observanda/postgresql'),{directory:true,missing:true}))continue;
   const marker={version:1,id,source:folder},prior=await workspaceDeletion(folder);if(prior&&serialize(prior)!==serialize(marker))throw new AppError('STORAGE_DELETE_STATE');if(!prior)await atomicWrite(path.join(folder,DELETE_MARKER),serialize(marker));
   const database=path.join(folder,'.observanda/postgresql');
   if(!await assertRegular(path.join(database,'service.observanda'),{missing:true})){
    const lease=await workspaceDatabaseLease(database);try{if((await readdir(database)).some(name=>name!=='owner.lock'))throw new AppError('DATABASE_RUNTIME');}finally{await lease.close();}continue;
   }
   const vault={id:entry.vaultId,key:Buffer.from(entry.key,'base64')};
   try{const access=await readAccess(folder);authenticateKeyring(access.value,vault);
    if(entry.kind==='project')await provider.stopProjectForDeletion(folder,entry.projectId,vault,id);else await provider.stopLabBookForDeletion(folder,entry.labBookId,vault,id);
    const lease=await workspaceDatabaseLease(path.join(folder,'.observanda/postgresql'));try{await (entry.kind==='project'?assertProjectDatabaseStopped:assertLabBookDatabaseStopped)(folder,entry.kind==='project'?entry.projectId:entry.labBookId,vault);}finally{await lease.close();}
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
