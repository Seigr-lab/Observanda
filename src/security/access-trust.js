import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,chmod} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createPersistentDirectory as mkdir} from '../filesystem-persistence.js';
import {assertRegular,atomicWrite,serialize} from '../storage.js';
import {withWriterLease} from '../writer-lease.js';
import {validateKeyring,authenticateKeyring} from './keyring.js';
import {AppError} from '../errors.js';

const execute=promisify(execFile),uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
export const keyringFingerprint=value=>createHash('sha256').update(canonical(value)).digest('hex');

// The trust authority lives outside workspace/backup storage. It retains the
// current wrapped grants, never plaintext passwords or vault keys. Old known
// snapshots resolve to the current grants; unknown forks fail closed. A vault
// key alone cannot forge this history by recomputing the workspace's HMAC.
export class AccessTrustStore{
 constructor(directory){this.directory=path.resolve(directory);this.preparing=null;}
 assertExternal(root){
  if(!root)return;const relative=path.relative(path.resolve(root),this.directory);
  if(!relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw new AppError('UNSAFE');
 }
 async prepare(){
  if(this.preparing)return this.preparing;
  const pending=(async()=>{
   await mkdir(this.directory,{recursive:true,mode:0o700});const info=await assertRegular(this.directory,{directory:true});
   if(process.platform==='win32'){
    try{await execute(path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./private-directory.ps1',import.meta.url)),'-Directory',this.directory],{windowsHide:true,timeout:15000,maxBuffer:8192});}catch{throw new AppError('DEVICE_UNAVAILABLE');}
   }else{if(info.uid!==process.getuid())throw new AppError('UNSAFE');await chmod(this.directory,0o700);}
  })();this.preparing=pending;
  try{await pending;}catch(error){if(this.preparing===pending)this.preparing=null;throw error;}
 }
 folder(id){if(!uuid(id))throw new AppError('ACCESS_FORMAT');return path.join(this.directory,id);}
 async current(id){
  const folder=this.folder(id);if(!await assertRegular(this.directory,{directory:true,missing:true}))return null;
  await this.prepare();if(!await assertRegular(folder,{directory:true,missing:true}))return null;
  const file=path.join(folder,'current.json'),info=await assertRegular(file,{missing:true});if(!info)return null;
  if(info.size>524288)throw new AppError('ACCESS_FORMAT');
  let value;try{value=JSON.parse(await readFile(file,'utf8'));}catch{throw new AppError('ACCESS_FORMAT');}
  if(value?.format!==1||Object.keys(value).sort().join()!=='format,keyring,sha256'||value.keyring?.vaultId!==id||value.sha256!==keyringFingerprint(value.keyring))throw new AppError('ACCESS_FORMAT');
  validateKeyring(value.keyring);return value;
 }
 async resolve(value){
  if(![2,3].includes(value?.formatVersion))return value;
  const current=await this.current(value.vaultId);if(!current)return value;
  const fingerprint=keyringFingerprint(value);if(current.sha256===fingerprint)return current.keyring;
  const file=path.join(this.folder(value.vaultId),fingerprint+'.retired'),info=await assertRegular(file,{missing:true});
  if(!info||info.size!==65||await readFile(file,'utf8')!==fingerprint+'\n')throw new AppError('ACCESS_STATE_CHANGED');
  return current.keyring;
 }
 async locked(id,operation){
  await this.prepare();const folder=this.folder(id);await mkdir(folder,{recursive:true,mode:0o700});await assertRegular(folder,{directory:true});
  const deadline=Date.now()+20000;
  for(;;)try{return await withWriterLease(path.join(folder,'current.lock'),()=>operation(folder));}
  catch(error){if(error.code!=='LOCKED'||Date.now()>=deadline)throw error;await delay(50);}
 }
 async remember(value,vault){
  if(value.formatVersion!==3)return;authenticateKeyring(value,vault);
  // Every unlock remembers its keyring. An already current record needs no
  // write, so read it first: current.json is only ever replaced atomically.
  // Taking the kernel lease here serialized every concurrent unlock of one
  // vault (one helper process each), stalling a reloaded project's reads.
  // A missing or different record still takes the lease and is rechecked.
  if((await this.current(value.vaultId))?.sha256===keyringFingerprint(value))return;
  return this.locked(value.vaultId,async folder=>{
   const existing=await this.current(value.vaultId),sha256=keyringFingerprint(value);
   if(existing){if(existing.sha256!==sha256)throw new AppError('ACCESS_STATE_CHANGED');return;}
   await atomicWrite(path.join(folder,'current.json'),serialize({format:1,sha256,keyring:value}));
  });
 }
 async replace(current,next,vault,write){
  authenticateKeyring(current,vault);authenticateKeyring(next,vault);
  return this.locked(current.vaultId,async folder=>{
   const existing=await this.current(current.vaultId),before=keyringFingerprint(current),after=keyringFingerprint(next);
   if(existing&&existing.sha256!==before)throw new AppError('ACCESS_STATE_CHANGED');
   // Publish the obsolete fingerprint first. Until current.json advances it
   // still resolves to the old current value. Once it advances, old grants
   // cannot return, even if writing the workspace file fails or is interrupted.
   if(before!==after)await atomicWrite(path.join(folder,before+'.retired'),before+'\n');
   try{await atomicWrite(path.join(folder,'current.json'),serialize({format:1,sha256:after,keyring:next}));return await write();}
   catch(cause){const error=new AppError('ACCESS_SAVE_UNCERTAIN');error.cause=cause;error.commitUncertain=true;throw error;}
  });
 }
 async installCheckpoint(next,vault,{expected,obsolete,write}){
  authenticateKeyring(next,vault);if(obsolete)authenticateKeyring(obsolete,vault);
  return this.locked(next.vaultId,async folder=>{
   const current=await this.current(next.vaultId),after=keyringFingerprint(next);
   if((current?.sha256??null)!==expected)throw new AppError('CONFLICT');
   if(current?.sha256!==after&&await assertRegular(path.join(folder,after+'.retired'),{missing:true}))throw new AppError('ACCESS_STATE_CHANGED');
   const retired=new Set([current?.sha256,obsolete&&keyringFingerprint(obsolete)].filter(hash=>hash&&hash!==after));
   for(const hash of retired)await atomicWrite(path.join(folder,hash+'.retired'),hash+'\n');
   try{await atomicWrite(path.join(folder,'current.json'),serialize({format:1,sha256:after,keyring:next}));return await write();}
   catch(cause){const error=new AppError('ACCESS_SAVE_UNCERTAIN');error.cause=cause;error.commitUncertain=true;throw error;}
  });
 }
}
