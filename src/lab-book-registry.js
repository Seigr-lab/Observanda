import {OwnerDirectoryRegistry} from './owner-directory-registry.js';
// A project holds only the location and identity of each independently owned
// lab book. Relative directory names travel with the containing project.
import path from 'node:path';
import {realpath} from 'node:fs/promises';
import {catalogueBinding} from './postgres-activation.js';
import {readAccess} from './access.js';
import {researchId} from './web/research-reference.js';
import {storageCreationPath,requireStorageName,validateStorageName} from './storage-names.js';
import {AppError} from './errors.js';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.slice().sort().join();
const nameKey=name=>process.platform==='win32'||process.platform==='darwin'?name.normalize('NFC').toLowerCase():name;
export class LabBookRegistry{
 constructor(project){
  if(!researchId(project?.projectId)||project.labBookId!==undefined)throw new AppError('INVALID');
  this.project=project;this.file=path.join(project.root,'.observanda','lab-books.observanda');this.directoryOwner=new OwnerDirectoryRegistry({storage:project,kind:'books',ownerId:project.projectId,file:this.file,decode:value=>this.validate(value),empty:()=>({version:1,projectId:project.projectId,books:[],deleted:[]}),validate:value=>this.validate(value)});
 }
 validate(value){
  if(!exact(value,['version','projectId','books','deleted',...(value?.version===2?['relocated']:[])])||![1,2].includes(value.version)||value.projectId!==this.project.projectId||!Array.isArray(value.books)||!Array.isArray(value.deleted))throw new AppError('FORMAT');
  const ids=new Set(),names=new Set(),namespaces=new Set(),vaults=new Set();
  for(const entry of value.books){
   if(!exact(entry,['labBookId','directory','namespaceId','vaultId'])||![entry.labBookId,entry.namespaceId,entry.vaultId].every(researchId))throw new AppError('FORMAT');
   validateStorageName(entry.directory,{nameError:'FORMAT'});
   if(entry.directory.toLowerCase()==='.observanda'||names.has(nameKey(entry.directory))||ids.has(entry.labBookId)||namespaces.has(entry.namespaceId)||vaults.has(entry.vaultId))throw new AppError('FORMAT');
   ids.add(entry.labBookId);names.add(nameKey(entry.directory));namespaces.add(entry.namespaceId);vaults.add(entry.vaultId);
  }
  for(const entry of value.deleted){
   if(!exact(entry,['labBookId','namespaceId','vaultId','operationId'])||!Object.values(entry).every(researchId)||ids.has(entry.labBookId)||namespaces.has(entry.namespaceId)||vaults.has(entry.vaultId))throw new AppError('FORMAT');
   ids.add(entry.labBookId);namespaces.add(entry.namespaceId);vaults.add(entry.vaultId);
  }
  if(value.version===2){
   if(!Array.isArray(value.relocated))throw new AppError('FORMAT');
   for(const entry of value.relocated){
    if(!exact(entry,['labBookId','namespaceId','vaultId','operationId','projectId'])||!Object.values(entry).every(researchId)||entry.projectId===this.project.projectId||ids.has(entry.labBookId)||namespaces.has(entry.namespaceId)||vaults.has(entry.vaultId))throw new AppError('FORMAT');
    ids.add(entry.labBookId);namespaces.add(entry.namespaceId);vaults.add(entry.vaultId);
   }
  }
  return value;
 }
 inspect(operation,options){return this.directoryOwner.inspect(operation,options);}
 version(){return this.directoryOwner.version();}
 state(id,options){if(!researchId(id)&&options?.index!=='location')throw new AppError('INVALID');return this.directoryOwner.state(id,options);}
 apply(expected,changes,options){return this.directoryOwner.apply(expected,changes,options);}
 applyBatch(expected,changes,options){return this.directoryOwner.applyBatch(expected,changes,options);}
 read(){return this.directoryOwner.read();}
 change(expected,edit,options){return this.directoryOwner.change(expected,edit,options);}
 location(entry){return {...entry,root:storageCreationPath(this.project.root,entry.directory)};}
 async describe(storage,{staged=false}={}){
  if(!researchId(storage.labBookId)||storage.projectId!==undefined)throw new AppError('INVALID');
  const [root,parent,binding,access]=await Promise.all([realpath(storage.root),realpath(this.project.root),catalogueBinding(storage.root),readAccess(storage.root)]);
  if(path.dirname(root)!==parent||binding?.placement!=='lab-book'||binding.labBookId!==storage.labBookId||access.value.formatVersion!==3||access.value.vaultId!==storage.vault?.id)throw new AppError('DATABASE_LOCATION');
  const metadata=staged?await storage.catalogue(async store=>(await store.snapshot()).metadata):(await storage.outline()).metadata,book=metadata.notebooks.find(item=>item.id===storage.labBookId);
  if(!book||book.projectId!==this.project.projectId)throw new AppError('DATABASE_LOCATION');
  requireStorageName(root,book.title);
  return {labBookId:storage.labBookId,directory:path.basename(root),namespaceId:metadata.id,vaultId:storage.vault.id};
 }
 async attach(storage,{expected}={}){
  const entry=await this.describe(storage);return this.apply(expected,[{state:'active',entry}],{check:async(directory,head)=>{if(await directory.find(head,entry.labBookId))throw new AppError('EXISTS');}});
 }
 async retire(entry,operationId){
  if(!researchId(operationId))throw new AppError('INVALID');
  for(let attempt=0;;attempt++){
   const current=await this.state(entry.labBookId);if(current.state==='deleted'){if(current.entry.operationId!==operationId||current.entry.namespaceId!==entry.namespaceId||current.entry.vaultId!==entry.vaultId)throw new AppError('CONFLICT');return;}
   if(current.state!=='active'||['directory','namespaceId','vaultId'].some(key=>current.entry[key]!==entry[key]))throw new AppError('CONFLICT');
   try{return await this.apply(current.revision,[{state:'deleted',entry:{labBookId:entry.labBookId,namespaceId:entry.namespaceId,vaultId:entry.vaultId,operationId}}]);}catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
  }
 }
 async locate(labBookId){
  const current=await this.state(labBookId);if(current.state!=='active'){if(current.state==='relocated'){const error=new AppError('LAB_BOOK_MOVED');error.projectId=current.entry.projectId;error.labBookId=labBookId;throw error;}throw new AppError('NOT_FOUND');}return this.location(current.entry);
 }
 async namespace(namespaceId){const current=await this.state(namespaceId,{index:'namespace'});if(current.state!=='active')throw new AppError('NOT_FOUND');return this.location(current.entry);}
 async list({after=null,limit=50,revision=null}={}){
  if(after!==null&&!researchId(after)||!Number.isSafeInteger(limit)||limit<1||limit>100||revision!==null&&typeof revision!=='string')throw new AppError('INVALID');
  return this.inspect(async view=>{if(revision!==null&&revision!==view.revision)throw new AppError('CONFLICT');const page=await view.page({after,limit});return {revision:view.revision,items:page.items.map(row=>this.location(row.entry)),next:page.next,total:page.total};});
 }
}
