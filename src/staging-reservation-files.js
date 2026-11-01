import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID,createHash} from 'node:crypto';
import {seal,unseal} from './encryption.js';
import {temporaryWriteName} from './storage-temporary.js';
import {writeFilePart} from './segmented-file-io.js';
import {AppError} from './errors.js';

const damaged=()=>{throw new AppError('COLLABORATION_DAMAGED');};
// These small encrypted controls use the same retained directory and exclusive
// file primitives as scientific content. The caller owns their native lifetime.
export class StagingReservationFiles{
 constructor(workspace,scope,{signal}={}){this.workspace=workspace;this.scope=scope;this.signal=signal;this.vault=workspace.vault;this.key=this.vault?.key;if(!Buffer.isBuffer(this.key))throw new AppError('ACCESS_LOCKED');this.keyHash=createHash('sha256').update(this.key).digest('hex');}
 check(){this.signal?.throwIfAborted();if(this.workspace.vault!==this.vault||this.vault.key!==this.key||createHash('sha256').update(this.key).digest('hex')!==this.keyHash)throw new AppError('ACCESS_LOCKED');}
 aad(kind){return JSON.stringify(['Observanda/staging-reservations/v1',this.vault.id,this.scope.identity,this.scope.internalIdentity,kind]);}
 async read(directory,name,kind,{missing=false,limit=65536}={}){
  this.check();const saved=await directory.read(name,{missing,limit});this.check();if(!saved)return null;
  let value;try{value=JSON.parse(unseal(saved.bytes,this.key,this.aad(kind)).toString('utf8'));}catch{damaged();}
  if(!value||typeof value!=='object'||Array.isArray(value))damaged();return {value,identity:saved.identity};
 }
 async write(directory,name,kind,value){
  this.check();const bytes=seal(Buffer.from(JSON.stringify(value)),this.key,this.aad(kind));if(bytes.length>65536)throw new AppError('LIMIT');
  const temporary=temporaryWriteName();let file,identity;
  try{file=await directory.file(temporary,{mode:'exclusive'});identity=file.identity;await writeFilePart(file,bytes,0);await file.sync();await file.close();file=null;this.check();await directory.rename(temporary,directory,name,{identity,replace:true});}
  finally{await file?.close();if(identity)await directory.remove(temporary,{identity}).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 }
 async lease(directory,name,{wait=true}={}){
  const deadline=Date.now()+30000;for(;;){this.check();try{return await directory.lease(name);}catch(error){if(error.code!=='EBUSY')throw error;if(!wait||Date.now()>=deadline)throw new AppError('LOCKED');await delay(20,undefined,{signal:this.signal});}}
 }
 async openNamespace({create=false}={}){
  this.check();const internal=this.scope.internalDirectory;let directory=await internal.directory('staging-reservations',{missing:true}),intent;
  if(!directory){
   if(!create)return null;
   intent={version:1,id:randomUUID(),rootIdentity:this.scope.identity,internalIdentity:this.scope.internalIdentity};
   await this.write(internal,'.staging-reservations.intent','namespace-intent',intent);
   directory=await internal.directory('staging-reservations',{create:true,exclusive:true});
  }
  try{
   let proof=await this.read(directory,'namespace','namespace',{missing:true}),admission;
   if(!proof){
    intent??=(await this.read(internal,'.staging-reservations.intent','namespace-intent',{missing:true}))?.value;
    if(!create||intent?.version!==1||intent.rootIdentity!==this.scope.identity||intent.internalIdentity!==this.scope.internalIdentity)damaged();
    // Before the namespace proof exists, initialization can have created only
    // its empty admission control. No staged payload is admitted in this phase.
    for await(const entry of directory.entries()){if(entry.name!=='admission'||entry.directory||(await directory.stat(entry.name)).bytes!==0)damaged();}
    admission=await this.lease(directory,'admission');
    try{const value={version:1,id:intent.id,rootIdentity:this.scope.identity,internalIdentity:this.scope.internalIdentity,directoryIdentity:directory.identity,admissionIdentity:admission.identity};await this.write(directory,'namespace','namespace',value);proof={value};}finally{await admission.close();}
   }
   const value=proof.value;
   if(Object.keys(value).sort().join()!=='admissionIdentity,directoryIdentity,id,internalIdentity,rootIdentity,version'||value.version!==1||value.rootIdentity!==this.scope.identity||value.internalIdentity!==this.scope.internalIdentity||value.directoryIdentity!==directory.identity||typeof value.admissionIdentity!=='string'||typeof value.id!=='string'||! /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.id))damaged();
   admission=await this.lease(directory,'admission');try{
    if(admission.identity!==value.admissionIdentity)damaged();
    const pending=await this.read(internal,'.staging-reservations.intent','namespace-intent',{missing:true});if(pending){if(pending.value.id!==value.id)damaged();if(create)await internal.remove('.staging-reservations.intent',{identity:pending.identity});}
   }finally{await admission.close();}
   return {directory,proof:value};
  }catch(error){await directory.close();throw error;}
 }
}
