import {locateProjectRename} from './project-rename-receipt.js';
import {LabBookLocationAccess} from './lab-book-location-access.js';
import {ProjectStorage} from './project-storage.js';
import {workspaceRename} from './workspace-rename-state.js';
// Location handoff credentials are request-owned. Copies require verified
// transfer receipts; renames require the completed physical rename receipt.
import path from 'node:path';
import {ProjectSessionOwner} from './project-session-owner.js';
import {projectTransferReceipt} from './project-transfer.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {cloneVault,clearVault} from './encryption.js';
import {AppError} from './errors.js';
import {Workspace,assertRegular} from './storage.js';
import {ProjectRegistry} from './project-registry.js';
import {moveSource} from './workspace-move-state.js';
import {resolveLocation} from './locations.js';
const inside=(parent,child)=>{const relative=path.relative(parent,child);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
export class ProjectLocationAccess {
  #moveRegistry=null;#owners=new Map();#grants=new Map();#destination=null;#installed=false;#closed=false;#rename=false;
  constructor(application,client,{check=async()=>{},recoverRenames=true,skipRenameId=null}={}){this.application=application;this.client=client;this.check=check;this.recoverRenames=recoverRenames;this.skipRenameId=skipRenameId;this.books=new LabBookLocationAccess(application,client);}
  captureRename(receipt){
    if(this.#closed||this.#destination||this.#owners.size||![receipt.source,receipt.destination].includes(this.application.workspace.root))throw new AppError('ACCESS_LOCKED');
    const session=this.application.session(this.client);
    for(const item of receipt.projects??[]){
      const source=path.resolve(receipt.source,...item.relative.split('/')),destination=path.resolve(receipt.destination,...item.relative.split('/')),saved=session.get(item.projectId);
      if(saved?.locked||saved?.vault&&saved.expires<=Date.now())continue;
      const explicit=saved?.vault&&saved.vault.id===item.vaultId&&[source,destination].includes(saved.root);
      if(saved?.vault&&!explicit)continue;
      const owner=new ProjectSessionOwner(this.application,this.client,item.projectId,{check:this.check});
      owner.entry={projectId:item.projectId,root:source,namespaceId:item.namespaceId,vaultId:item.vaultId};
      if(explicit){owner.vault=cloneVault(saved.vault);owner.etag=saved.etag;}
      this.#owners.set(item.projectId,owner);this.books.captureRename(item,receipt,owner);
    }
  }
  async withProject(id,operation) {
    if(this.#closed||this.#destination)throw new AppError('ACCESS_LOCKED');
    return this.application.tracked(async()=>{
      let owner=this.#owners.get(id);if(!owner){owner=new ProjectSessionOwner(this.application,this.client,id,{check:this.check,recoverRenames:this.#moveRegistry?false:typeof this.recoverRenames==='function'?this.recoverRenames(id):this.recoverRenames,skipRenameId:this.skipRenameId,registry:async()=>this.#moveRegistry??await this.application.registry()});this.#owners.set(id,owner);}
      try{return await owner.use(operation);}catch(error){if(['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN'].includes(error.code)){error.projectId??=id;if(error.projectId===id)error.projectName=path.basename((await (this.#moveRegistry??await this.application.registry()).locate(id)).root);}throw error;}
    },id);
  }
  async withBook(project,id,operation){const parent=this.#owners.get(project.projectId);if(this.#closed||this.#destination||!parent)throw new AppError('ACCESS_DENIED');return this.books.use(project,id,parent,operation);}
  async copied(storage) {
    if(this.#closed||this.#destination)throw new AppError('ACCESS_LOCKED');
    const owner=this.#owners.get(storage.projectId);if(!owner)throw new AppError('ACCESS_DENIED');await owner.check();
    const receipt=await projectTransferReceipt(storage),access=await readAccess(storage.root);
    if(receipt?.phase!=='verified'||receipt.source!==owner.entry.root||receipt.projectId!==owner.projectId||receipt.namespaceId!==owner.entry.namespaceId||storage.vault.id!==owner.vault.id)throw new AppError('STORAGE_COPY');
    authenticateKeyring(access.value,owner.vault);
    clearVault(this.#grants.get(storage.projectId)?.vault);
    this.#grants.set(storage.projectId,{root:storage.root,namespaceId:receipt.namespaceId,etag:access.etag,vault:cloneVault(owner.vault),expires:owner.sessionEntry?.expires??Date.now()+8*60*60*1000});
  }
  async moved(storage,source,latest) {
    if(this.#closed||this.#destination)throw new AppError('ACCESS_LOCKED');
    const owner=this.#owners.get(storage.projectId);if(!owner||![source,storage.root].includes(owner.entry?.root))throw new AppError('ACCESS_DENIED');
    const receipt=await projectTransferReceipt(storage),access=await readAccess(storage.root);
    if(receipt?.phase!=='verified'||receipt.source!==source||receipt.projectId!==owner.projectId||receipt.namespaceId!==owner.entry.namespaceId||storage.vault.id!==owner.vault.id||latest.root!==storage.root)throw new AppError('STORAGE_MOVE_STATE');
    authenticateKeyring(access.value,owner.vault);await owner.relocated(latest);await this.books.moved(storage,source,owner);this.books.relocateGrants();await owner.check();
    clearVault(this.#grants.get(storage.projectId)?.vault);
    this.#grants.set(storage.projectId,{root:storage.root,namespaceId:receipt.namespaceId,etag:access.etag,vault:cloneVault(owner.vault),expires:owner.sessionEntry?.expires??Date.now()+8*60*60*1000});
  }
  async renamed(renames,id,source,destination,{includeRoot=false}={}) {
    if(this.#closed||this.#destination||this.application.closed)throw new AppError('ACCESS_LOCKED');
    const receipt=await renames.read(id);
    if(receipt.phase!=='complete'||receipt.source!==source||receipt.destination!==destination||await renames.completedSource(destination)!==source||await workspaceRename(destination))throw new AppError('STORAGE_RENAME_STATE');
    for(const [projectId,owner] of this.#owners){
      if(!owner.vault)continue;
      // Revocation cannot undo a completed physical rename. Omit that grant;
      // normal project access will require authentication in the new context.
      if(owner.session.get(projectId)!==owner.sessionEntry||owner.sessionEntry?.locked||owner.sessionEntry?.vault&&owner.sessionEntry.expires<=Date.now())continue;
      const entry=receipt.projects?.find(entry=>entry.projectId===projectId);
      if(!entry||entry.namespaceId!==owner.entry.namespaceId||entry.vaultId!==owner.vault.id||path.resolve(source,...entry.relative.split('/'))!==owner.entry.root)throw new AppError('STORAGE_RENAME_STATE');
      const root=path.resolve(destination,...entry.relative.split('/')),access=await readAccess(root);
      if(!(inside(destination,root)||includeRoot&&root===destination)||access.etag!==owner.etag)throw new AppError('ACCESS_LOCKED');authenticateKeyring(access.value,owner.vault);
      const storage=new ProjectStorage(root,projectId,owner.vault);if((await storage.outline()).metadata.id!==entry.namespaceId)throw new AppError('DATABASE_LOCATION');
      this.#grants.set(projectId,{root,namespaceId:entry.namespaceId,etag:access.etag,vault:cloneVault(owner.vault),expires:owner.sessionEntry?.expires??Date.now()+8*60*60*1000});
    }
    await this.books.renamed(receipt,source,destination);await this.check();this.#rename=true;this.#destination=destination;
  }
  async adoptProjectRename(renames){
    const receipt=await renames.read(),scope=renames.scope(receipt),root=await locateProjectRename(renames.registry,receipt);
    if(receipt.phase!=='complete'||root!==scope.destination||await workspaceRename(root))throw new AppError('STORAGE_RENAME_STATE');
    const owners=[{projectId:receipt.projectId,namespaceId:receipt.namespaceId,vaultId:receipt.vaultId,relative:'',...receipt.rootBooks},...(receipt.projects??[])];
    await this.renamed({read:async()=>({...scope,projects:owners}),completedSource:async()=>scope.source},receipt.id,scope.source,scope.destination,{includeRoot:true});
    await renames.registry.inspect(async view=>{for(const [id,grant] of this.#grants){const row=await view.get(id),entry=row?.entry;if(row?.state!=='active'||entry.root!==grant.root||entry.namespaceId!==grant.namespaceId||entry.vaultId!==grant.vault.id)throw new AppError('DATABASE_LOCATION');}});
    await this.check();if(this.application.closed)throw new AppError('ACCESS_LOCKED');
    // Apply only this client's still-valid grants. No await separates checking
    // these references from relocating them; revoked sessions stay revoked.
    for(const [id,grant] of this.#grants){
      const owner=this.#owners.get(id),saved=owner.session.get(id);
      if(saved!==owner.sessionEntry||saved?.locked||saved?.vault&&saved.expires<=Date.now())continue;
      if(saved?.vault){saved.root=grant.root;saved.etag=grant.etag;saved.expires=Math.min(saved.expires,grant.expires);}
      else{const value={root:grant.root,etag:grant.etag,vault:cloneVault(grant.vault),expires:grant.expires};owner.session.set(id,value);this.application.credentials.add(value);owner.sessionEntry=value;}
    }
    this.books.relocateGrants();this.#installed=true;
  }
  async prepareMove(input){
    const marker=await moveSource(this.application.workspace.root);if(!marker)return;
    const destination=await resolveLocation(input),{readMoveReceipt}=await import('./workspace-move.js'),receipt=await readMoveReceipt(destination);
    if(marker.destination!==destination||receipt?.id!==marker.id||receipt.source!==this.application.workspace.root)throw new AppError('STORAGE_MOVE_STATE');
    const original=await this.application.registry(),workspace=new Workspace(destination,this.application.workspace.vault),outline=await workspace.outline();
    if(outline.metadata.id!==original.workspaceId)throw new AppError('STORAGE_MOVE_STATE');
    // Only the verified handoff uses the destination directory. Every owner
    // continues checking its original session, expiry and current access etag.
    this.#moveRegistry=new ProjectRegistry(workspace,original.workspaceId);
    for(const owner of this.#owners.values())owner.registry=this.#moveRegistry;
  }
  async seal(destination) {
    if(this.#closed||this.#destination||this.#grants.size!==this.#owners.size)throw new AppError('CONFLICT');
    await this.prepareMove(destination);
    for(const [id,owner] of this.#owners){await owner.check();if(!inside(destination,this.#grants.get(id).root))throw new AppError('STORAGE_PATH');}
    await assertRegular(destination,{directory:true});
    if(await assertRegular(path.join(destination,'.observanda','copy-in-progress'),{missing:true}))throw new AppError('STORAGE_INCOMPLETE');
    await this.check();this.#destination=destination;
  }
  async install(application,client) {
    if(client!==this.client||this.#closed||this.#installed||!this.#destination||application.closed||application.workspace.root!==this.#destination)throw new AppError('ACCESS_DENIED');
    if(!this.#grants.size){await this.books.install(application,client);this.#installed=true;return;}
    const registry=await application.registry(),revision=await registry.version(),session=application.session(client),prepared=[];
    try {
      for(const [id,grant] of this.#grants) {
        const owner=this.#owners.get(id);
        if(owner.session.get(id)!==owner.sessionEntry||owner.sessionEntry?.locked||grant.expires<=Date.now()){if(this.#rename)continue;throw new AppError('ACCESS_LOCKED');}
        if(session.has(id))throw new AppError('CONFLICT');
        const row=await registry.state(id),entry=row.entry;if(row.state!=='active'||row.revision!==revision)throw new AppError('DATABASE_LOCATION');const access=await readAccess(entry.root);
        if(entry.root!==grant.root||entry.namespaceId!==grant.namespaceId||entry.vaultId!==grant.vault.id||access.etag!==grant.etag)throw new AppError('DATABASE_LOCATION');
        authenticateKeyring(access.value,grant.vault);
        prepared.push([id,{root:entry.root,etag:access.etag,vault:cloneVault(grant.vault),expires:grant.expires}]);
      }
      if(await registry.version()!==revision)throw new AppError('CONFLICT');
      if(application.closed)throw new AppError('ACCESS_LOCKED');
      for(let index=prepared.length-1;index>=0;index--){
        const [id,value]=prepared[index],owner=this.#owners.get(id);
        if(owner.session.get(id)!==owner.sessionEntry||owner.sessionEntry?.locked||value.expires<=Date.now()){
          if(!this.#rename)throw new AppError('ACCESS_LOCKED');clearVault(value.vault);prepared.splice(index,1);continue;
        }
        if(session.has(id))throw new AppError('CONFLICT');
      }
      for(const [id,value] of prepared){session.set(id,value);application.credentials.add(value);}await this.books.install(application,client);this.#installed=true;
    } catch(error){for(const [id,value] of prepared){if(session.get(id)===value){session.delete(id);application.credentials.delete(value);}clearVault(value.vault);}throw error;}
  }
  async close(){
    if(this.#closed)return;this.#closed=true;
    try {const results=await Promise.allSettled([...this.#owners.values()].map(owner=>owner.close()));const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;}
    finally {this.books.close();for(const grant of this.#grants.values())clearVault(grant.vault);this.#owners.clear();this.#grants.clear();}
  }
}
