import {ScopedCopyGrants} from './scoped-copy-grants.js';
// Temporary admissions retain session identity proofs. Renames retain existing
// grants; copies retain authenticated grants. Keys are borrowed per owner.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {withScratch} from './scratch-work.js';
import {ProjectSessionOwner} from './project-session-owner.js';
import {LabBookLocationAccess} from './lab-book-location-access.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {ProjectStorage} from './project-storage.js';
import {LabBookStorage} from './lab-book-storage.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {clearVault} from './encryption.js';
import {researchId} from './web/research-reference.js';
import {nativeRelocationOwners} from './native-relocation-state.js';
import {locateProjectRename} from './project-rename-receipt.js';
import {workspaceRename} from './workspace-rename-state.js';
import {AppError} from './errors.js';
const identities=new WeakMap();
const identity=value=>{if(!value)return null;let id=identities.get(value);if(!id){id=randomUUID();identities.set(value,id);}return id;};
const live=value=>!value?.locked&&(!value?.vault||value.expires>Date.now());
export class ScopedLocationAccess{
 static run(application,client,options,operation){return withScratch(proofs=>withScratch(grants=>{const access=new ScopedLocationAccess(application,client,options,proofs,grants);return access.start(operation);}));}
 constructor(application,client,{check=async()=>{},parent=()=>null,recoverRenames=true,skipRenameId=null,copy=false}={},proofs,grants){Object.assign(this,{application,client,baseCheck:check,parent,recoverRenames,skipRenameId,proofs,grants});this.session=application.session(client);this.parents=new AsyncLocalStorage();if(copy)this.copy=new ScopedCopyGrants(this,{identity,live});}
 async start(operation){for(const [id,saved] of this.session)if(saved?.vault&&live(saved))await this.proofs.add(id,{id,token:identity(saved),admitted:false});try{return await operation(this);}finally{this.closed=true;}}
 async remember(id,expected){const prior=await this.proofs.get(id),token=identity(expected);if(prior?.admitted&&prior.token!==token)throw new AppError('ACCESS_LOCKED');await this.proofs.put(id,{...(prior?.admitted?prior:{}),id,token,admitted:true});}
 valid(proof){const saved=this.session.get(proof.id);return identity(saved)===proof.token&&live(saved);}
 async check(owner){
  await this.baseCheck();if(this.closed||this.application.closed)throw new AppError('ACCESS_LOCKED');
  const check=proof=>{if(proof?.admitted&&!this.valid(proof)){const error=new AppError('ACCESS_LOCKED'),parts=proof.id.split(':');error.projectId=parts[0]==='book'?parts[1]:proof.id;if(parts[0]==='book')error.labBookId=parts[2];throw error;}};
  if(owner){const projectId=owner.projectId;check(await this.proofs.get(projectId));if(owner.labBookId)check(await this.proofs.get('book:'+projectId+':'+owner.labBookId));}
  else for await(const proof of this.proofs.items())check(proof);
 }
 async withProject(id,operation){
  if(this.copy?.sealed)throw new AppError('ACCESS_LOCKED');
  const owner=new ProjectSessionOwner(this.application,this.client,id,{check:this.baseCheck,recoverRenames:this.copy?.registry?false:this.recoverRenames,skipRenameId:this.skipRenameId,registry:()=>this.copy?.registry??this.application.registry()});
  try{return await this.parents.run(owner,()=>this.application.tracked(()=>owner.use(async storage=>{await this.remember(id,owner.sessionEntry);await this.copy?.admitProject(owner);return operation(storage);}),id));}
  catch(error){if(['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN'].includes(error.code))error.projectId??=id;throw error;}
  finally{await owner.close();}
 }
 async withBook(project,id,operation){
  if(this.copy?.sealed)throw new AppError('ACCESS_LOCKED');
  const parent=this.parents.getStore()??this.parent(project.projectId);if(!parent||parent.projectId!==project.projectId)throw new AppError('ACCESS_DENIED');
  await this.remember(project.projectId,parent.sessionEntry);const books=new LabBookLocationAccess(this.application,this.client);
  try{return await books.use(project,id,parent,operation,{retain:false,onOwner:async owner=>{await this.remember(owner.access.id,owner.access.expected);await this.copy?.admitBook(owner);}});}finally{books.close();}
 }
 async renamed(owners,source,destination){
  await this.check();this.owners=owners;this.source=source;this.destination=destination;
  for(const [id,saved] of this.session){
   if(!saved?.vault||!Buffer.isBuffer(saved.vault.key)||!live(saved))continue;const proof=await this.proofs.get(id);if(!proof||!this.valid(proof))continue;
   const parts=id.split(':'),book=parts.length===3&&parts[0]==='book',projectId=book?parts[1]:id,ownerId=book?parts[2]:id;if(!researchId(projectId)||!researchId(ownerId))continue;
   const item=await owners.find(book?'identity':'project',ownerId);if(!item||item.kind!==(book?'lab-book':'project')||item.projectId!==projectId||item.vaultId!==saved.vault.id)continue;
   const from=path.resolve(source,...item.relative.split('/')),root=path.resolve(destination,...item.relative.split('/'));if(![from,root].includes(saved.root))continue;
   const parent=book?await owners.find('project',projectId):null;if(book&&(!parent||path.dirname(root)!==path.resolve(destination,...parent.relative.split('/'))))throw new AppError('STORAGE_RENAME_STATE');
   const access=await readAccess(root);if(access.etag!==saved.etag)continue;authenticateKeyring(access.value,saved.vault);
   const storage=book?new LabBookStorage(root,ownerId,saved.vault):new ProjectStorage(root,ownerId,saved.vault);if((await storage.outline()).metadata.id!==item.namespaceId)throw new AppError('DATABASE_LOCATION');
   if(!this.valid(proof))continue;const parentProof=book?await this.proofs.get(projectId):null;if(parentProof&&!this.valid(parentProof))continue;
   await this.grants.put(id,{id,kind:item.kind,projectId,ownerId,root,namespaceId:item.namespaceId,vaultId:item.vaultId,etag:access.etag,expires:saved.expires,token:proof.token,parentToken:book?identity(this.session.get(projectId)):null,key:saved.vault.key.toString('base64')});
  }
 }
 async adoptProjectRename(renames){
  const value=await renames.read(),scope=renames.scope(value);if(value.phase!=='complete'||await locateProjectRename(renames.registry,value)!==scope.destination||await workspaceRename(scope.destination))throw new AppError('STORAGE_RENAME_STATE');
  const owners=value.ownerDirectoryVersion===2?nativeRelocationOwners(renames.registry,value):{async find(index,id){const project=id===value.projectId?{...value,...value.rootBooks,relative:''}:value.projects?.find(item=>item.projectId===id);if(index==='project')return project?{...project,kind:'project'}:null;for(const item of [{...value,...value.rootBooks,relative:''},...(value.projects??[])]){const book=item.books?.find(book=>book.labBookId===id);if(book)return {...book,kind:'lab-book',projectId:item.projectId,relative:path.posix.join(item.relative,book.directory)};}return null;}};
  await this.renamed(owners,scope.source,scope.destination);await this.install();
 }
 async install(application=this.application,client=this.client){
  if(client!==this.client||this.closed||application.closed||!this.destination||application!==this.application&&application.workspace.root!==this.destination)throw new AppError('ACCESS_DENIED');const session=application.session(client),registry=await application.registry();
  await this.copy?.beginInstall(application,client,registry);
  try{for(const kind of ['project','lab-book'])for await(const grant of this.grants.items()){
   if(grant.kind!==kind)continue;this.copy?.assertGrant(grant);const proof={id:grant.id,token:grant.token},book=kind==='lab-book';if(!this.valid(proof)||grant.expires<=Date.now()||book&&(identity(this.session.get(grant.projectId))!==grant.parentToken||!live(this.session.get(grant.projectId))))continue;
   let entry;const vault={id:grant.vaultId,key:Buffer.from(grant.key,'base64')};
   try{
    if(book){const parent=new ProjectSessionOwner(application,client,grant.projectId,{recoverRenames:false});try{entry=await parent.use(storage=>new LabBookRegistry(storage).locate(grant.ownerId));}catch(error){if(['ACCESS_LOCKED','ACCESS_DENIED','DEVICE_UNKNOWN'].includes(error.code))continue;throw error;}finally{await parent.close();}}
    else entry=await registry.locate(grant.projectId);
    const access=await readAccess(entry.root);if(entry.root!==grant.root||entry.namespaceId!==grant.namespaceId||entry.vaultId!==grant.vaultId||access.etag!==grant.etag)throw new AppError('DATABASE_LOCATION');authenticateKeyring(access.value,vault);
    if(application.closed||!this.valid(proof)||grant.expires<=Date.now()||book&&(identity(this.session.get(grant.projectId))!==grant.parentToken||!live(this.session.get(grant.projectId))))continue;
    const current=session.get(grant.id);if(application===this.application){if(current!==this.session.get(grant.id)||!current?.vault)continue;current.root=grant.root;current.etag=grant.etag;current.expires=Math.min(current.expires,grant.expires);}
    else{if(current)throw new AppError('CONFLICT');const saved={root:grant.root,etag:grant.etag,vault:{id:vault.id,key:Buffer.from(vault.key)},expires:grant.expires};if(this.copy)await this.copy.installGrant(application,grant,saved);else{session.set(grant.id,saved);application.credentials.add(saved);}}
   }finally{clearVault(vault);}
  }await this.copy?.finishInstall(application,registry);}
  catch(error){await this.copy?.rollbackInstall(application);throw error;}
 }
}
