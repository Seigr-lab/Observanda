import {LabBookRegistry} from './lab-book-registry.js';
import {LabBookRenames} from './lab-book-rename.js';
import {LabBookDeletions} from './lab-book-deletion.js';
import {readAccess,verifyAccess} from './access.js';
import {cloneVault,clearVault} from './encryption.js';
import {authenticateKeyring} from './security/keyring.js';
import {AppError} from './errors.js';
const accessErrors=new Set(['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN']);
// A book grant belongs to one browser session and one project/book identity.
// Parent access is checked separately; a parent's key never opens book data.
export class LabBookAccessSession{
 constructor(application,client,project,labBookId,check){
  this.application=application;this.project=project;this.labBookId=labBookId;this.parentCheck=async()=>{try{await check();}catch(error){if(accessErrors.has(error.code))error.projectId=project.projectId;throw error;}};this.session=application.session(client);this.id='book:'+project.projectId+':'+labBookId;this.expected=this.session.get(this.id);
 }
 async check(){
  await this.parentCheck();const saved=this.session.get(this.id);
  if(this.application.closed||saved!==this.expected||saved?.locked||saved?.vault&&saved.expires<=Date.now())throw this.error(new AppError('ACCESS_LOCKED'));
 }
 error(error){if(accessErrors.has(error.code)&&!error.projectId){error.projectId=this.project.projectId;error.labBookId=this.labBookId;}return error;}
 async key(root){
  try{
   await this.parentCheck();let saved=this.session.get(this.id);if(saved?.locked)throw new AppError('ACCESS_LOCKED');
   const access=await readAccess(root);
   if(saved?.vault&&saved.etag===access.etag&&saved.vault.id===access.value.vaultId&&saved.expires>Date.now()){this.expected=saved;await this.check();saved.root=root;return cloneVault(saved.vault);}
   if(saved)this.application.forget(this.session,this.id);this.expected=undefined;
   const vault=await verifyAccess(access,'','',{deviceStore:this.application.deviceStore});
   try{await this.check();return vault;}catch(error){clearVault(vault);throw error;}
  }catch(error){throw this.error(error);}
 }
 async location(){
  const placement=await this.application.bookPlacements?.status(this.project,this.labBookId);
  if(placement?.canResume){const root=await this.application.bookPlacements.root(this.project,this.labBookId);return {root,vaultId:(await readAccess(root)).value.vaultId};}
  const renames=new LabBookRenames(this.project),pending=await renames.pending(this.labBookId);
  if(pending&&pending.phase!=='complete')return {root:await renames.locate(pending),vaultId:pending.vaultId};
  const deletions=new LabBookDeletions(this.project,this.labBookId),receipt=await deletions.receipt();
  if(receipt&&receipt.phase!=='complete'){const root=await deletions.authenticationRoot(receipt);if(root)return {root,vaultId:receipt.vaultId};}
  return new LabBookRegistry(this.project).locate(this.labBookId);
 }
 async unlock(data){
  if(!data||Object.keys(data).some(key=>!['username','password','recovery'].includes(key))||Object.values(data).some(value=>typeof value!=='string'||value.length>1024))throw new AppError('INVALID');
  await this.parentCheck();const previous=this.session.get(this.id),entry=await this.location(),access=await readAccess(entry.root);
  if(access.value.vaultId!==entry.vaultId)throw new AppError('DATABASE_LOCATION');
  let vault;
  try{
   vault=await this.application.authenticate(entry.root,access,data.username??'',data.password??'',data.recovery??'');await this.parentCheck();
   if(this.application.closed||this.session.get(this.id)!==previous||(await this.location()).root!==entry.root||(await readAccess(entry.root)).etag!==access.etag)throw new AppError('CONFLICT');
   await this.application.jobs.forgetBook(this.session,this.project.projectId,this.labBookId);this.save(entry.root,access.etag,vault);
   return {projectId:this.project.projectId,labBookId:this.labBookId,locked:false};
  }catch(error){throw this.error(error);}finally{clearVault(vault);}
 }
 save(root,etag,vault){
  this.application.forget(this.session,this.id);const saved={root,etag,vault:cloneVault(vault),expires:Date.now()+8*60*60*1000};this.session.set(this.id,saved);this.application.credentials.add(saved);this.expected=saved;
 }
 async changed(root,etag,vault){
  await this.parentCheck();if(this.application.closed||this.session.get(this.id)!==this.expected)throw new AppError('ACCESS_LOCKED');
  const access=await readAccess(root);if(access.etag!==etag)throw new AppError('CONFLICT');authenticateKeyring(access.value,vault);
  for(const saved of this.application.credentials)if(saved.vault?.id===vault.id){clearVault(saved.vault);saved.expires=0;this.application.credentials.delete(saved);}
  this.save(root,etag,vault);
 }
 async lock(){
  await this.parentCheck();this.application.forget(this.session,this.id);this.session.set(this.id,{locked:true});
  await this.application.jobs.forgetBook(this.session,this.project.projectId,this.labBookId);
  await Promise.all([...this.application.active].filter(([,owner])=>owner.projectId===this.project.projectId&&owner.labBookId===this.labBookId).map(([pending])=>pending));
  return {projectId:this.project.projectId,labBookId:this.labBookId,locked:true};
 }
}
