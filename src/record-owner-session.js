// A transfer retains only its two selected owners' credentials. Checks are
// repeated at each checkpoint; neither a shared writer nor a read transaction
// is retained while the other owner is working.
import {ProjectSessionOwner} from './project-session-owner.js';
import {LabBookAccessSession} from './lab-book-access-session.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {LabBookRouter} from './lab-book-router.js';
import {LabBookRenames} from './lab-book-rename.js';
import {readAccess} from './access.js';
import {clearVault} from './encryption.js';
import {validRecordOwner} from './record-owner-transfer-state.js';
import {AppError} from './errors.js';
const accessCodes=new Set(['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN']);
export class RecordOwnerSession{
 constructor(application,client,owner,{check=async()=>{}}={}){
  if(!validRecordOwner(owner))throw new AppError('INVALID');
  this.application=application;this.client=client;this.owner=owner;this.requestCheck=check;
  if(owner.projectId)this.project=new ProjectSessionOwner(application,client,owner.projectId,{check});
 }
 async check(){
  await this.requestCheck();if(this.closed||this.application.closed)throw new AppError('ACCESS_LOCKED');
  try{
   await this.project?.check();await this.bookAccess?.check();
   if(this.entry){const latest=await this.books.locate(this.owner.labBookId);if(latest.root!==this.entry.root||latest.namespaceId!==this.entry.namespaceId||latest.vaultId!==this.entry.vaultId||(await readAccess(latest.root)).etag!==this.etag)throw new AppError('ACCESS_LOCKED');}
  }catch(error){throw this.annotate(error);}
 }
 annotate(error){if(accessCodes.has(error.code)&&this.owner.projectId&&!error.projectId){error.projectId=this.owner.projectId;if(this.bookAccess)error.labBookId=this.owner.labBookId;}return error;}
 async selected(storage,operation){
  if((await storage.outline()).metadata.id!==this.owner.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  await this.check();const result=await operation(storage,()=>this.check());await this.check();return result;
 }
 async use(operation){
  await this.requestCheck();if(this.closed||this.application.closed)throw new AppError('ACCESS_LOCKED');
  try{
   if(!this.project)return await this.selected(this.application.workspace,operation);
   return await this.project.use(async project=>{
    if(!this.owner.labBookId)return this.selected(project,operation);
    const id=this.owner.labBookId;this.books=new LabBookRegistry(project);
    this.bookAccess=new LabBookAccessSession(this.application,this.client,project,id,()=>this.project.check());
    const renames=new LabBookRenames(project),pending=await renames.pending(id);
    let entry=await this.books.locate(id);
    const root=pending&&pending.phase!=='complete'?await renames.locate(pending):entry.root;
    this.vault=await this.bookAccess.key(root);
    if(pending){await this.application.jobs.invalidateBook(project.projectId,id);await renames.resume(id,this.vault,{check:()=>this.bookAccess.check()});entry=await this.books.locate(id);}
    this.entry=entry;this.etag=(await readAccess(entry.root)).etag;
    return new LabBookRouter(this.books,{authorize:async()=>{await this.check();return true;},unlock:async()=>this.vault}).withLabBook(id,storage=>this.selected(storage,operation));
   });
  }catch(error){throw this.annotate(error);}
 }
 async close(){this.closed=true;try{await this.project?.close();}finally{clearVault(this.vault);this.vault=null;}}
}
