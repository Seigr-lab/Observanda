import path from 'node:path';
import {createHash} from 'node:crypto';
import {seal,unseal,ENCRYPTION_OVERHEAD} from './encryption.js';
import {atomicWrite,privateDirectory,serialize} from './storage.js';
import {withNativeTree} from './native-storage-tree.js';
import {nativeFileBlocks} from './native-destination.js';
import {withWriterLease} from './writer-lease.js';
import {researchId} from './web/research-reference.js';
import {validPortableInventory} from './portable-inventory.js';
import {AppError} from './errors.js';

const limit=512*1024;
const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const empty=()=>({version:1,backup:null,verification:null,failedCheck:null,restoration:null});
function validEntry(entry){
 return entry&&researchId(entry.id)&&typeof entry.destination==='string'&&path.isAbsolute(entry.destination)&&
  path.resolve(entry.destination)===entry.destination&&(entry.completedAt===null||validDate(entry.completedAt))&&
  Number.isSafeInteger(entry.projects)&&entry.projects>=0&&(entry.inventory===null||validPortableInventory(entry.inventory));
}

// Keep the destination and the check dates on the initiating computer. A copy
// of a workspace must never inherit another installation's restore history.
export class PortableBackupHistory{
 constructor(preferencesFile,workspace){
  this.parent=path.dirname(preferencesFile);this.vault=workspace.vault;
  const location=process.platform==='win32'?workspace.root.toLowerCase():workspace.root;
  const owner=createHash('sha256').update(JSON.stringify([this.vault?.id??null,location])).digest('hex');
  this.file=path.join(this.parent,'portable-backup-status',owner+'.obs');
  this.aad='Observanda/portable-backup-status/v1/'+owner;
 }
 async read(){
  if(this.vault?.id&&!this.vault.key)throw new AppError('ACCESS_LOCKED');
  const bytes=await withNativeTree(path.dirname(this.file),async folder=>{
   const handle=await folder?.file(path.basename(this.file),{missing:true});if(!handle)return null;
   try{return Buffer.concat(await Array.fromAsync(nativeFileBlocks(handle,limit,undefined,limit)));}
   finally{await handle.close();}
  },{missing:true});
  if(!bytes)return empty();
  let value;
  try{value=JSON.parse(this.vault?.id?unseal(bytes,this.vault.key,this.aad).toString('utf8'):bytes.toString('utf8'));}
  catch{throw new AppError('PREFERENCES_FORMAT');}
  if(value?.version!==1||value.backup!==null&&!validEntry(value.backup)||value.verification!==null&&(!validEntry(value.verification)||!validDate(value.verification.verifiedAt))
   ||value.restoration!=null&&(!validEntry(value.restoration)||typeof value.restoration.source!=='string'||!path.isAbsolute(value.restoration.source)||!validDate(value.restoration.restoredAt))
   ||value.failedCheck!=null&&(!researchId(value.failedCheck.id)||!validDate(value.failedCheck.at)))throw new AppError('PREFERENCES_FORMAT');
  return value;
 }
 async update(change){
  await privateDirectory(this.parent,'portable-backup-status');
  return withWriterLease(this.file+'.lock',async()=>{
   const previous=await this.read();
   const value=change({...previous});
   const text=serialize(value);if(text===serialize(previous))return;
   const bytes=Buffer.from(text);if(bytes.length+ENCRYPTION_OVERHEAD>limit)throw new AppError('LIMIT');
   await atomicWrite(this.file,this.vault?.id?seal(bytes,this.vault.key,this.aad):bytes);
  });
 }
 async remember(destination,receipt){
  const entry={id:receipt.id,destination,completedAt:receipt.completedAt,projects:receipt.projects,inventory:receipt.inventory};
  if(!validEntry(entry)||receipt.verifiedAt!==undefined&&!validDate(receipt.verifiedAt))throw new AppError('STORAGE_COPY');
  return this.update(value=>{
   if(!value.backup||(entry.completedAt??'')>(value.backup.completedAt??''))value.backup=entry;
   if(receipt.verifiedAt&&(!value.verification||receipt.verifiedAt>value.verification.verifiedAt)){
    value.verification={...entry,verifiedAt:receipt.verifiedAt};
    if(value.failedCheck?.id===entry.id&&value.failedCheck.at<=receipt.verifiedAt)value.failedCheck=null;
   }
   return value;
  });
 }
 failed(id){return this.update(value=>{
  if(value.backup?.id===id)value.failedCheck={id,at:new Date().toISOString()};
  return value;
 });}
 restored(source,result){
  if(!validEntry(result)||!validDate(result.restoredAt)||!path.isAbsolute(source))throw new AppError('STORAGE_COPY');
  return this.update(value=>{
   if(!value.restoration||result.restoredAt>value.restoration.restoredAt)value.restoration={...result,source};
   return value;
  });
 }
}
