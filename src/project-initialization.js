import {requireStorageName} from './storage-names.js';
// Creation has one durable intent and one project-local transaction. A retry
// resumes an uncommitted creation or acknowledges its already committed result.
import path from 'node:path';
import {mkdir,readdir,unlink} from 'node:fs/promises';
import {ProjectStorage} from './project-storage.js';
import {assertRegular,privateDirectory,atomicWrite,serialize,digest,workspaceFile} from './storage.js';
import {resolveLocation,probeLocation} from './locations.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {catalogueBinding} from './postgres-activation.js';
import {catalogueContext,catalogueDescriptor} from './research-catalogue.js';
import {validateNotebook} from './model.js';
import {withWriterLease} from './writer-lease.js';
import {AppError} from './errors.js';
const intentName='.observanda/project-creation.observanda',receiptName='project:initialization';
export async function initializeProjectLocation(input,projectId,book,access,vault,{metadata={},populate,populateId=null}={}){
 if(access?.formatVersion!==3)throw new AppError('ACCESS_FORMAT');authenticateKeyring(access,vault);validateNotebook(book);
 if(!Array.isArray(book.projects)||book.projects.length!==1||book.projects[0].id!==projectId||book.projects[0].parentId!=null||book.notebooks.some(n=>n.projectId!==projectId))throw new AppError('INVALID');
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||Object.values(metadata).some(value=>typeof value!=='string')||populate!==undefined&&(typeof populate!=='function'||typeof populateId!=='string'||!populateId.length||populateId.length>160)||populate===undefined&&populateId!==null)throw new AppError('INVALID');
 const root=await resolveLocation(input),storage=new ProjectStorage(root,projectId,vault),fingerprint=digest(serialize({projectId,book,metadata,populateId}));
 requireStorageName(root,book.title);requireStorageName(root,book.projects[0].title);
 for(const name of Object.keys(metadata))storage.metadataPath(name);
 const intentFile=path.join(root,intentName),marker=path.join(root,'.observanda','copy-in-progress');
 const exists=await assertRegular(root,{directory:true,missing:true});
 if(!exists){
  await probeLocation(input);
  await mkdir(root,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await assertRegular(root,{directory:true});
 }
 // Inspect ownership under the creation lease, including an empty directory
 // left by termination before its intent was written. Concurrent retries share
 // this lease and acknowledge the same durable receipt.
 const internal=await privateDirectory(root,'.observanda');
 return withWriterLease(path.join(internal,'project-initialization.lock'),async()=>{
  const intentStat=await assertRegular(intentFile,{missing:true});
  if(intentStat){
   if(intentStat.size>1024)throw new AppError('FORMAT');let intent;
   try{intent=JSON.parse(await storage.readFile(intentFile,'utf8'));}catch(error){if(error instanceof SyntaxError)throw new AppError('FORMAT');throw error;}
   if(!intent||Object.keys(intent).sort().join()!=='fingerprint,projectId,version'||intent.version!==1||intent.projectId!==projectId||intent.fingerprint!==fingerprint)throw new AppError('CONFLICT');
  }else{
   // Another identical request may have completed while this one waited for
   // the creation lease. A successful receipt is an acknowledgement, not work.
   const existing=await catalogueBinding(root);
   if(existing){
    if(existing.placement!=='project'||existing.projectId!==projectId)throw new AppError('EXISTS');
    authenticateKeyring((await readAccess(root)).value,vault);
    if((await storage.catalogue(store=>store.object(receiptName)))?.fingerprint!==fingerprint||await assertRegular(marker,{missing:true}))throw new AppError('EXISTS');
    return storage;
   }
   if((await readdir(root)).some(name=>name!=='.observanda')||(await readdir(internal)).some(name=>name!=='project-initialization.lock'))throw new AppError('EXISTS');
   await storage.writeFile(intentFile,serialize({version:1,projectId,fingerprint}));
  }
  await atomicWrite(marker,'initializing project\n');
  const savedAccess=await readAccess(root);
  if(savedAccess.etag==='none')await atomicWrite(path.join(internal,'access.json'),serialize(access));
  else authenticateKeyring(savedAccess.value,vault);
  const binding=await catalogueBinding(root),db=await storage.openCatalogue({create:!binding}),descriptor=catalogueDescriptor(book),afterCommit=[];
  try{
   await db.run('BEGIN');await db.lock();
   await db.scope(()=>catalogueContext.run({root,projectId,vault,db,afterCommit},async()=>{
    const store=storage.catalogueStore(db),head=await db.get("SELECT 1 FROM state WHERE slot='head'");
    if(!head){
     await store.put(book);
     for(const [relative,text] of Object.entries(metadata))await store.putObject('metadata:'+relative,{text});
     if(populate)await populate(storage);
     await store.putObject(receiptName,{fingerprint});
    }else if((await store.object(receiptName))?.fingerprint!==fingerprint)throw new AppError('CONFLICT');
    await store.verify(descriptor);
   }));
   await db.run('COMMIT');
   const file=await workspaceFile(root,{secure:true});
   if(await assertRegular(file,{missing:true})){if(await storage.readFile(file,'utf8')!==serialize(descriptor))throw new AppError('CATALOGUE_DAMAGED');}
   else await storage.writeFile(file,serialize(descriptor));
   for(const operation of afterCommit)await operation();
   await unlink(marker);await unlink(intentFile);return storage;
  }finally{await db.close();}
 });
}
