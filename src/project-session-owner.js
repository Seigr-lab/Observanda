import {CatalogueReadCache} from './catalogue-read-cache.js';
// A selected project's credentials live only for the authorized operation.
// Source-history readers can reuse this owner without reopening it per record.
import {ProjectRouter} from './project-router.js';
import {ProjectMoves} from './project-move.js';
import {moveSource} from './workspace-move-state.js';
import {readAccess,verifyAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {cloneVault,clearVault} from './encryption.js';
import {AppError} from './errors.js';
export class ProjectSessionOwner{
 constructor(application,client,projectId,{check=async()=>{},recoverRenames=true,deferPreparedRename=false,skipRenameId=null}={}){
  this.application=application;this.client=client;this.recoverRenames=recoverRenames;this.deferPreparedRename=deferPreparedRename;this.skipRenameId=skipRenameId;this.projectId=projectId;this.session=application.session(client);this.sessionEntry=this.session.get(projectId);this.checkRequest=check;
 }
 async check(){
  const app=this.application;await this.checkRequest();
  if(app.closed||this.session.get(this.projectId)!==this.sessionEntry||this.sessionEntry?.locked||this.sessionEntry?.vault&&this.sessionEntry.expires<=Date.now())throw new AppError('ACCESS_LOCKED');
  if(this.entry){
   const entry=this.entry,[location,access]=await Promise.allSettled([this.registry.locate(this.projectId),readAccess(entry.root)]);
   if(location.status==='rejected')throw location.reason;
   const latest=location.value;
   if(latest.root!==entry.root||latest.vaultId!==entry.vaultId||latest.namespaceId!==entry.namespaceId)throw new AppError('ACCESS_LOCKED');
   if(access.status==='rejected')throw access.reason;
   if(access.value.etag!==this.etag)throw new AppError('ACCESS_LOCKED');
  }
 }
 async accessChanged(etag){
  const app=this.application;if(app.closed||this.session.get(this.projectId)!==this.sessionEntry)throw new AppError('ACCESS_LOCKED');
  const latest=await this.registry.locate(this.projectId),access=await readAccess(latest.root);
  if(latest.root!==this.entry.root||latest.vaultId!==this.entry.vaultId||latest.namespaceId!==this.entry.namespaceId||access.etag!==etag)throw new AppError('CONFLICT');authenticateKeyring(access.value,this.vault);
  for(const saved of app.credentials)if(saved.root===latest.root){clearVault(saved.vault);saved.expires=0;app.credentials.delete(saved);}
  app.calendars.invalidateProject(this.projectId);
  const saved={root:latest.root,etag,vault:cloneVault(this.vault),expires:Date.now()+8*60*60*1000};
  this.session.set(this.projectId,saved);app.credentials.add(saved);this.sessionEntry=saved;this.etag=etag;
 }
 async relocated(latest){
  this.application.calendars.invalidateProject(latest.projectId);
  if(!this.entry||latest.projectId!==this.entry.projectId||latest.vaultId!==this.entry.vaultId||latest.namespaceId!==this.entry.namespaceId)throw new AppError('CONFLICT');
  const access=await readAccess(latest.root);authenticateKeyring(access.value,this.vault);this.entry=latest;this.etag=access.etag;
  if(this.sessionEntry?.vault){this.sessionEntry.root=latest.root;this.sessionEntry.etag=access.etag;}
 }
 async router(){
  if(this.closed)throw new AppError('ACCESS_LOCKED');
  // Retire an expired cached grant before attempting fresh device authentication.
  // An already opened reader keeps enforcing its original grant's expiry.
  if(!this.selectedRouter){
   await this.checkRequest();
   if(this.recoverRenames){await this.application.recoverProjectRename?.(this.client,this.projectId,{check:this.checkRequest,deferPrepared:this.deferPreparedRename,skipId:this.skipRenameId});this.sessionEntry=this.session.get(this.projectId);}
   if(!this.application.closed&&this.session.get(this.projectId)===this.sessionEntry&&this.sessionEntry?.vault&&!this.sessionEntry.locked&&this.sessionEntry.expires<=Date.now()){
    this.application.forget(this.session,this.projectId);this.sessionEntry=undefined;
   }
  }
  await this.check();if(this.selectedRouter)return this.selectedRouter;
  this.registry=await this.application.registry();const moves=new ProjectMoves(this.registry);
  return this.selectedRouter=new ProjectRouter(this.registry,{
   recover:async(entry,key)=>{const marker=await moveSource(entry.root);if(marker)await moves.run(entry.projectId,key,{id:marker.id,resume:true,adoptOnly:true,onAdopt:latest=>this.relocated(latest)});},
   authorize:async({projectId})=>{if(projectId!==this.projectId)throw new AppError('ACCESS_DENIED');await this.check();return true;},
   unlock:async(entry,access)=>{
    const saved=this.session.get(entry.projectId);if(saved?.locked)throw new AppError('ACCESS_LOCKED');
    clearVault(this.vault);this.vault=null;
    if(saved?.vault&&saved.root===entry.root&&saved.etag===access.etag&&saved.expires>Date.now())this.vault=cloneVault(saved.vault);
    else{if(saved)this.application.forget(this.session,entry.projectId);this.sessionEntry=undefined;this.vault=await verifyAccess(access,'','',{deviceStore:this.application.deviceStore});}
    this.entry=entry;this.etag=access.etag;await this.check();return this.vault;
   }
  });
 }
 // A copy owns its credentials for the whole transfer, without retaining a
 // read transaction while the transfer obtains its storage handoff.
 async use(operation,options={}){
  if(this.closed)throw new AppError('ACCESS_LOCKED');if(!this.opened)await this.router();await this.check();
  this.opened??=(async()=>{const router=await this.router();return router.withProject(this.projectId,storage=>storage,{...options,action:'read'});})();
  const storage=await this.opened;await this.check();const result=await operation(storage);await this.check();return result;
 }
 async read(operation,options={}){
  if(this.closed)throw new AppError('ACCESS_LOCKED');if(!this.opened)await this.router();await this.check();
  this.opened??=(async()=>{const router=await this.router();return router.withProject(this.projectId,storage=>storage,{...options,action:'read'});})();
  const storage=await this.opened;await this.check();
  this.snapshot??=(async()=>{
   const db=await storage.openCatalogue(),cache=new CatalogueReadCache();
   try{await db.run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');return {db,cache,store:storage.catalogueStore(db,{readCache:cache})};}
   catch(error){cache.clear();await db.close();throw error;}
  })();
  const {store}=await this.snapshot;const result=await storage.inspectCatalogue(store,()=>operation(storage));await this.check();return result;
 }
 async close(){
  this.closed=true;
  try{const snapshot=await this.snapshot?.catch(()=>null);if(snapshot){try{await snapshot.db.close();}finally{snapshot.cache.clear();}}}
  finally{clearVault(this.vault);this.vault=null;}
 }
}
