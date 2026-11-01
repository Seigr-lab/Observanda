import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {withNativeDestination} from './native-destination.js';
import {StagingReservationFiles} from './staging-reservation-files.js';
import {STAGING_PROGRESS_BYTES,STAGING_FREE_BYTES,STAGING_ACTIVE_LIMIT,admitStagingClaim,stagingRemaining} from './staging-reservation-model.js';
import {diskCapacity} from './disk-capacity.js';
import {uuid,exact} from './modules/validation.js';
import {AppError} from './errors.js';
import {isStorageTemporary} from './storage-temporary.js';
import {unseal} from './encryption.js';
import {setImmediate as nextTurn} from 'node:timers/promises';

const damaged=()=>{throw new AppError('COLLABORATION_DAMAGED');};
const stagePrefix=id=>'.observanda/collaboration/staging/'+id;
const safe=value=>Number.isSafeInteger(value)&&value>=0;
const identity=value=>typeof value==='string'&&value.length>0&&value.length<512;
function validClaim(value){
 return exact(value,['version','id','generation','principalId','ownerId','grantGeneration','expectedBytes','writtenBytes','entries','files','createdAt','expiresAt','phase','preserve','directoryIdentity','stageIdentity','leaseIdentity','filesIdentity'])&&value.version===1&&uuid(value.id)&&uuid(value.generation)&&uuid(value.principalId)&&uuid(value.ownerId)&&Number.isSafeInteger(value.grantGeneration)&&value.grantGeneration>=1&&safe(value.expectedBytes)&&safe(value.writtenBytes)&&value.writtenBytes<=value.expectedBytes&&Number.isSafeInteger(value.entries)&&value.entries>=1&&safe(value.files)&&value.files<=value.entries&&safe(value.createdAt)&&safe(value.expiresAt)&&value.expiresAt>value.createdAt&&['initializing','active','preparing','retiring'].includes(value.phase)&&(value.phase==='retiring'?typeof value.preserve==='boolean':value.preserve===null)&&['directoryIdentity','stageIdentity','leaseIdentity','filesIdentity'].every(key=>value.phase==='initializing'?value[key]===null:identity(value[key]));
}
function validateLedger(value){if(!exact(value,['version','claims'])||value.version!==1||!Array.isArray(value.claims)||value.claims.length>STAGING_ACTIVE_LIMIT||value.claims.some(claim=>!validClaim(claim))||new Set(value.claims.map(claim=>claim.id)).size!==value.claims.length)damaged();return value;}
function fileProof(value,claim,index){
 if(!exact(value,['version','index','generation','directoryIdentity','temporary','name','identity','bytes'])||value.version!==1||value.index!==index||value.generation!==claim.generation||value.directoryIdentity!==claim.stageIdentity||!isStorageTemporary(value.temporary)||value.name!==index+'.blob'||value.identity!==null&&!identity(value.identity)||!safe(value.bytes))damaged();return value;
}

