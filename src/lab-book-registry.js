// A project holds only the location and identity of each independently owned
// lab book. Relative directory names travel with the containing project.
import path from 'node:path';
import {realpath} from 'node:fs/promises';
import {assertRegular,privateDirectory,digest,serialize} from './storage.js';
import {withWriterLease,writerLeaseHeld} from './writer-lease.js';
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
  this.project=project;this.file=path.join(project.root,'.observanda','lab-books.observanda');
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
 async read(){
  await this.project.requireStorageKey();
  const checks=await Promise.allSettled([assertRegular(path.dirname(this.file),{directory:true}),assertRegular(this.file,{missing:true})]);
  for(const check of checks)if(check.status==='rejected')throw check.reason;
  const stat=checks[1].value;if(!stat)return {value:{version:1,projectId:this.project.projectId,books:[],deleted:[]},revision:'new'};
  if(stat.size>16*1024*1024)throw new AppError('LIMIT');const raw=await this.project.readFile(this.file,'utf8');let value;
  try{value=JSON.parse(raw);}catch{throw new AppError('FORMAT');}
  return {value:this.validate(value),revision:digest(raw)};
 }
 async change(expected,edit){
  if(typeof expected!=='string'||typeof edit!=='function')throw new AppError('INVALID');
  const directory=await privateDirectory(this.project.root,'.observanda');
  const file=path.join(directory,'lab-books.lock'),change=async()=>{
   const current=await this.read();if(current.revision!==expected)throw new AppError('CONFLICT');
   const editable=structuredClone(current.value);editable.version=2;editable.relocated??=[];
   const value=this.validate(edit(editable)),raw=serialize(value);
   if(Buffer.byteLength(raw)>16*1024*1024-128)throw new AppError('LIMIT');
   await this.project.writeFile(this.file,raw);return {value,revision:digest(raw)};
  };return writerLeaseHeld(file)?change():withWriterLease(file,change);
 }
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
  const entry=await this.describe(storage);
  return this.change(expected,value=>{if(value.books.some(book=>book.labBookId===entry.labBookId))throw new AppError('EXISTS');value.books.push(entry);return value;});
 }
 async retire(entry,operationId){
  if(!researchId(operationId))throw new AppError('INVALID');
  for(let attempt=0;;attempt++){
   const current=await this.read(),prior=current.value.books.find(book=>book.labBookId===entry.labBookId),gone=current.value.deleted.find(book=>book.labBookId===entry.labBookId);
   if(gone){if(gone.operationId!==operationId||gone.namespaceId!==entry.namespaceId||gone.vaultId!==entry.vaultId)throw new AppError('CONFLICT');return;}
   if(!prior||['directory','namespaceId','vaultId'].some(key=>prior[key]!==entry[key]))throw new AppError('CONFLICT');
   try{return await this.change(current.revision,value=>({...value,books:value.books.filter(book=>book.labBookId!==entry.labBookId),deleted:[...value.deleted,{labBookId:entry.labBookId,namespaceId:entry.namespaceId,vaultId:entry.vaultId,operationId}]}));}
   catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
  }
 }
 async locate(labBookId){
  if(!researchId(labBookId))throw new AppError('INVALID');const {value}=await this.read();
  const entry=value.books.find(book=>book.labBookId===labBookId);if(!entry){const moved=value.relocated?.find(book=>book.labBookId===labBookId);if(moved){const error=new AppError('LAB_BOOK_MOVED');error.projectId=moved.projectId;error.labBookId=labBookId;throw error;}throw new AppError('NOT_FOUND');}return this.location(entry);
 }
 async namespace(namespaceId){
  if(!researchId(namespaceId))throw new AppError('INVALID');const {value}=await this.read();
  const entry=value.books.find(book=>book.namespaceId===namespaceId);if(!entry)throw new AppError('NOT_FOUND');return this.location(entry);
 }
 async list({after=null,limit=50,revision=null}={}){
  if(after!==null&&!researchId(after)||!Number.isSafeInteger(limit)||limit<1||limit>100||revision!==null&&typeof revision!=='string')throw new AppError('INVALID');
  const current=await this.read();if(revision!==null&&revision!==current.revision)throw new AppError('CONFLICT');
  const entries=current.value.books.filter(entry=>after===null||entry.labBookId>after).sort((a,b)=>a.labBookId<b.labBookId?-1:1),selected=entries.slice(0,limit);
  return {revision:current.revision,items:selected.map(entry=>this.location(entry)),next:entries.length>limit?selected.at(-1).labBookId:null,total:current.value.books.length};
 }
}
