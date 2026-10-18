import {ProjectSessionOwner} from './project-session-owner.js';
import {LabBookRouter} from './lab-book-router.js';
import {labBookTransferReceipt} from './lab-book-transfer.js';
import {LabBookRenames} from './lab-book-rename.js';
import path from 'node:path';
import {LabBookAccessSession} from './lab-book-access-session.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {LabBookStorage} from './lab-book-storage.js';
import {ProjectStorage} from './project-storage.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {cloneVault,clearVault} from './encryption.js';
import {AppError} from './errors.js';
// Only the requesting session's authorized book grants travel through a
// verified parent rename. Recovery capabilities remain separate from grants.
export class LabBookLocationAccess{
 constructor(application,client){this.application=application;this.client=client;this.owners=new Map();this.grants=new Map();}
 captureRename(project,receipt,parent){
  const session=this.application.session(this.client);
  for(const item of project.books??[]){
   const id='book:'+project.projectId+':'+item.labBookId,saved=session.get(id),source=path.resolve(receipt.source,...project.relative.split('/'),item.directory),destination=path.resolve(receipt.destination,...project.relative.split('/'),item.directory);
   if(!saved?.vault||saved.locked||saved.expires<=Date.now()||saved.vault.id!==item.vaultId||![source,destination].includes(saved.root))continue;
   const access=new LabBookAccessSession(this.application,this.client,project,item.labBookId,()=>parent.check());
   this.owners.set(id,{projectId:project.projectId,id:item.labBookId,parent,entry:{root:source,namespaceId:item.namespaceId,vaultId:item.vaultId},access,etag:saved.etag,vault:cloneVault(saved.vault)});
  }
 }
 async use(project,id,parent,operation){
  return this.application.tracked(async()=>{
   const access=new LabBookAccessSession(this.application,this.client,project,id,()=>parent.check()),registry=new LabBookRegistry(project),renames=new LabBookRenames(project);let entry=await registry.locate(id),vault;
   try{
    const pending=await renames.pending(id),root=pending&&pending.phase!=='complete'?await renames.locate(pending):entry.root;
    vault=await access.key(root);await access.check();if(vault.id!==entry.vaultId)throw new AppError('DATABASE_LOCATION');
    if(pending){await this.application.jobs.invalidateBook(project.projectId,id);await renames.resume(id,vault,{check:()=>access.check()});entry=await registry.locate(id);}
    const previous=this.owners.get(access.id);clearVault(previous?.vault);
    this.owners.set(access.id,{projectId:project.projectId,id,parent,entry,access,etag:(await readAccess(entry.root)).etag,vault:cloneVault(vault)});
    const result=await new LabBookRouter(registry,{authorize:async()=>true,unlock:async()=>vault}).withLabBook(id,operation);await access.check();return result;
   }catch(error){access.error(error);if(error.labBookId)error.labBookName=entry.directory;throw error;}finally{clearVault(vault);}
  },project.projectId,id);
 }
 valid(owner){const saved=owner.access.expected;return owner.access.session.get(owner.access.id)===saved&&!saved?.locked&&(!saved?.vault||saved.expires>Date.now())&&owner.parent.session.get(owner.projectId)===owner.parent.sessionEntry&&!owner.parent.sessionEntry?.locked&&(!owner.parent.sessionEntry?.vault||owner.parent.sessionEntry.expires>Date.now());}
 async copied(storage){
  const receipt=await labBookTransferReceipt(storage),owner=[...this.owners.values()].find(item=>item.id===storage.labBookId&&item.entry.root===receipt?.source);
  if(!owner||!this.valid(owner)||receipt.phase!=='verified'||receipt.vaultId!==owner.vault.id||receipt.namespaceId!==owner.entry.namespaceId)throw new AppError('ACCESS_LOCKED');
  await owner.access.check();const access=await readAccess(storage.root);if(access.etag!==owner.etag)throw new AppError('ACCESS_LOCKED');authenticateKeyring(access.value,owner.vault);
  const id=owner.access.id;clearVault(this.grants.get(id)?.vault);this.grants.set(id,{root:storage.root,namespaceId:receipt.namespaceId,etag:access.etag,vault:cloneVault(owner.vault),expires:Math.min(owner.access.expected?.expires??Infinity,owner.parent.sessionEntry?.expires??Infinity,Date.now()+8*60*60*1000)});
 }
 // An interrupted move may have completed copying before this transfer session
 // opened. Recover only its caller's live explicit grants, never recovery keys.
 async moved(project,source,parent){
  const registry=new LabBookRegistry(project),current=await registry.read(),session=this.application.session(this.client);
  for(const book of current.value.books){
   const id='book:'+project.projectId+':'+book.labBookId;if(this.grants.has(id))continue;
   const saved=session.get(id),entry=registry.location(book),previous=path.join(source,book.directory);
   if(!saved?.vault||saved.locked||saved.expires<=Date.now()||saved.vault.id!==book.vaultId||![previous,entry.root].includes(saved.root))continue;
   const access=new LabBookAccessSession(this.application,this.client,project,book.labBookId,()=>parent.check());await access.check();
   const keyring=await readAccess(entry.root);if(keyring.etag!==saved.etag)continue;authenticateKeyring(keyring.value,saved.vault);
   const storage=new LabBookStorage(entry.root,book.labBookId,saved.vault),receipt=await labBookTransferReceipt(storage);
   if(receipt?.phase!=='verified'||receipt.source!==previous||receipt.vaultId!==book.vaultId||receipt.namespaceId!==book.namespaceId)throw new AppError('STORAGE_MOVE_STATE');
   await access.check();const owner={projectId:project.projectId,id:book.labBookId,parent,entry,access,etag:keyring.etag,vault:cloneVault(saved.vault)};
   clearVault(this.owners.get(id)?.vault);this.owners.set(id,owner);
   this.grants.set(id,{root:entry.root,namespaceId:book.namespaceId,etag:keyring.etag,vault:cloneVault(saved.vault),expires:Math.min(saved.expires,parent.sessionEntry?.expires??Infinity)});
  }
 }
 async renamed(receipt,source,destination){
  for(const [id,owner] of this.owners){
   if(!this.valid(owner))continue;const project=receipt.projects?.find(item=>item.projectId===owner.projectId),book=project?.books?.find(item=>item.labBookId===owner.id);
   if(!book||book.vaultId!==owner.vault.id||book.namespaceId!==owner.entry.namespaceId||path.resolve(source,...project.relative.split('/'),book.directory)!==owner.entry.root)throw new AppError('STORAGE_RENAME_STATE');
   const root=path.resolve(destination,...project.relative.split('/'),book.directory),access=await readAccess(root);if(access.etag!==owner.etag)throw new AppError('ACCESS_LOCKED');authenticateKeyring(access.value,owner.vault);
   const storage=new LabBookStorage(root,owner.id,owner.vault);if((await storage.outline()).metadata.id!==book.namespaceId)throw new AppError('DATABASE_LOCATION');
   clearVault(this.grants.get(id)?.vault);this.grants.set(id,{root,namespaceId:book.namespaceId,etag:access.etag,vault:cloneVault(owner.vault),expires:Math.min(owner.access.expected?.expires??Infinity,owner.parent.sessionEntry?.expires??Infinity,Date.now()+8*60*60*1000)});
  }
 }
 async install(application,client){
  if(client!==this.client||application.closed)throw new AppError('ACCESS_DENIED');
  const session=application.session(client),registry=await application.registry(),prepared=[];
  try{
   for(const [id,grant] of this.grants){
    const owner=this.owners.get(id);if(!this.valid(owner)||grant.expires<=Date.now())continue;
    const project=await registry.locate(owner.projectId),parent=session.get(owner.projectId);
    if(parent?.locked||parent?.vault&&(parent.root!==project.root||parent.expires<=Date.now()))continue;
    if(session.has(id))throw new AppError('CONFLICT');
    let entry;
    if(parent?.vault)entry=await new LabBookRegistry(new ProjectStorage(project.root,project.projectId,parent.vault)).locate(owner.id);
    else{
     // A book may have an explicit password grant while its parent uses the
     // device. Authenticate that parent normally; never create a parent grant
     // from a rename recovery key merely to retain the existing book grant.
     const selected=new ProjectSessionOwner(application,client,owner.projectId);
     try{entry=await selected.use(storage=>new LabBookRegistry(storage).locate(owner.id));}
     catch(error){if(['ACCESS_LOCKED','ACCESS_DENIED','DEVICE_UNKNOWN'].includes(error.code))continue;throw error;}
     finally{await selected.close();}
    }
    const access=await readAccess(entry.root);
    if(entry.root!==grant.root||entry.namespaceId!==grant.namespaceId||entry.vaultId!==grant.vault.id||access.etag!==grant.etag)throw new AppError('DATABASE_LOCATION');authenticateKeyring(access.value,grant.vault);
    prepared.push([id,{root:entry.root,etag:access.etag,vault:cloneVault(grant.vault),expires:grant.expires}]);
   }
   if(application.closed)throw new AppError('ACCESS_LOCKED');
   for(const [id,grant] of prepared){if(!this.valid(this.owners.get(id))||grant.expires<=Date.now()){clearVault(grant.vault);continue;}if(session.has(id))throw new AppError('CONFLICT');session.set(id,grant);application.credentials.add(grant);}
  }catch(error){for(const [id,grant] of prepared){if(session.get(id)===grant){session.delete(id);application.credentials.delete(grant);}clearVault(grant.vault);}throw error;}
 }
 relocateGrants(){
  const session=this.application.session(this.client);
  for(const [id,grant] of this.grants){
   const owner=this.owners.get(id);if(!this.valid(owner)||grant.expires<=Date.now())continue;
   const saved=session.get(id);
   if(saved?.vault){saved.root=grant.root;saved.etag=grant.etag;saved.expires=Math.min(saved.expires,grant.expires);}
   else{const value={root:grant.root,etag:grant.etag,vault:cloneVault(grant.vault),expires:grant.expires};session.set(id,value);this.application.credentials.add(value);}
  }
 }
 close(){for(const owner of this.owners.values())clearVault(owner.vault);for(const grant of this.grants.values())clearVault(grant.vault);this.owners.clear();this.grants.clear();}
}
