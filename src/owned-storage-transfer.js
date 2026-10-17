import {assertRecordOwnerReclamationSettled} from './record-owner-transfer-state.js';
import {assertInventoryObligationsSettled} from './inventory-obligation-lifecycle.js';
import {requireStorageName,storageFolderName} from './storage-names.js';
import {reconcileProjectFiles} from './project-transfer-files.js';
import {verifyCatalogueArchive} from './research-catalogue.js';
// Owned transfers stream one independently authorized catalogue into its destination.
// The destination remains unavailable until its files and database are verified.
import path from 'node:path';
import {projectCopyBoundaries,retainedCopyRoots} from './project-copy-boundaries.js';
import {mkdir,readdir,realpath,unlink} from 'node:fs/promises';
import {resolveLocation,probeLocation} from './locations.js';
import {workspaceFiles,hashWorkspaceFile} from './workspace-inventory.js';
import {workspaceFile,assertRegular,privateDirectory,atomicWrite,serialize} from './storage.js';
import {catalogueBinding,CATALOGUE_FILE,CATALOGUE_ARCHIVE,CATALOGUE_ACTIVATION} from './postgres-activation.js';
import {transferCatalogue,openCatalogue,catalogueArchiveDigest,backupCatalogue,prepareTransferredCatalogue} from './postgres.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {withWriterLease} from './writer-lease.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
import {withOperationProgress,operationStage,operationSequence,operationTransfer} from './operation-progress.js';
export function ownedStorageTransfer({Storage,placement,ownerId,archiveFile,readArchive,writeArchive}){
const intentName='.observanda/'+placement+'-transfer.observanda',leaseName='.observanda/'+placement+'-transfer.lock',markerName='.observanda/copy-in-progress';
const receiptDirectory='.observanda/'+placement+'-transfer-files';
const controls=new Set([intentName,leaseName,CATALOGUE_FILE,CATALOGUE_ARCHIVE,CATALOGUE_ACTIVATION,archiveFile]);
const within=(parent,child)=>{const relative=path.relative(parent,child);return relative===''||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
async function intent(storage){
 const file=path.join(storage.root,intentName),stat=await assertRegular(file,{missing:true});if(!stat)return null;if(stat.size>16*1024*1024)throw new AppError('STORAGE_COPY');
 let value;try{value=JSON.parse(await storage.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_COPY');}
 if(![1,2].includes(value?.version)||!researchId(value.id)||value[ownerId]!==storage[ownerId]||value.vaultId!==storage.vault.id||!researchId(value.sourceId)||!researchId(value.namespaceId)||!['files','database','verified'].includes(value.phase)||!path.isAbsolute(value.source??'')||value.source!==path.resolve(value.source)||value.destination!==storage.root||!/^[a-f0-9]{64}$/.test(value.head??'')||value.portable!==undefined&&value.portable!==true||value.relocation!==undefined&&typeof value.relocation!=='boolean'||value.filesVersion!==undefined&&value.filesVersion!==1||[value.archiveDigest,value.nextDigest].some(hash=>hash!==undefined&&!/^[a-f0-9]{64}$/.test(hash)))throw new AppError('STORAGE_COPY');
 retainedCopyRoots(value);return value;
}

async function save(storage,value){const raw=serialize(value);if(Buffer.byteLength(raw)>16*1024*1024-128)throw new AppError('LIMIT');await storage.writeFile(path.join(storage.root,intentName),raw);}
async function copy(source,input,{id,onProgress,checkpoint=async()=>{},afterVerified,beforeVerified,onVerified,sourceHandoff,projectRoots=[],portable=false,retainIncomplete=false,relocation=false}={}){
 if(!(source instanceof Storage)||!researchId(id)||typeof checkpoint!=='function'||afterVerified!==undefined&&typeof afterVerified!=='function'||beforeVerified!==undefined&&typeof beforeVerified!=='function'||onVerified!==undefined&&typeof onVerified!=='function'||sourceHandoff!==undefined&&typeof sourceHandoff!=='function'||typeof portable!=='boolean'||typeof retainIncomplete!=='boolean'||typeof relocation!=='boolean'||portable&&relocation||portable&&afterVerified!==undefined)throw new AppError('INVALID');
 await source.catalogue(store=>assertRecordOwnerReclamationSettled(store));
 if(!relocation)await assertInventoryObligationsSettled(source);
 const sourceRoot=await realpath(source.root),destination=await resolveLocation(input);
 if(within(sourceRoot,destination)||within(destination,sourceRoot))throw new AppError('STORAGE_PATH');
 requireStorageName(destination,storageFolderName(sourceRoot));
 const boundaries=projectCopyBoundaries(sourceRoot,projectRoots);
 const access=await readAccess(sourceRoot);if(access.value.formatVersion!==3)throw new AppError('ACCESS_FORMAT');authenticateKeyring(access.value,source.vault);
 const target=new Storage(destination,source[ownerId],source.vault),marker=path.join(destination,markerName);
 return withOperationProgress(onProgress,()=>operationSequence('copy-'+placement,['copy-files',placement+'-database-import'],async()=>{
  const exists=await assertRegular(destination,{missing:true,directory:true});
  if(!exists){await probeLocation(destination);await mkdir(destination,{mode:0o700});}
  if(!(await assertRegular(path.join(destination,'.observanda'),{missing:true,directory:true}))){
   if((await readdir(destination)).length)throw new AppError('EXISTS');await mkdir(path.join(destination,'.observanda'),{mode:0o700});
  }
  return withWriterLease(path.join(destination,leaseName),async()=>{
   let receipt=await intent(target);
   if(receipt){
    if(!!receipt.portable!==portable||receipt.relocation!==undefined&&receipt.relocation!==relocation||receipt.id!==id||receipt.source!==sourceRoot||serialize(receipt.boundaries??[])!==serialize(boundaries))throw new AppError('CONFLICT');
    const targetAccess=await readAccess(destination);if(targetAccess.etag==='none'&&receipt.phase==='files')await atomicWrite(path.join(destination,'.observanda/access.json'),serialize(access.value));else authenticateKeyring(targetAccess.value,source.vault);
    if(receipt.phase==='verified'&&!afterVerified){
     const binding=await catalogueBinding(destination);
     if(portable){const identity=await readArchive(destination,source.vault);if(binding||identity[ownerId]!==source[ownerId]||identity.namespaceId!==receipt.namespaceId||identity.archiveDigest!==receipt.archiveDigest)throw new AppError('STORAGE_COPY');}
     else{if(binding?.placement!==placement||binding[ownerId]!==source[ownerId])throw new AppError('DATABASE_LOCATION');if(!relocation)await assertInventoryObligationsSettled(target);if(retainIncomplete){const metadata=await target.catalogue(async store=>(await store.snapshot()).metadata);if(metadata.id!==receipt.namespaceId)throw new AppError('DATABASE_LOCATION');}else await target.outline();}
     if(onVerified)await onVerified(target,receipt);
     if(!retainIncomplete)await unlink(marker).catch(error=>{if(error.code!=='ENOENT')throw error;});
     return target;
    }
   }else{
    if((await readdir(destination)).some(name=>name!=='.observanda')||(await readdir(path.join(destination,'.observanda'))).some(name=>name!==path.basename(leaseName)))throw new AppError('EXISTS');
   }
   const handoff=sourceHandoff??(operation=>source.withStorageHandoff(operation,{existing:true}));
   return handoff(async()=>{
    await source.catalogue(store=>assertRecordOwnerReclamationSettled(store));
 if(!relocation)await assertInventoryObligationsSettled(source);
    const binding=await catalogueBinding(sourceRoot),outline=await source.outline();
    if(binding?.placement!==placement||binding[ownerId]!==source[ownerId])throw new AppError('DATABASE_LOCATION');
    if(receipt&&(receipt.sourceId!==binding.id||receipt.namespaceId!==outline.metadata.id))throw new AppError('CONFLICT');
    if(!receipt){
     receipt={version:2,filesVersion:1,relocation,boundaries,...(portable?{portable:true}:{}),id,source:sourceRoot,destination,sourceId:binding.id,[ownerId]:source[ownerId],vaultId:source.vault.id,namespaceId:outline.metadata.id,head:outline.etag,phase:'files'};
     await save(target,receipt);await atomicWrite(path.join(destination,'.observanda/access.json'),serialize(access.value));
    }
    const original=await source.openCatalogue({detached:true});let copied;
    try{
     const sourceDigest=receipt.archiveDigest?await catalogueArchiveDigest(original):null,expected=[receipt.archiveDigest,receipt.nextDigest].filter(Boolean);
     const reconcile=async()=>{
      const targetBinding=await catalogueBinding(destination);let current=null,prepared;
      if(targetBinding){
       if(portable||targetBinding.placement!==placement||targetBinding[ownerId]!==source[ownerId])throw new AppError('STORAGE_COPY');
       prepared=await target.catalogue(store=>prepareTransferredCatalogue(store.db,expected));current=prepared.digest;
      }else if(portable&&receipt.archiveDigest){
       current=await hashWorkspaceFile(path.join(destination,CATALOGUE_ARCHIVE));if(!expected.includes(current))throw new AppError('CONFLICT');
      }
      receipt.head=outline.etag;receipt.phase='files';await save(target,receipt);await atomicWrite(marker,'copying '+placement+'\n');
      operationTransfer({phase:'copying',files:0,bytes:0});
      await operationStage('copy-files',{unit:'files'},()=>reconcileProjectFiles(source,target,receipt,{controls,receiptDirectory,projectRoots:retainedCopyRoots(receipt),checkpoint}));
      receipt.phase='database';await save(target,receipt);await checkpoint('files');operationTransfer({phase:'verifying'});
      const descriptor=JSON.parse(await target.readFile(await workspaceFile(destination),'utf8'));
      const validate=db=>operationStage('verify-'+placement+'-database',{},()=>target.catalogueStore(db).verify(descriptor));
      let digest;
      if(portable){
       if(!receipt.archiveDigest||current!==sourceDigest){
        if(sourceDigest){receipt.nextDigest=sourceDigest;await save(target,receipt);}
        digest=await backupCatalogue(sourceRoot,destination,{connection:original});if(sourceDigest&&digest!==sourceDigest)throw new AppError('CONFLICT');
        if(!receipt.archiveDigest){receipt.archiveDigest=digest;await save(target,receipt);}
       }else digest=current;
       if(await hashWorkspaceFile(path.join(destination,CATALOGUE_ARCHIVE))!==digest)throw new AppError('STORAGE_COPY');
       await operationStage('verify-'+placement+'-database',{},()=>verifyCatalogueArchive(target,descriptor));
       await writeArchive(target,{...receipt,archiveDigest:digest});
      }else if(targetBinding){
       if(current!==sourceDigest){
        receipt.nextDigest=sourceDigest;await save(target,receipt);
        digest=await prepared.replace(original,validate);
        if(digest!==sourceDigest)throw new AppError('CONFLICT');
       }else{digest=current;await target.catalogue(store=>validate(store.db));}
      }else{
       let restored=false;copied=await operationStage(placement+'-database-import',{},()=>openCatalogue(destination,{[ownerId]:source[ownerId],vault:source.vault,restore:async db=>{restored=true;receipt.archiveDigest=await transferCatalogue(original,db);await save(target,receipt);},validate}));
       digest=restored?receipt.archiveDigest:await catalogueArchiveDigest(copied);
       if(![receipt.archiveDigest,receipt.nextDigest].includes(digest))throw new AppError('CONFLICT');
       if(sourceDigest&&digest!==sourceDigest){
        await copied.close();copied=null;receipt.nextDigest=sourceDigest;await save(target,receipt);
        digest=await target.withStorageHandoff(()=>target.catalogue(async store=>(await prepareTransferredCatalogue(store.db,[receipt.archiveDigest,receipt.nextDigest].filter(Boolean))).replace(original,validate)),{existing:true});
        if(digest!==sourceDigest)throw new AppError('CONFLICT');
       }
      }
      await checkpoint('database');return digest;
     };
     const digest=await catalogueBinding(destination)?await target.withStorageHandoff(reconcile,{existing:true}):await reconcile();
     await checkpoint('database-committed');
     if(beforeVerified)await beforeVerified(target,receipt,()=>save(target,receipt));
     receipt.archiveDigest=digest;delete receipt.nextDigest;receipt.phase='verified';await save(target,receipt);await checkpoint('verified');if(onVerified)await onVerified(target,receipt);
    }finally{await copied?.close();await original.close();}
    if(!retainIncomplete)await unlink(marker);if(afterVerified)await afterVerified(target,receipt);return target;
   });
  });
 }));
}

// Only recovery rechecks a published transfer against a source which may have
// changed after interruption. Normal copying verifies each file and archive as
// it is transferred, without reading the database a second time.
async function verify(source,target,receipt){
 if(receipt.source!==source.root||receipt.destination!==target.root||receipt[ownerId]!==source[ownerId]||receipt.vaultId!==source.vault.id||!receipt.archiveDigest)throw new AppError('STORAGE_COPY');
 for(const storage of [source,target]){
  const db=await storage.openCatalogue({detached:true});
  try{if(await catalogueArchiveDigest(db)!==receipt.archiveDigest)throw new AppError('CONFLICT');}finally{await db.close();}
 }
 for await(const file of workspaceFiles(source.root,{includeDatabase:false,projectRoots:retainedCopyRoots(receipt)})){
  if(controls.has(file.path))continue;
  const output=path.join(target.root,file.path);await privateDirectory(target.root,path.posix.dirname(file.path));
  if((await assertRegular(output)).size!==file.bytes||await hashWorkspaceFile(output)!==file.sha256)throw new AppError('CONFLICT');
 }
}

return {copy,receipt:intent,verify};
}
