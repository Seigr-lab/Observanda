import {withProjectModuleInitialization} from './project-module-initialization.js';
// Initialize a new book with a durable identity and one local transaction.
// An interrupted caller resumes its intent rather than generating another book.
import path from 'node:path';
import {mkdir,readdir,unlink} from 'node:fs/promises';
import {LabBookStorage} from './lab-book-storage.js';
import {assertRegular,privateDirectory,atomicWrite,serialize,digest,workspaceFile} from './storage.js';
import {resolveLocation,probeLocation} from './locations.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {catalogueBinding} from './postgres-activation.js';
import {catalogueContext,catalogueDescriptor} from './research-catalogue.js';
import {validateNotebook} from './model.js';
import {requireStorageName} from './storage-names.js';
import {withWriterLease} from './writer-lease.js';
import {AppError} from './errors.js';
const intentName='.observanda/lab-book-creation.observanda',receiptName='lab-book:initialization';
export async function initializeLabBookLocation(input,labBookId,book,access,vault,{populate,populateId=null}={}){
 if(populate!==undefined&&(typeof populate!=='function'||typeof populateId!=='string'||!populateId.length||populateId.length>160)||populate===undefined&&populateId!==null)throw new AppError('INVALID');
 if(access?.formatVersion!==3)throw new AppError('ACCESS_FORMAT');authenticateKeyring(access,vault);validateNotebook(book);
 if(book.projects.length!==1||book.projects[0].parentId!=null||book.notebooks.length!==1||book.notebooks[0].id!==labBookId||book.notebooks[0].projectId!==book.projects[0].id)throw new AppError('INVALID');
 const root=await resolveLocation(input);requireStorageName(root,book.notebooks[0].title);
 const storage=new LabBookStorage(root,labBookId,vault),fingerprint=digest(serialize({labBookId,book,...(populateId===null?{}:{populateId})})),intentFile=path.join(root,intentName),marker=path.join(root,'.observanda','copy-in-progress');
 if(!await assertRegular(root,{directory:true,missing:true})){
  await probeLocation(root);await mkdir(root,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});await assertRegular(root,{directory:true});
 }
 const internal=await privateDirectory(root,'.observanda');
 return withWriterLease(path.join(internal,'lab-book-initialization.lock'),async()=>{
  const intentStat=await assertRegular(intentFile,{missing:true});
  if(intentStat){
   if(intentStat.size>1024)throw new AppError('FORMAT');let intent;
   try{intent=JSON.parse(await storage.readFile(intentFile,'utf8'));}catch(error){if(error instanceof SyntaxError)throw new AppError('FORMAT');throw error;}
   if(!intent||Object.keys(intent).sort().join()!=='fingerprint,labBookId,version'||intent.version!==1||intent.labBookId!==labBookId||intent.fingerprint!==fingerprint)throw new AppError('CONFLICT');
  }else{
   const existing=await catalogueBinding(root);
   if(existing){
    if(existing.placement!=='lab-book'||existing.labBookId!==labBookId)throw new AppError('EXISTS');
    authenticateKeyring((await readAccess(root)).value,vault);
    if((await storage.catalogue(store=>store.object(receiptName)))?.fingerprint!==fingerprint||await assertRegular(marker,{missing:true}))throw new AppError('EXISTS');
    return storage;
   }
   if((await readdir(root)).some(name=>name!=='.observanda')||(await readdir(internal)).some(name=>name!=='lab-book-initialization.lock'))throw new AppError('EXISTS');
   await storage.writeFile(intentFile,serialize({version:1,labBookId,fingerprint}));
  }
  await atomicWrite(marker,'initializing lab book\n');const savedAccess=await readAccess(root);
  if(savedAccess.etag==='none')await atomicWrite(path.join(internal,'access.json'),serialize(access));else authenticateKeyring(savedAccess.value,vault);
  const binding=await catalogueBinding(root),db=await storage.openCatalogue({create:!binding}),descriptor=catalogueDescriptor(book),afterCommit=[];
  try{
   await db.run('BEGIN');await db.lock();
   await db.scope(()=>catalogueContext.run({root,labBookId,vault,db,afterCommit},async()=>{
    const store=storage.catalogueStore(db),head=await db.get("SELECT 1 FROM state WHERE slot='head'");
    if(!head){await store.put(book);await withProjectModuleInitialization(store,book.id,async()=>{});if(populate)await populate(storage);await store.putObject(receiptName,{fingerprint});}
    else if((await store.object(receiptName))?.fingerprint!==fingerprint)throw new AppError('CONFLICT');
    await store.verify(descriptor);
   }));
   await db.run('COMMIT');const file=await workspaceFile(root,{secure:true});
   if(await assertRegular(file,{missing:true})){if(await storage.readFile(file,'utf8')!==serialize(descriptor))throw new AppError('CATALOGUE_DAMAGED');}
   else await storage.writeFile(file,serialize(descriptor));
   for(const operation of afterCommit)await operation();await unlink(marker);await unlink(intentFile);return storage;
  }finally{await db.close();}
 });
}
