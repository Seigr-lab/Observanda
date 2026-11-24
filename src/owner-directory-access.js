// The registry file holds only a marker naming the indexed owner directory.
// Until the first directory write the file is absent and the directory is
// empty; that write creates the index and then the marker. Whole registry
// envelopes were written only before the first release and are refused.
import path from 'node:path';
import {AppError} from './errors.js';
import {catalogueConnection} from './catalogue-connections.js';
import {assertRegular,privateDirectory} from './storage.js';
import {digest,serialize} from './storage-format.js';
import {withWriterLease,writerLeaseHeld} from './writer-lease.js';
import {projectDomainHandoff,projectDomainLock} from './project-domain-lock.js';
import {projectHierarchyLock} from './project-hierarchy-authority.js';
import {NativeOwnerDirectory} from './owner-directory.js';
import {ownerDirectoryMarker,ownerDirectoryMarkerVersion,validOwnerDirectoryMarker} from './owner-directory-model.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const receipt=head=>digest(serialize(head.receipt));
export class OwnerDirectoryAccess{
 constructor({storage,kind,ownerId,file,empty}){Object.assign(this,{storage,kind,ownerId,file,empty});this.lease=path.join(path.dirname(file),kind==='projects'?'project-registry.lock':'lab-books.lock');}
 async envelope(){
  await this.storage.requireStorageKey();await assertRegular(path.dirname(this.file),{directory:true});const stat=await assertRegular(this.file,{missing:true});
  if(!stat)return {raw:null,value:this.empty(),revision:'new',marker:null};
  if(stat.size>16*1024*1024)throw new AppError('LIMIT');const raw=await this.storage.readFile(this.file,'utf8');let value;try{value=JSON.parse(raw);}catch{throw new AppError('FORMAT');}
  if(value?.version===ownerDirectoryMarkerVersion(this.kind)){
   if(!validOwnerDirectoryMarker(value,this.kind,this.ownerId)||Buffer.byteLength(raw)>4096)throw new AppError('FORMAT');return {marker:value,raw};
  }
  throw new AppError('ACCESS_UPGRADE');
 }
 async current(store,marker){
  const directory=new NativeOwnerDirectory(store,{kind:this.kind,ownerId:this.ownerId}),current=await directory.head({required:true});
  if(receipt(current.value)!==marker.ownerDirectory.receipt)damaged();return {directory,...current};
 }
 async read(operation){
  const envelope=await this.envelope();if(!envelope.marker)return operation({legacy:envelope});
  return this.storage.catalogue(async store=>operation(await this.current(store,envelope.marker)));
 }
 async revision(){
  const envelope=await this.envelope();if(!envelope.marker)return envelope.revision;
  // A directory admission must see a fresh head even inside a retained read.
  // Reuse only its connection, in a queue separate from that caller's snapshot.
  return catalogueConnection(this.storage,'owner-directory-read',{},async db=>{
   await db.run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   try{const current=await this.current(this.storage.catalogueStore(db),envelope.marker);await db.run('COMMIT');return current.revision;}
   catch(error){await db.run('ROLLBACK').catch(()=>{});throw error;}
  });
 }
 async transaction(operation){
  const db=await this.storage.openCatalogue();try{
   await db.run('BEGIN');await projectDomainHandoff(db,{shared:true});await projectDomainLock(db,'Observanda/owner-directory/'+db.id);if(this.kind==='projects')await projectHierarchyLock(db);
   await this.storage.requireStorageKey();const result=await operation(this.storage.catalogueStore(db));await db.run('COMMIT');return result;
  }catch(error){await db.run('ROLLBACK').catch(()=>{});throw error;}finally{await db.close();}
 }
 async write(expected,operation,{checkpoint=async()=>{}}={}){
  if(typeof expected!=='string')throw new AppError('INVALID');await privateDirectory(this.storage.root,'.observanda');
  const execute=async()=>{
   let envelope=await this.envelope(),base;
   if(envelope.marker){base=await this.storage.catalogue(store=>this.current(store,envelope.marker));if(base.revision!==expected)throw new AppError('CONFLICT');}
   else{
    if(envelope.revision!==expected)throw new AppError('CONFLICT');
    const candidate=await this.transaction(async store=>{
     const directory=new NativeOwnerDirectory(store,{kind:this.kind,ownerId:this.ownerId}),prior=await directory.head();
     if(prior&&prior.value.receipt.legacyDigest==='new')return prior;
     const metadata=(await store.snapshot()).metadata,legacy=metadata.projects.map(value=>({projectId:value.id,parentId:value.parentId??null}));
     return directory.initialize({entries:[],legacy});
    });
    await checkpoint('candidate');const marker=ownerDirectoryMarker(this.kind,this.ownerId,receipt(candidate.value));
    await this.storage.writeFile(this.file,serialize(marker));await checkpoint('marker');envelope={marker};base=candidate;
   }
   return this.transaction(async store=>{
    const current=await this.current(store,envelope.marker);if(current.revision!==base.revision)throw new AppError('CONFLICT');
    return operation(current.directory,current.value,current.revision,store);
   });
  };
  return writerLeaseHeld(this.lease)?execute():withWriterLease(this.lease,execute);
 }
}
