// Copy handoff grants use the scoped admission's encrypted scratch store.
// Only one borrowed key is decoded at a time; installed session grants retain
// their normal lifetime and are not a constant-memory collection.
import path from 'node:path';
import {Workspace,assertRegular} from './storage.js';
import {ProjectRegistry} from './project-registry.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {LabBookStorage} from './lab-book-storage.js';
import {projectTransferReceipt} from './project-transfer.js';
import {labBookTransferReceipt} from './lab-book-transfer.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {clearVault} from './encryption.js';
import {moveSource} from './workspace-move-state.js';
import {readMoveReceipt} from './workspace-move.js';
import {resolveLocation} from './locations.js';
import {AppError} from './errors.js';
const within=(parent,child)=>{const relative=path.relative(parent,child);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const maximumLifetime=8*60*60*1000;
export class ScopedCopyGrants{
 constructor(scope,{identity,live}){Object.assign(this,{scope,identity,live});}
 async admit(id,source,expires){
  const proof=await this.scope.proofs.get(id);if(!proof?.admitted||!this.scope.valid(proof))throw new AppError('ACCESS_LOCKED');
  if(proof.source){
   const previous=proof.source,grant=await this.scope.grants.get(id);
   if(['kind','projectId','ownerId','namespaceId','vaultId','etag'].some(key=>source[key]!==previous[key])||source.root!==previous.root&&source.root!==grant?.root)throw new AppError('ACCESS_LOCKED');
  }
  await this.scope.proofs.put(id,{...proof,source,expires:Math.min(proof.expires??Infinity,expires,Date.now()+maximumLifetime)});
 }
 admitProject(owner){const entry=owner.entry;return this.admit(owner.projectId,{kind:'project',projectId:owner.projectId,ownerId:owner.projectId,root:entry.root,namespaceId:entry.namespaceId,vaultId:entry.vaultId,etag:owner.etag},owner.sessionEntry?.expires??Infinity);}
 admitBook(owner){return this.admit(owner.access.id,{kind:'lab-book',projectId:owner.projectId,ownerId:owner.id,root:owner.entry.root,namespaceId:owner.entry.namespaceId,vaultId:owner.vault.id,etag:owner.etag},Math.min(owner.access.expected?.expires??Infinity,owner.parent.sessionEntry?.expires??Infinity));}
 async capture(storage,proof,receipt,{source=proof?.source?.root,moving=false}={}){
  const scope=this.scope,item=proof?.source;if(this.sealed||!item||!scope.valid(proof)||proof.expires<=Date.now())throw new AppError('ACCESS_LOCKED');
  const book=item.kind==='lab-book',id=book?storage.labBookId:storage.projectId,parent=book?await scope.proofs.get(item.projectId):null;
  if(book&&(!parent?.admitted||!scope.valid(parent)))throw new AppError('ACCESS_LOCKED');
  if(receipt?.phase!=='verified'||receipt.source!==source||receipt[book?'labBookId':'projectId']!==id||id!==item.ownerId||receipt.namespaceId!==item.namespaceId||receipt.vaultId!==item.vaultId||storage.vault?.id!==item.vaultId)throw new AppError('STORAGE_COPY');
  const access=await readAccess(storage.root);if(access.etag!==item.etag)throw new AppError('ACCESS_LOCKED');authenticateKeyring(access.value,storage.vault);
  if(!moving&&(await readAccess(item.root)).etag!==item.etag)throw new AppError('ACCESS_LOCKED');
  if(!scope.valid(proof)||book&&!scope.valid(parent))throw new AppError('ACCESS_LOCKED');
  await scope.grants.put(proof.id,{id:proof.id,kind:item.kind,projectId:item.projectId,ownerId:id,root:storage.root,namespaceId:item.namespaceId,vaultId:item.vaultId,etag:access.etag,expires:Math.min(proof.expires,parent?.expires??Infinity),token:proof.token,parentToken:parent?.token??null,key:storage.vault.key.toString('base64')});
 }
 async copiedProject(storage,options){const parent=this.scope.parents.getStore();if(!parent||parent.projectId!==storage.projectId)throw new AppError('ACCESS_DENIED');await parent.check();return this.capture(storage,await this.scope.proofs.get(storage.projectId),await projectTransferReceipt(storage),options);}
 async copiedBook(storage,{projectId=this.scope.parents.getStore()?.projectId,source,moving=false}={}){
  const scope=this.scope,id='book:'+projectId+':'+storage.labBookId,receipt=await labBookTransferReceipt(storage);let proof=await scope.proofs.get(id);
  if(!proof?.source){
   // A resumed transfer may hold recovery capabilities without this request
   // having authenticated the book. Recover only an existing client grant.
   const saved=scope.session.get(id);if(!saved?.vault?.key||!this.live(saved)||!proof||!scope.valid(proof)||![receipt?.source,storage.root].includes(saved.root))return;
   const access=await readAccess(storage.root);if(access.etag!==saved.etag||saved.vault.id!==receipt?.vaultId)throw new AppError('ACCESS_LOCKED');authenticateKeyring(access.value,saved.vault);
   await scope.remember(id,saved);await this.admit(id,{kind:'lab-book',projectId,ownerId:storage.labBookId,root:source??receipt.source,namespaceId:receipt.namespaceId,vaultId:saved.vault.id,etag:saved.etag},saved.expires);proof=await scope.proofs.get(id);
   return this.capture(new LabBookStorage(storage.root,storage.labBookId,saved.vault),proof,receipt,{source:source??receipt.source,moving:true});
  }
  return this.capture(storage,proof,receipt,{source:source??proof.source.root,moving});
 }
 async moved(storage,source,latest){
  const scope=this.scope,parent=scope.parents.getStore();if(!parent||parent.projectId!==storage.projectId||![source,storage.root].includes(parent.entry?.root)||latest.root!==storage.root)throw new AppError('ACCESS_DENIED');
  const receipt=await projectTransferReceipt(storage);if(receipt?.source!==source||receipt.phase!=='verified')throw new AppError('STORAGE_MOVE_STATE');
  await parent.relocated(latest);await this.copiedProject(storage,{source,moving:true});
  const registry=new LabBookRegistry(storage);
  await registry.inspect(async view=>{for await(const {entry:book} of view.entries()){
   const entry=registry.location(book),id='book:'+storage.projectId+':'+book.labBookId,saved=scope.session.get(id),proof=await scope.proofs.get(id),previous=path.join(source,entry.directory);
   if(saved?.vault?.key&&this.live(saved)&&proof&&scope.valid(proof)&&[previous,entry.root].includes(saved.root)&&saved.vault.id===entry.vaultId)await this.copiedBook(new LabBookStorage(entry.root,book.labBookId,saved.vault),{projectId:storage.projectId,source:previous,moving:true});
   // Preserve immediate access after this owner's adoption, without scanning
   // grants belonging to projects already visited elsewhere in the workspace.
   const grant=await scope.grants.get(id);if(!grant||!this.validGrant(grant))continue;
   if(grant.root!==entry.root||grant.namespaceId!==entry.namespaceId||grant.vaultId!==entry.vaultId)throw new AppError('DATABASE_LOCATION');
   if(saved?.vault){saved.root=grant.root;saved.etag=grant.etag;saved.expires=Math.min(saved.expires,grant.expires);}
   else{const next={root:grant.root,etag:grant.etag,vault:{id:grant.vaultId,key:Buffer.from(grant.key,'base64')},expires:grant.expires};scope.session.set(grant.id,next);scope.application.credentials.add(next);const token=this.identity(next),admitted=await scope.proofs.get(grant.id);await scope.proofs.put(grant.id,{...admitted,token});await scope.grants.put(grant.id,{...grant,token});}
  }});
  await parent.check();
 }
 async prepareMove(input){
  const scope=this.scope,marker=await moveSource(scope.application.workspace.root);if(!marker)return;
  const destination=await resolveLocation(input),receipt=await readMoveReceipt(destination);if(marker.destination!==destination||receipt?.id!==marker.id||receipt.source!==scope.application.workspace.root)throw new AppError('STORAGE_MOVE_STATE');
  const original=await scope.application.registry(),workspace=new Workspace(destination,scope.application.workspace.vault),outline=await workspace.outline();if(outline.metadata.id!==original.workspaceId)throw new AppError('STORAGE_MOVE_STATE');this.registry=new ProjectRegistry(workspace,original.workspaceId);
 }
 async seal(destination){
  if(this.sealed)throw new AppError('CONFLICT');await this.prepareMove(destination);await this.scope.check();
  const registry=this.registry??await this.scope.application.registry();
  for await(const proof of this.scope.proofs.items()){
   if(!proof.admitted||!proof.source)continue;const grant=await this.scope.grants.get(proof.id);if(!grant||!within(destination,grant.root))throw new AppError('STORAGE_COPY');this.assertGrant(grant);
   if(proof.source.kind==='project'){const entry=await registry.locate(proof.source.projectId);if(entry.namespaceId!==proof.source.namespaceId||entry.vaultId!==proof.source.vaultId||![proof.source.root,grant.root].includes(entry.root)||(await readAccess(entry.root)).etag!==proof.source.etag)throw new AppError('ACCESS_LOCKED');}
   else{const parentProof=await this.scope.proofs.get(proof.source.projectId),parentGrant=await this.scope.grants.get(proof.source.projectId),parent=await registry.locate(proof.source.projectId);if(!parentProof?.source||!parentGrant||![parentProof.source.root,parentGrant.root].includes(parent.root))throw new AppError('ACCESS_LOCKED');const root=parent.root===parentGrant.root?grant.root:proof.source.root;if(path.dirname(root)!==parent.root)throw new AppError('DATABASE_LOCATION');const access=await readAccess(root);if(access.etag!==proof.source.etag||access.value.vaultId!==proof.source.vaultId)throw new AppError('ACCESS_LOCKED');}
  }
  await assertRegular(destination,{directory:true});if(await assertRegular(path.join(destination,'.observanda/copy-in-progress'),{missing:true}))throw new AppError('STORAGE_INCOMPLETE');await this.scope.check();this.scope.destination=destination;this.sealed=true;
 }
 validGrant(grant){return this.scope.valid({id:grant.id,token:grant.token})&&grant.expires>Date.now()&&(grant.kind!=='lab-book'||this.identity(this.scope.session.get(grant.projectId))===grant.parentToken&&this.live(this.scope.session.get(grant.projectId)));}
 assertGrant(grant){if(grant.kind==='project'&&!this.validGrant(grant))throw new AppError('ACCESS_LOCKED');}
 async beginInstall(application,client,registry){if(!this.sealed||this.installed||client!==this.scope.client||application===this.scope.application||application.workspace.root!==this.scope.destination)throw new AppError('ACCESS_DENIED');this.installRevision=await registry.version();}
 async installGrant(application,grant,saved){
  const session=application.session(this.scope.client);let installed=false;
  try{await this.scope.grants.put(grant.id,{...grant,installedToken:this.identity(saved)});this.assertGrant(grant);if(application.closed)throw new AppError('ACCESS_LOCKED');if(!this.validGrant(grant))return;if(session.has(grant.id))throw new AppError('CONFLICT');session.set(grant.id,saved);application.credentials.add(saved);installed=true;}
  finally{if(!installed)clearVault(saved.vault);}
 }
 removeInstalled(application,grant){const session=application.session(this.scope.client),saved=session.get(grant.id);if(grant.installedToken&&this.identity(saved)===grant.installedToken){session.delete(grant.id);application.credentials.delete(saved);clearVault(saved.vault);}}
 async finishInstall(application,registry){
  if(application.closed||await registry.version()!==this.installRevision)throw new AppError('CONFLICT');
  for await(const grant of this.scope.grants.items())if(grant.installedToken&&!this.validGrant(grant)){if(grant.kind==='project')throw new AppError('ACCESS_LOCKED');this.removeInstalled(application,grant);}
  this.installed=true;
 }
 async rollbackInstall(application){for await(const grant of this.scope.grants.items())this.removeInstalled(application,grant);}
}
