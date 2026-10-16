import {assertBookPlacementAvailable} from './lab-book-placement-state.js';
import path from 'node:path';
import {LabBookTransferState,bookTransferComplete,assertBookTransfersComplete} from './lab-book-transfer-state.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {LabBookRenames} from './lab-book-rename.js';
import {LabBookDeletions} from './lab-book-deletion.js';
import {copyLabBookLocation} from './lab-book-transfer.js';
import {privateDirectory} from './storage.js';
import {assertNotDeleting} from './workspace-delete-state.js';
import {assertNotMoving} from './workspace-move-state.js';
import {readAccess} from './access.js';
import {databaseProvider} from './workspace-database-context.js';
import {withWriterLease} from './writer-lease.js';
import {resolveLocation} from './locations.js';
import {storageCreationPath} from './storage-names.js';
import {projectTransferRunning,trackProjectTransfer} from './project-transfer-tasks.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const within=(parent,child)=>{const relative=path.relative(parent,child);return !relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
// One selected book owns its transfer and writer. Parent/sibling payloads are
// neither opened nor traversed; the project retains only the resumable command.
export class LabBookCopies{
 constructor(project,labBookId,kind='copy'){this.project=project;this.labBookId=labBookId;this.kind=kind;this.state=new LabBookTransferState(project,labBookId,kind);this.registry=new LabBookRegistry(project);}
 async status(){const value=await this.state.read();return value?{...value,running:projectTransferRunning(this.state.file),canCancel:!bookTransferComplete(value)&&!projectTransferRunning(this.state.file)}:null;}
 async locked(operation){const directory=await privateDirectory(this.project.root,'.observanda/lab-book-creation');return trackProjectTransfer(this.state.file,()=>withWriterLease(path.join(directory,'book-'+this.labBookId+'.lock'),operation));}
 async current(storage,value){await assertNotDeleting(this.project.root);await assertNotMoving(this.project.root);const entry=await this.registry.locate(this.labBookId);if(entry.root!==storage.root||storage.labBookId!==this.labBookId||entry.vaultId!==storage.vault?.id||value&&(value.source!==entry.root||value.namespaceId!==entry.namespaceId||value.vaultId!==entry.vaultId))throw new AppError('CONFLICT');return entry;}
 async cancel(storage,{id,check=async()=>{}}){
  if(!researchId(id))throw new AppError('INVALID');return this.locked(async()=>{await check();const value=await this.state.read();if(!value||value.id!==id)throw new AppError('NOT_FOUND');await this.current(storage,value);if(value.phase==='complete')throw new AppError('CONFLICT');await check();value.phase='cancelled';await this.state.save(value);return value;});
 }
 async run(storage,{id,parent,resume=false,forbiddenRoots=[],onProgress,checkpoint,check=async()=>{}}={}){
  if(!researchId(id)||!Array.isArray(forbiddenRoots)||forbiddenRoots.some(root=>typeof root!=='string'||!path.isAbsolute(root)))throw new AppError('INVALID');
  return this.locked(async()=>{
   await check();await assertBookPlacementAvailable(this.project,this.labBookId);await assertBookTransfersComplete(this.project,this.labBookId,{except:this.kind});
   if(await new LabBookRenames(this.project).pending(this.labBookId))throw new AppError('STORAGE_RENAMING');
   const deletion=await new LabBookDeletions(this.project,this.labBookId).receipt();if(deletion&&deletion.phase!=='complete')throw new AppError('STORAGE_DELETE_BUSY');
   let value=await this.state.read();const entry=await this.current(storage);
   if(value?.id===id){await this.current(storage,value);if(parent!==undefined&&await resolveLocation(storageCreationPath(parent,entry.directory))!==value.destination)throw new AppError('CONFLICT');if(bookTransferComplete(value))return value;}
   else{
    if(resume)throw new AppError('NOT_FOUND');if(!bookTransferComplete(value))throw new AppError('LAB_BOOK_TRANSFER_PENDING');
    const destination=await resolveLocation(storageCreationPath(parent,entry.directory));
    if([this.project.root,...forbiddenRoots].some(root=>within(root,destination)||within(destination,root)))throw new AppError('STORAGE_PATH');
    value={version:1,id,kind:this.kind,projectId:this.project.projectId,labBookId:this.labBookId,namespaceId:entry.namespaceId,vaultId:entry.vaultId,source:entry.root,destination,phase:'copying'};
   }
   if(this.kind==='export'){const access=await readAccess(storage.root);if(!access.value.password&&!access.value.recovery)throw new AppError('STORAGE_PORTABLE_BOOK_ACCESS');}
   await check();await this.state.save(value);
   try{await copyLabBookLocation(storage,value.destination,{id,portable:this.kind==='export',onProgress,checkpoint});}
   finally{await databaseProvider()?.closeLabBook(value.destination);}
   value.phase='complete';await this.state.save(value);return value;
  });
 }
}