// The explicit workspace is the reservation authority. Parent projects are
// never guessed from directory names; callers must pass their actual owner.
export async function withStagingAuthority(workspace,operation,{signal,createInternal=false}={}){
 return withNativeDestination(workspace.root,async scope=>{
  await scope.admit({createInternal});const controls=new StagingReservationFiles(workspace,scope,{signal});let namespace;
  const active=new Set();
  async function critical(operation,{create=false}={}){
   const opened=await (namespace?Promise.resolve(namespace):controls.openNamespace({create}));if(!opened)return operation(null,null);namespace=opened;
   const lease=await controls.lease(namespace.directory,'admission');
   try{controls.check();await scope.assertNamed();if((await scope.internalDirectory.stat('staging-reservations',{folder:true})).identity!==namespace.directory.identity||lease.identity!==namespace.proof.admissionIdentity)damaged();const saved=await controls.read(namespace.directory,'state','ledger',{missing:true}),ledger=saved?validateLedger(saved.value):{version:1,claims:[]};
    const ids=new Set(ledger.claims.map(claim=>claim.id));for await(const entry of namespace.directory.entries())if(entry.directory?!ids.has(entry.name):!['namespace','admission','state'].includes(entry.name))damaged();
    return await operation(ledger,async()=>controls.write(namespace.directory,'state','ledger',ledger));}
   finally{await lease.close();}
  }
  const heldClaim=(ledger,claim)=>{const current=ledger.claims.find(value=>value.id===claim.id);if(!current||current.generation!==claim.generation||current.leaseIdentity!==claim.leaseIdentity)throw new AppError('CONFLICT');return current;};
  function current(claim){controls.check();if(Date.now()>=claim.expiresAt)throw new AppError('COLLABORATION_EXPIRED');}
  async function remaining(ledger){let bytes=0;for(const claim of ledger.claims){bytes+=stagingRemaining(claim);if(!safe(bytes))throw new AppError('STORAGE_FULL');}return bytes;}
  async function namedStage(claim){const found=await scope.member(path.join(workspace.root,stagePrefix(claim.id)),(parent,name)=>parent.stat(name,{folder:true}));if(found.identity!==claim.stageIdentity)damaged();}
  async function clearMetadata(claim,stage){
   const prefix=stagePrefix(claim.id);if(await workspace.storageKind()==='catalogue'){
    const page=await workspace.metadataPage(prefix,{limit:32});for(const item of page.items){if(!/^(?:items\/\d+|names\/[a-f0-9]{64})\.json$/.test(item.name))damaged();await workspace.removeMetadata(prefix+'/'+item.name);}return page.items.length>0;
   }else{
    let count=0;
    for(const name of ['items','names']){const directory=await stage.directory(name,{missing:true});if(!directory)continue;const directoryIdentity=directory.identity;
     try{for await(const entry of directory.entries()){if(count++===32)return true;if(entry.directory||!(name==='items'?/^\d+\.json$/:/^[a-f0-9]{64}\.json$/).test(entry.name))damaged();const saved=await directory.read(entry.name,{limit:4096});try{JSON.parse(unseal(saved.bytes,controls.key,workspace.fileAAD(path.join(workspace.root,prefix,name,entry.name))).toString('utf8'));}catch{damaged();}await directory.remove(entry.name,{identity:saved.identity});}}finally{await directory.close();}
     await stage.remove(name,{folder:true,identity:directoryIdentity});
    }
   }
  }
  const authority={
   workspace,scope,controls,
   async status(){return critical(async ledger=>({active:ledger?.claims.length??0,remainingBytes:ledger?await remaining(ledger):0,writtenBytes:ledger?.claims.reduce((sum,claim)=>sum+claim.writtenBytes,0)??0}));},
   async capacityAdmission(operation){return critical(async ledger=>{const remainingBytes=await remaining(ledger),reserveBytes=ledger.claims.length?STAGING_FREE_BYTES:0,volumeId=ledger.claims.length?(await diskCapacity.probe(workspace.root)).id:null;return operation({remainingBytes,reserveBytes,volumeId});},{create:true});},
   async reserve({id,principalId,ownerId,grantGeneration,expectedBytes,entries,expiresAt}){
    const claim={version:1,id,generation:randomUUID(),principalId,ownerId,grantGeneration,expectedBytes,writtenBytes:0,entries,files:0,createdAt:Date.now(),expiresAt,phase:'initializing',preserve:null,directoryIdentity:null,stageIdentity:null,leaseIdentity:null,filesIdentity:null};if(!validClaim(claim))throw new AppError('INVALID');
    let directory,stage,lease,files;await critical(async(ledger,save)=>{
     await diskCapacity.check(workspace.root,admitStagingClaim(ledger.claims,claim),STAGING_FREE_BYTES);ledger.claims.push(claim);await save();
     // Persist the empty-object intent before creating either container. No
     // payload may be written before all native identities are acknowledged.
     directory=await namespace.directory.directory(id,{create:true,exclusive:true});lease=await controls.lease(directory,'owner');files=await directory.directory('files',{create:true,exclusive:true});
     stage=await scope.member(path.join(workspace.root,stagePrefix(id)),(parent,name)=>parent.directory(name,{create:true,exclusive:true}),{create:true});
     Object.assign(claim,{phase:'active',directoryIdentity:directory.identity,stageIdentity:stage.identity,leaseIdentity:lease.identity,filesIdentity:files.identity});await save();
    },{create:true}).catch(async error=>{await files?.close();await stage?.close();await lease?.close();await directory?.close();throw error;});
    let pending=0,closed=false,writing=false;
    const flush=async()=>critical(async(ledger,save)=>{current(claim);const found=heldClaim(ledger,claim);if(found.writtenBytes+pending>found.expectedBytes)damaged();found.writtenBytes+=pending;await save();claim.writtenBytes=found.writtenBytes;pending=0;await diskCapacity.check(workspace.root,await remaining(ledger),STAGING_FREE_BYTES);});
    const owner={id,generation:claim.generation,
     async check(){if(closed)throw new AppError('CONFLICT');current(claim);await critical(async ledger=>{if(!['active','preparing'].includes(heldClaim(ledger,claim).phase))throw new AppError('CONFLICT');await namedStage(claim);});},
     async capacity({directory:parent,temporary,name,storedBytes}){
      if(closed||writing||parent.identity!==claim.stageIdentity||!isStorageTemporary(temporary)||!safe(storedBytes))throw new AppError('CONFLICT');current(claim);
      const index=Number(name.replace(/\.blob$/,''));if(name!==index+'.blob'||!safe(index))damaged();let proof;writing=true;
      try{await critical(async(ledger,save)=>{const found=heldClaim(ledger,claim);if(index!==found.files||index>=found.entries)damaged();if(storedBytes>found.expectedBytes-found.writtenBytes-pending)throw new AppError('LIMIT');proof={version:1,index,generation:claim.generation,directoryIdentity:claim.stageIdentity,temporary,name,identity:null,bytes:storedBytes};await controls.write(files,index+'.json','file/'+id+'/'+claim.generation+'/'+index,proof);found.files++;await save();claim.files=found.files;await diskCapacity.check(workspace.root,await remaining(ledger),STAGING_FREE_BYTES);});}catch(error){writing=false;throw error;}
      let written=0,released=false,busy=false;
      return {
       async created(handle){if(released||proof.identity!==null)throw new AppError('CONFLICT');proof.identity=handle.identity;await controls.write(files,index+'.json','file/'+id+'/'+claim.generation+'/'+index,proof);},
       async write(bytes,operation){current(claim);if(released||busy||proof.identity===null||!safe(bytes)||written+bytes>storedBytes)throw new AppError('LIMIT');busy=true;try{if(pending>=STAGING_PROGRESS_BYTES)await flush();const result=await operation();written+=bytes;pending+=bytes;return result;}finally{busy=false;}},
       async beforePublish(){current(claim);if(written!==storedBytes)throw new AppError('COLLABORATION_PACKAGE');await owner.check();},
       async release(){if(busy)throw new AppError('LOCKED');if(released)return;released=true;writing=false;if(!closed&&workspace.vault?.key===controls.key)await flush();}
      };
     },
     async preparing(){if(writing)throw new AppError('LOCKED');await flush();await critical(async(ledger,save)=>{const found=heldClaim(ledger,claim);found.phase='preparing';await save();claim.phase='preparing';});},
     async committed(){if(writing)throw new AppError('LOCKED');await owner.check();if(await workspace.readMetadata(stagePrefix(id)+'/head.json',8192)===null)throw new AppError('CONFLICT');if(await authority.retire(claim,{directory,stage,lease,files,committed:true}))await owner.close();else{closed=true;active.delete(owner);}},
     async close(){if(closed)return;closed=true;active.delete(owner);await files.close();await stage.close();await lease.close();await directory.close();},
     claim
    };active.add(owner);return owner;
   },
   async retire(claim,{directory,stage,lease,files,committed=false}){
    return critical(async(ledger,save)=>{
     if(!ledger.claims.some(value=>value.id===claim.id))return;const found=heldClaim(ledger,claim);
     if(directory&&directory.identity!==found.directoryIdentity||stage&&stage.identity!==found.stageIdentity||files&&files.identity!==found.filesIdentity||lease&&lease.identity!==found.leaseIdentity)damaged();
     if(found.phase!=='retiring'&&(!directory||!stage||!lease||!files))damaged();
     const head=await workspace.readMetadata(stagePrefix(claim.id)+'/head.json',8192);if(committed&&head===null)throw new AppError('CONFLICT');
     if(found.phase!=='retiring'){await namedStage(found);found.phase='retiring';found.preserve=head!==null;await save();}
     else if(head!==null&&!found.preserve){found.preserve=true;await save();}const preserve=found.preserve;
     let removed=0;if(files)for await(const entry of files.entries()){
      if(removed++===32)return true;
      if(entry.directory||! /^(?:0|[1-9]\d*)\.json$/.test(entry.name))damaged();const index=Number(entry.name.slice(0,-5));if(!safe(index)||index>found.files||index>=found.entries)damaged();
      const saved=await controls.read(files,entry.name,'file/'+found.id+'/'+found.generation+'/'+index),proof=fileProof(saved.value,found,index);
      if(!preserve&&stage){let matched=0;for(const name of [proof.temporary,proof.name]){const stat=await stage.stat(name,{missing:true});if(!stat)continue;if(proof.identity===null){if(name!==proof.temporary||stat.bytes!==0)damaged();}else if(stat.identity!==proof.identity||stat.bytes>proof.bytes||++matched>1)damaged();await stage.remove(name,{identity:stat.identity});}}
      await files.remove(entry.name,{identity:saved.identity});
     }
     if(!preserve){if((stage||await workspace.storageKind()==='catalogue')&&await clearMetadata(found,stage))return true;if(stage){for await(const _entry of stage.entries())damaged();const stageIdentity=stage.identity;await stage.close();await scope.member(path.join(workspace.root,stagePrefix(found.id)),(parent,name)=>parent.remove(name,{folder:true,identity:stageIdentity}));}}else await stage?.close();
     if(files){const filesIdentity=files.identity;await files.close();await directory.remove('files',{folder:true,identity:filesIdentity});}await lease?.close();
     if(directory){const owner=await directory.stat('owner',{missing:true});if(owner){if(owner.identity!==found.leaseIdentity)damaged();await directory.remove('owner',{identity:found.leaseIdentity});}for await(const _entry of directory.entries())damaged();const directoryIdentity=directory.identity;await directory.close();await namespace.directory.remove(found.id,{folder:true,identity:directoryIdentity});}
     ledger.claims=ledger.claims.filter(value=>value.id!==found.id);await save();return false;
    });
   },
   async recover({rejectActive=false,id}={}){
    if(id!==undefined&&!uuid(id))throw new AppError('INVALID');
    if(!namespace){const present=await scope.internalDirectory.stat('staging-reservations',{folder:true,missing:true}),intent=await controls.read(scope.internalDirectory,'.staging-reservations.intent','namespace-intent',{missing:true});if(present||intent)namespace=await controls.openNamespace({create:true});}
    const claims=await critical(async ledger=>ledger?structuredClone(ledger.claims.filter(claim=>id===undefined||claim.id===id)):[]);
    for(const claim of claims){let directory,stage,lease,files;
     try{
      directory=await namespace.directory.directory(claim.id,{missing:true});
      if(claim.phase==='initializing'){
       // Initialization intents contain no body authority. Remove only their
       // planned empty containers; any unknown or nonempty content is retained.
       if(await workspace.readMetadata(stagePrefix(claim.id)+'/head.json',8192)!==null)damaged();
       if(directory){try{lease=await controls.lease(directory,'owner',{wait:false});}catch(error){if(error.code==='LOCKED'&&!rejectActive)continue;throw error;}for await(const entry of directory.entries()){if(entry.name==='owner'&&!entry.directory)continue;if(entry.name!=='files'||!entry.directory)damaged();files=await directory.directory('files');for await(const _file of files.entries())damaged();const filesIdentity=files.identity;await files.close();files=null;await directory.remove('files',{folder:true,identity:filesIdentity});}const ownerIdentity=lease.identity;await lease.close();lease=null;await directory.remove('owner',{identity:ownerIdentity});const ownIdentity=directory.identity;await directory.close();directory=null;await namespace.directory.remove(claim.id,{folder:true,identity:ownIdentity});}
       stage=await scope.member(path.join(workspace.root,stagePrefix(claim.id)),(parent,name)=>parent?.directory(name,{missing:true}),{missing:true});if(stage){for await(const _entry of stage.entries())damaged();const stageIdentity=stage.identity;await stage.close();stage=null;await scope.member(path.join(workspace.root,stagePrefix(claim.id)),(parent,name)=>parent.remove(name,{folder:true,identity:stageIdentity}));}
       await critical(async(ledger,save)=>{const found=ledger.claims.find(value=>value.id===claim.id);if(!found||found.phase!=='initializing'||found.generation!==claim.generation)throw new AppError('CONFLICT');ledger.claims=ledger.claims.filter(value=>value.id!==claim.id);await save();});return true;
      }
      if(!directory&&claim.phase!=='retiring'||directory&&directory.identity!==claim.directoryIdentity)damaged();
      if(directory){let hasOwner=false;for await(const entry of directory.entries())if(entry.name==='owner'&&!entry.directory)hasOwner=true;if(hasOwner){try{lease=await controls.lease(directory,'owner',{wait:false});}catch(error){if(error.code==='LOCKED'&&!rejectActive)continue;throw error;}}else if(claim.phase!=='retiring')damaged();files=await directory.directory('files',{missing:claim.phase==='retiring'});}
      stage=await scope.member(path.join(workspace.root,stagePrefix(claim.id)),(parent,name)=>parent?.directory(name,{missing:claim.phase==='retiring'}),{missing:claim.phase==='retiring'});await authority.retire(claim,{directory,stage,lease,files});return true;
     }finally{await files?.close();await stage?.close();await lease?.close();await directory?.close();}
    }return false;
   },
   async handoff(){await critical(async ledger=>{if(ledger?.claims.length)throw new AppError('LOCKED');});}
  };
  try{return await operation(authority);}finally{for(const owner of active)await owner.close();await namespace?.directory.close();}
 });
}

