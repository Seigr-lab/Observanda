import {hasCatalogue} from './postgres.js';
// Capture adoption authority with the workspace snapshot. Only completed local
// adoptions may continue cleanup through the copied registry's new locations.
import path from 'node:path';
import {opendir} from 'node:fs/promises';
import {ProjectSourceAuthority,validProjectSourceAuthority} from './project-source-authority.js';
import {ProjectAdoptionReceipt} from './project-adoption-receipt.js';
import {ProjectRegistry} from './project-registry.js';
import {ProjectConversionJournal,projectCleanupIntent} from './project-conversion-journal.js';
import {retainCopiedProjectCommand} from './workspace-project-continuations.js';
import {assertRegular,digest,serialize} from './storage.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const matches=(a,b)=>['projectId','namespaceId','vaultId'].every(key=>a[key]===b[key]);
export async function copyProjectAdoptions(source,directory){
 const registry=new ProjectRegistry(source,directory.value.workspaceId);
 if((await registry.read()).revision!==directory.revision)throw new AppError('CONFLICT');
 if(!await hasCatalogue(source.root))return [];
 return source.catalogue(async store=>{
  const prefix='project-source-authority:project:',adoptions=[],owners=new Map(directory.value.projects.map(entry=>[entry.projectId,entry])),deleted=new Map([...(directory.value.deleted??[]),...(directory.value.relocated??[])].map(entry=>[entry.projectId,entry]));
  for await(const row of store.db.rows('SELECT slot,payload FROM state WHERE slot COLLATE "C">=$1 AND slot COLLATE "C"<$2 ORDER BY slot COLLATE "C"',[prefix,prefix+'~'],{batchSize:32})){
   const projectId=row.slot.slice(prefix.length),receipt=store.decode('state',row.slot,row.payload),entry=owners.get(projectId),owner=entry??deleted.get(projectId);
   if(!validProjectSourceAuthority(receipt)||receipt.projectId!==projectId)throw new AppError('CATALOGUE_DAMAGED');
   if(!owner||!matches(receipt,owner))throw new AppError('STORAGE_PROJECT_BUSY');
   if(!entry)continue;
   const saved=await new ProjectAdoptionReceipt(source,{projectId,root:entry.root,vault:{id:entry.vaultId}},receipt.operationId).saved(),completion=await source.readMetadata('.observanda/project-adopted/'+receipt.operationId+'.json',4096);
   let completed;try{completed=completion&&JSON.parse(completion);}catch{throw new AppError('FORMAT');}
   if(!saved||serialize(saved.receipt)!==serialize(receipt)||completed?.version!==1||completed.fingerprint!==digest(serialize(saved)))throw new AppError('STORAGE_PROJECT_BUSY');
   adoptions.push(receipt);
  }
  if((await registry.read()).revision!==directory.revision)throw new AppError('CONFLICT');return adoptions;
 });
}
export async function reconcileCopiedProjectConversions(target,workspaceId,adoptions,id,options={}){
 const registry=new ProjectRegistry(target,workspaceId),conversion=new ProjectConversionJournal(registry),directory=path.join(target.root,'.observanda/project-conversions'),copied=await registry.read(),owners=new Map(copied.value.projects.map(entry=>[entry.projectId,entry])),proofs=new Map(adoptions.map(receipt=>[receipt.projectId,receipt]));
 for(const receipt of adoptions){
  const entry=owners.get(receipt.projectId);if(!entry||!matches(entry,receipt))throw new AppError('STORAGE_COPY');
  const file=path.join(target.root,'.observanda/project-adoption-operations',receipt.projectId+'.obsv'),stat=await assertRegular(file,{missing:true});if(!stat)continue;
  if(stat.size>32768)throw new AppError('STORAGE_COPY');let command;
  try{command=JSON.parse(await target.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_COPY');}
  if(Object.keys(command??{}).sort().join()!=='id,phase,projectId,version'||command.version!==1||command.projectId!==receipt.projectId||command.id!==receipt.operationId||!['adopting','complete'].includes(command.phase))throw new AppError('STORAGE_COPY');
  // The captured catalogue already proved completion. The journal write may
  // have lagged behind that commit when this snapshot copied the control file.
  if(command.phase!=='complete')await target.writeFile(file,serialize({...command,phase:'complete'}));
 }
 if(!await assertRegular(directory,{directory:true,missing:true}))return;
 for await(const item of await opendir(directory)){
  if(!item.name.endsWith('.obsv')||!researchId(item.name.slice(0,-5)))continue;
  const saved=await conversion.read(item.name.slice(0,-5));if(!saved||saved.complete)continue;
  const {value}=saved,receipt=proofs.get(value.projectId),entry=owners.get(value.projectId);
  if(receipt){
   if(!entry||!matches(receipt,entry)||!matches(value,entry)||value.id!==receipt.operationId)throw new AppError('STORAGE_COPY');
   await target.writeFile(saved.file,serialize(projectCleanupIntent(value)));
  }else{
   if(entry||value.phase!=='prepared')throw new AppError('STORAGE_COPY');
   // Remove the intent last so every interrupted projection can discover
   // and finish removing its remaining pointers before publication.
   for(const relative of [`.observanda/project-adoption-operations/${value.projectId}.obsv`,`.observanda/project-adoptions/${value.id}.obsv`,`.observanda/project-conversions/project-${value.projectId}.obsv`,`.observanda/project-conversions/${value.id}.obsv`])await retainCopiedProjectCommand(target,id,'adoption',relative,options);
  }
 }
}

// Current copies retain the native directory pin and the already copied source
// authority rows. No growing adoption list is duplicated in the copy receipt.
async function withNativeCopyAdoptions(owner,pin,{current=false}={},operation){
 const {withWorkspaceCopyDirectory}=await import('./workspace-copy-directory.js');
 const registry=new ProjectRegistry(owner,pin.head.ownerId);
 if(current&&await registry.version()!==pin.revision)throw new AppError('CONFLICT');
 const result=await withWorkspaceCopyDirectory(owner,pin,view=>owner.catalogue(store=>operation(store,view)));
 if(current&&await registry.version()!==pin.revision)throw new AppError('CONFLICT');return result;
}
async function* nativeAdoptions(owner,store,view){
 const prefix='project-source-authority:project:';
 for await(const row of store.db.rows('SELECT slot,payload FROM state WHERE slot COLLATE "C">=$1 AND slot COLLATE "C"<$2 ORDER BY slot COLLATE "C"',[prefix,prefix+'~'],{batchSize:32})){
  const projectId=row.slot.slice(prefix.length),receipt=store.decode('state',row.slot,row.payload),selected=await view.get(projectId);
  if(!validProjectSourceAuthority(receipt)||receipt.projectId!==projectId)throw new AppError('CATALOGUE_DAMAGED');
  if(!selected||!matches(receipt,selected.entry))throw new AppError('STORAGE_PROJECT_BUSY');
  if(selected.state!=='active')continue;
  const entry=selected.entry,saved=await new ProjectAdoptionReceipt(owner,{projectId,root:entry.root,vault:{id:entry.vaultId}},receipt.operationId).saved();
  const completion=await owner.readMetadata('.observanda/project-adopted/'+receipt.operationId+'.json',4096);let completed;
  try{completed=completion&&JSON.parse(completion);}catch{throw new AppError('FORMAT');}
  if(!saved||serialize(saved.receipt)!==serialize(receipt)||completed?.version!==1||completed.fingerprint!==digest(serialize(saved)))throw new AppError('STORAGE_PROJECT_BUSY');
  yield receipt;
 }
}
export function validateNativeCopyAdoptions(owner,directoryPin,options={}){
 return withNativeCopyAdoptions(owner,directoryPin,options,async(store,view)=>{for await(const receipt of nativeAdoptions(owner,store,view))void receipt;});
}
export function reconcileNativeCopiedProjectConversions(target,directoryPin,id,options={}){
 return withNativeCopyAdoptions(target,directoryPin,{},async(store,view)=>{
  const registry=new ProjectRegistry(target,directoryPin.head.ownerId),conversion=new ProjectConversionJournal(registry),directory=path.join(target.root,'.observanda/project-conversions');
  for await(const receipt of nativeAdoptions(target,store,view)){
   const file=path.join(target.root,'.observanda/project-adoption-operations',receipt.projectId+'.obsv'),stat=await assertRegular(file,{missing:true});if(!stat)continue;
   if(stat.size>32768)throw new AppError('STORAGE_COPY');let command;
   try{command=JSON.parse(await target.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_COPY');}
   if(Object.keys(command??{}).sort().join()!=='id,phase,projectId,version'||command.version!==1||command.projectId!==receipt.projectId||command.id!==receipt.operationId||!['adopting','complete'].includes(command.phase))throw new AppError('STORAGE_COPY');
   if(command.phase!=='complete')await target.writeFile(file,serialize({...command,phase:'complete'}));
  }
  if(!await assertRegular(directory,{directory:true,missing:true}))return;
  const authority=new ProjectSourceAuthority(store);
  for await(const item of await opendir(directory)){
   if(!item.name.endsWith('.obsv')||!researchId(item.name.slice(0,-5)))continue;
   const saved=await conversion.read(item.name.slice(0,-5));if(!saved||saved.complete)continue;
   const {value}=saved,selected=await view.get(value.projectId),entry=selected?.state==='active'?selected.entry:null,receipt=entry?await authority.receipt(value.projectId):null;
   if(receipt){
    if(!matches(receipt,entry)||!matches(value,entry)||value.id!==receipt.operationId)throw new AppError('STORAGE_COPY');
    await target.writeFile(saved.file,serialize(projectCleanupIntent(value)));
   }else{
    if(entry||value.phase!=='prepared')throw new AppError('STORAGE_COPY');
    for(const relative of [
     '.observanda/project-adoption-operations/'+value.projectId+'.obsv',
     '.observanda/project-adoptions/'+value.id+'.obsv',
     '.observanda/project-conversions/project-'+value.projectId+'.obsv',
     '.observanda/project-conversions/'+value.id+'.obsv'
    ])await retainCopiedProjectCommand(target,id,'adoption',relative,options);
   }
  }
 });
}
