import {validateKeyring} from './security/keyring.js';
import {validProjectSourceAuthority} from './project-source-authority.js';
import {WORKSPACE_COPY_RECEIPT,WORKSPACE_COPY_LEASE} from './workspace-transfer-controls.js';
export {WORKSPACE_COPY_RECEIPT,WORKSPACE_COPY_LEASE} from './workspace-transfer-controls.js';
// A bundle checkpoint owns only the destination and transfer identities. Project
// payloads and their resumable transfer receipts remain with each project owner.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {unlink,readdir,readFile} from 'node:fs/promises';
import {Workspace,assertRegular,privateDirectory,serialize,workspaceFile,atomicWrite} from './storage.js';
import {resolveLocation,prepareCopyDestination} from './locations.js';
import {withWriterLease} from './writer-lease.js';
import {hashWorkspaceFile} from './workspace-inventory.js';
import {copyFileProgress} from './copy-file-progress.js';
import {atomicReplace} from './atomic-replace.js';
import {catalogueBinding} from './postgres-activation.js';
import {operationTransferred} from './operation-progress.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
import {isStorageTemporary} from './storage-temporary.js';
const inside=(parent,child)=>{const r=path.relative(parent,child);return r===''||r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
const MAX_RECEIPT=32*1024*1024;
const abandonedReceipt=name=>name.startsWith('.write-')&&isStorageTemporary(name);
const fields=['sourceRevision','encrypted','projectPlacement','portable','source','destination','inventorySalt','fingerprint','fingerprintFiles','fileCount','bytes','fileBytes','transferFiles','databaseBytes','projectRoots','projectRegistryRevision'];
const savedPlan=plan=>Object.fromEntries(fields.filter(key=>plan[key]!==undefined&&(key!=='portable'||plan.portable===true)).map(key=>[key,plan[key]]));
export class WorkspaceCopyRecovery {
 constructor(source,destination,{checkpoint=async()=>{},prepareDestination,encryptionAccess}={}){this.encryptionAccess=encryptionAccess;this.prepareDestination=prepareDestination;this.source=source;this.target=new Workspace(destination,source.vault);this.checkpoint=checkpoint;this.file=path.join(destination,WORKSPACE_COPY_RECEIPT);this.marker=path.join(destination,'.observanda/copy-in-progress');}
 async read(){
  if(!await assertRegular(this.target.root,{missing:true,directory:true}))return null;
  if(!await assertRegular(path.join(this.target.root,'.observanda'),{missing:true,directory:true}))return null;
  const stat=await assertRegular(this.file,{missing:true});if(!stat)return null;if(stat.size>MAX_RECEIPT)throw new AppError('STORAGE_COPY');
  let value;try{if(!this.source.vault?.id)await this.source.requireStorageKey();value=JSON.parse(this.source.vault?.id?await this.target.readFile(this.file,'utf8'):await readFile(this.file,'utf8'));}catch{throw new AppError('STORAGE_COPY');}
  if(![1,2,3].includes(value?.version)||!researchId(value.id)||value.vaultId!==(this.source.vault?.id??null)||!['files','database','snapshot','published'].includes(value.phase)||value.plan?.portable!==undefined&&value.plan.portable!==true||value.plan?.source!==this.source.root||value.plan?.destination!==this.target.root||value.plan?.inventorySalt!==value.id||!value.directory||!Array.isArray(value.directory.value?.projects)||!value.transfers||typeof value.transfers!=='object')throw new AppError('STORAGE_COPY');
  if(value.plan.projectPlacement!==undefined&&value.plan.projectPlacement!==2)throw new AppError('STORAGE_COPY');
  if(value.version===1&&value.plan.projectPlacement!==undefined||value.version===3&&value.plan.projectPlacement!==2)throw new AppError('STORAGE_COPY');
  if(value.plan.encrypted===true){
   if(value.version===1||value.plan.portable===true)throw new AppError('STORAGE_COPY');
   try{validateKeyring(value.encryptionAccess);}catch{throw new AppError('STORAGE_COPY');}
  }else if(value.version===2||value.plan.encrypted!==undefined||value.encryptionAccess!==undefined)throw new AppError('STORAGE_COPY');
  if(value.adoptions!==undefined&&(!Array.isArray(value.adoptions)||value.adoptions.some(item=>!validProjectSourceAuthority(item))))throw new AppError('STORAGE_COPY');
  for(const entry of value.directory.value.projects)if(!researchId(value.transfers[entry.projectId]))throw new AppError('STORAGE_COPY');
  return value;
 }
 async emptyPreparation(){
  if(!await assertRegular(this.target.root,{missing:true,directory:true}))return false;
  const names=await readdir(this.target.root);if(names.length!==1||names[0]!=='.observanda')return false;
  await assertRegular(path.join(this.target.root,'.observanda'),{directory:true});
  for(const name of await readdir(path.join(this.target.root,'.observanda'))){
   if(!['copy-in-progress',path.basename(WORKSPACE_COPY_LEASE)].includes(name)&&!abandonedReceipt(name))return false;
   const file=path.join(this.target.root,'.observanda',name),stat=await assertRegular(file);
   if(name==='copy-in-progress'&&(stat.size!==11||await readFile(file,'utf8')!=='incomplete\n'))return false;
  }
  return true;
 }
 async plan(){
  if(inside(this.source.root,this.target.root)||inside(this.target.root,this.source.root))throw new AppError('STORAGE_PATH');
  if(await resolveLocation(this.target.root)!==this.target.root)throw new AppError('STORAGE_PATH');
  const state=await this.read();if(!state)return null;
  if(!await assertRegular(this.marker,{missing:true}))throw new AppError('EXISTS');
  return {...state.plan,resume:true};
 }
 async run(plan,directory,operation){
  let state=await this.read();
  if(!state){if(this.prepareDestination)await this.prepareDestination();else if(await this.emptyPreparation())await atomicWrite(this.marker,'incomplete\n');else await prepareCopyDestination(this.target.root);}
  return withWriterLease(path.join(this.target.root,WORKSPACE_COPY_LEASE),async()=>{
   state=await this.read();
   if(state){if(!await assertRegular(this.marker,{missing:true})||state.id!==plan.inventorySalt||!!state.plan.encrypted!==!!plan.encrypted||plan.encrypted&&serialize(state.encryptionAccess)!==serialize(this.encryptionAccess))throw new AppError('CONFLICT');}
   else {if(plan.encrypted){validateKeyring(this.encryptionAccess);if(plan.portable)throw new AppError('INVALID');}
    state={version:plan.projectPlacement===2?3:plan.encrypted?2:1,...(plan.encrypted?{encryptionAccess:structuredClone(this.encryptionAccess)}:{}),id:plan.inventorySalt,vaultId:this.source.vault?.id??null,phase:'files',plan:savedPlan(plan),directory:structuredClone(directory),transfers:Object.fromEntries(directory.value.projects.map(entry=>[entry.projectId,randomUUID()]))};await this.save(state);
    for(const name of await readdir(path.dirname(this.file)))if(abandonedReceipt(name)){const file=path.join(path.dirname(this.file),name);await assertRegular(file);await unlink(file);}
   }
   this.state=state;
   if(this.snapshotReady){
    if(serialize(await catalogueBinding(this.target.root))!==serialize(state.binding)||await hashWorkspaceFile(await workspaceFile(this.target.root))!==state.descriptor)throw new AppError('STORAGE_COPY');
   }
   return operation(this);
  });
 }
 async save(state=this.state){const raw=serialize(state);if(Buffer.byteLength(raw)>MAX_RECEIPT-128)throw new AppError('LIMIT');if(this.source.vault?.id)await this.target.writeFile(this.file,raw);else{await this.source.requireStorageKey();await atomicWrite(this.file,raw);}}
 get snapshotReady(){return ['snapshot','published'].includes(this.state?.phase);}
 get databaseReady(){return this.state?.phase!=='files';}
 async prepare(plan){
  if(this.state.plan.fingerprint&&this.state.plan.fingerprint!==plan.fingerprint)throw new AppError('CONFLICT');
  this.state.plan=savedPlan(plan);await this.save();return {destination:this.target.root,marker:this.marker};
 }
 async copyFile(file){
  const output=path.resolve(this.target.root,file.path);if(output===this.target.root||!inside(this.target.root,output))throw new AppError('UNSAFE');
  const relative=path.posix.dirname(file.path);if(relative!=='.')await privateDirectory(this.target.root,relative);
  const prior=await assertRegular(output,{missing:true});
  if(prior){if(prior.size!==file.bytes||await hashWorkspaceFile(output)!==file.sha256)throw new AppError('STORAGE_COPY');operationTransferred({bytes:file.bytes});return;}
  const temporary=path.join(path.dirname(output),'.stream-workspace-copy-'+this.state.id);
  if(await assertRegular(temporary,{missing:true}))await unlink(temporary);
  await copyFileProgress(path.join(this.source.root,file.path),temporary,{size:file.bytes,name:file.path,onBytes:bytes=>operationTransferred({bytes})});
  if(await hashWorkspaceFile(temporary)!==file.sha256)throw new AppError('STORAGE_COPY');
  if(await assertRegular(output,{missing:true}))throw new AppError('EXISTS');await atomicReplace(temporary,output);
  await this.checkpoint('workspace-file',file.path);
 }
 async database(){this.state.phase='database';await this.save();await this.checkpoint('workspace-database');}
 async snapshot(){this.state.binding=await catalogueBinding(this.target.root);this.state.descriptor=await hashWorkspaceFile(await workspaceFile(this.target.root));this.state.phase='snapshot';await this.save();await this.checkpoint('workspace-snapshot');}
 async published(){this.state.phase='published';await this.save();await this.checkpoint('workspace-published');}
 transferId(projectId){const id=this.state.transfers[projectId];if(!researchId(id))throw new AppError('STORAGE_COPY');return id;}
}