// Called inside the existing owner writer before any successful storage
// snapshot. A live staging lease refuses handoff; abandoned bytes are recovered
// only through the same authenticated claim/identity state machine.
export async function assertStagingHandoff(workspace){if(!workspace.vault?.id)return;await withStagingAuthority(workspace,authority=>authority.handoff());}
export async function recoverStaging(workspace,{signal,id,rejectActive=false}={}){
 if(!workspace.vault?.id)return;
 while(await workspace.withLock(()=>withStagingAuthority(workspace,authority=>authority.recover({id,rejectActive}),{signal}))){signal?.throwIfAborted();await nextTurn(undefined,{signal});}
}
export async function withStagingHandoff(workspace,operation){await recoverStaging(workspace,{rejectActive:true});return operation();}
// Native initialization/admission leases span the caller's volume probe and
// local ticket admission, including callers inside a read-only DB snapshot.
// Ordinary tickets remain service-local; only recovery-backed claims persist.
export function withStagingCapacity(workspace,operation,{signal}={}){return withStagingAuthority(workspace,authority=>operation(callback=>authority.capacityAdmission(callback)),{createInternal:true,signal});}
export function stagingCapacityAdmission(workspace,options){return operation=>withStagingCapacity(workspace,admission=>admission(operation),options);}

export async function verifiedStagingReservationNamespace(root,vault){
 if(!vault?.key)return false;
 try{return await withNativeDestination(root,async scope=>{
  await scope.admit();const controls=new StagingReservationFiles({root,vault},scope),opened=await controls.openNamespace();if(!opened)return false;let lease;
  try{lease=await controls.lease(opened.directory,'admission',{wait:false});if(lease.identity!==opened.proof.admissionIdentity)return false;const saved=await controls.read(opened.directory,'state','ledger',{missing:true});if(saved&&validateLedger(saved.value).claims.length)return false;for await(const entry of opened.directory.entries())if(entry.directory||!['namespace','admission','state'].includes(entry.name))return false;return true;}
  finally{await lease?.close();await opened.directory.close();}
 });}catch{return false;}
}
