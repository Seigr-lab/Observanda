import {ownedStorageLeaseFile} from './owned-storage-control.js';
import {workspaceTransferControl} from './workspace-transfer-controls.js';
// Discovery stays ordered; independent hashes share a bounded adaptive budget.
// Reviews retain counts and a digest, never a complete in-memory inventory.
import {adaptiveReadMap} from './adaptive-reads.js';
import path from 'node:path';
import {opendir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertRegular,workspaceFile,serialize} from './storage.js';
import {CATALOGUE_FILE,CATALOGUE_ARCHIVE,catalogueStamp} from './postgres.js';
import {withScratch} from './scratch-work.js';
import {AppError} from './errors.js';
import {isStorageTemporary} from './storage-temporary.js';
import {MOVE_RECEIPT,MOVE_SOURCE} from './workspace-move-state.js';
import {operationStage,operationAdvance,operationWork} from './operation-progress.js';
export async function hashWorkspaceFile(file,{signal,reportProgress=true}={}){
 const stat=await assertRegular(file);
 const run=async()=>{
  signal?.throwIfAborted();const hash=createHash('sha256');for await(const chunk of createReadStream(file,{signal})){hash.update(chunk);if(reportProgress)operationAdvance(chunk.length);operationWork({bytes:chunk.length});}return hash.digest('hex');
 };
 return reportProgress?operationStage('verify-file',{total:stat.size,unit:'bytes',item:path.basename(file)},run):run();
}
export async function* workspaceFiles(root,{signal,includeDatabase=true,hashFiles=true,projectRoots=[],excludeProject,readPool}={}){
 const excluded=new Set();
 for(const projectRoot of projectRoots){const relative=path.relative(root,projectRoot);if(!relative||relative==='.observanda'||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new AppError('STORAGE_PATH');excluded.add(relative.split(path.sep).join('/'));}
 async function* walk(relative){
  signal?.throwIfAborted();
  const absolute=path.join(root,relative),stat=await assertRegular(absolute,{missing:relative==='.observanda',directory:relative==='.observanda'||relative.endsWith('/')});
  if(!stat)return;
  if(excluded.has(relative.replace(/\/$/,''))||stat.isDirectory()&&excludeProject&&await excludeProject(absolute)){if(!stat.isDirectory())throw new AppError('UNSAFE');return;}
  if(stat.isDirectory()){
   for await(const item of await opendir(absolute)){
    signal?.throwIfAborted();
    // Active PostgreSQL files are never copied as ordinary files. Their
    // complete contents travel through the transactional catalogue archive.
    if(relative!=='.observanda'&&path.posix.basename(relative.replace(/\/$/,''))==='.observanda'&&item.name==='postgresql')throw new AppError('DATABASE_LOCATION');
    if(relative==='.observanda'&&['postgresql','database-transition','project-transfer-files','lab-book-transfer-files'].includes(item.name)){await assertRegular(path.join(absolute,item.name),{directory:true});continue;}
    if(relative==='.observanda'&&item.name==='database-conversion.observanda'){await assertRegular(path.join(absolute,item.name));continue;}
    if(workspaceTransferControl(path.posix.join(relative,item.name))){await assertRegular(path.join(absolute,item.name));continue;}
    if(ownedStorageLeaseFile(path.posix.join(relative,item.name))){await assertRegular(path.join(absolute,item.name),{missing:true});continue;}
    if([MOVE_RECEIPT,MOVE_SOURCE].includes(path.posix.join(relative,item.name))){await assertRegular(path.join(absolute,item.name));continue;}
    // A crashed writer cannot run its finally cleanup. Staged bytes are never
    // referenced by committed metadata, so neither active nor abandoned stages
    // belong in a backup. Do not remove them or mask unsafe links/directories.
    if(isStorageTemporary(item.name)){await assertRegular(path.join(absolute,item.name),{missing:true});continue;}
    if(item.name==='copy-in-progress'||item.name.startsWith('.write-')||item.name.startsWith('.stream-'))throw new AppError('LOCKED');
    yield* walk(path.posix.join(relative,item.name)+(item.isDirectory()?'/':''));
   }
  }else{
   yield {path:relative,bytes:stat.size,...(includeDatabase&&relative===CATALOGUE_FILE?{database:await catalogueStamp(root)}:{})};
  }
 }
 async function* entries(){yield* walk(path.basename(await workspaceFile(root)));yield* walk('.observanda');}
 if(!hashFiles){yield* entries();return;}
 yield* adaptiveReadMap(entries(),async(file,signal)=>({path:file.path,bytes:file.bytes,sha256:await hashWorkspaceFile(path.join(root,file.path),{signal,reportProgress:false}),...(file.database?{database:file.database}:{})}),{signal,pool:readPool});
}
export function workspaceInventory(root,salt,{signal,visit,expected,expectedFiles,consume,projectRoots=[],excludeProject}={}){
 if(typeof salt!=='string'||!/^[a-f0-9-]{36}$/.test(salt))throw new AppError('INVALID');
 return operationStage('inventory',{unit:'files'},()=>withScratch(async work=>{
  let bytes=0,fileBytes=0,transferFiles=0,databaseBytes=0;
  for await(const file of workspaceFiles(root,{signal,includeDatabase:!expectedFiles,projectRoots,excludeProject})){
   if(!await work.add(file.path,file))throw new AppError('UNSAFE');
   bytes+=file.bytes+(file.database?.bytes??0);
   databaseBytes+=file.database?.bytes??0;
   if(![CATALOGUE_FILE,CATALOGUE_ARCHIVE].includes(file.path)){fileBytes+=file.bytes;transferFiles++;}
   if(!Number.isSafeInteger(bytes))throw new AppError('LIMIT');
   operationAdvance();
  }
  const hash=createHash('sha256'),fileHash=createHash('sha256');
  await operationStage(visit?'copy-files':'source-check',{total:work.size,unit:'files'},async()=>{
   for await(const file of work.items()){
    hash.update(serialize(file));const {database,...stored}=file;void database;
    // Independently restored databases have different binding identities.
    // Their contents are checked separately through the archive contract.
    fileHash.update(serialize(file.path===CATALOGUE_FILE?{path:CATALOGUE_FILE}:stored));if(visit)await visit(file);operationAdvance();
   }
  });
  const inventory={fingerprint:hash.digest('hex'),fingerprintFiles:fileHash.digest('hex'),fileCount:work.size,bytes,fileBytes,transferFiles,databaseBytes};
  if(expected&&['fingerprint','fileCount','bytes'].some(key=>inventory[key]!==expected[key]))throw new AppError('CONFLICT');
  if(expectedFiles&&['fingerprintFiles','fileCount'].some(key=>inventory[key]!==expectedFiles[key]))throw new AppError('CONFLICT');
  if(consume)await consume(inventory,()=>work.items());
  return inventory;
 },{signal,keySalt:salt}));
}
