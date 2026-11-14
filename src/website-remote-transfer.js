import {AppError} from './errors.js';
import {admitGithubPlan,writeGithubOwnership} from './github-publication-plan.js';
import {recordDeploymentInventory} from './publication-live.js';
import {reviewedManifest} from './publication-live-budget.js';
import {settleSSHTransfer} from './ssh-deployment.js';
import {writeRemoteFiles} from './publishing.js';
import {LocalExportManifest} from './local-export-manifest.js';
import {contentHash,contentSize} from './file-content.js';
import {operationStage,operationAdvance,operationTransfer,operationTransferred} from './operation-progress.js';

const key=destination=>'.observanda/website-transfers/'+destination+'.json';
const terminal=new Set(['completed','settled']);
const needsSettlement=value=>!terminal.has(value.state)&&!!(value.journal.pushAttempted||value.journal.receipt||value.journal.archiveAttempted||value.journal.lockAttempted&&!value.journal.released);
async function read(target,saved){
 if(!saved.destinationKey)return null;
 const text=await target.workspace.readMetadata(key(saved.destinationKey),16*1024*1024);
 if(!text)return null;
 const value=JSON.parse(text);
 if(value.version!==1||value.destination!==saved.destinationKey||value.siteId!==target.workspace.websiteId||!['running','failed','completed','settled'].includes(value.state))throw new AppError('JOB_DAMAGED');
 return value;
}
const write=(target,value)=>target.workspace.writeMetadata(key(value.destination),JSON.stringify(value));
function summary(value){
 if(!value)return null;
 const {state,id,revision,configEtag,releaseId,kind,startedAt,updatedAt,errorCode,journal}=value;
 return {state,id,revision,configEtag,releaseId,kind,startedAt,updatedAt,errorCode,uncertain:needsSettlement(value),uploaded:journal.uploadedCount??journal.uploaded?.length??0,total:journal.total??null,receipt:terminal.has(state)?journal.receipt??null:null};
}
export async function remoteTransferStatus(target,saved){return summary(await read(target,saved));}

// Upload cursors include confirmed items from earlier attempts. The byte
// count covers only payload acknowledged during this connection's attempt.
function uploadProgress(){
 let phase;
 return {start(files,totalFiles){phase='remoteUpload';operationTransfer({phase,files,totalFiles,bytes:0});},
  phase(next){if(phase!==next){phase=next;operationTransfer({phase});}},
  verified(files){operationTransfer({files});},
  confirmed(files,bytes){operationTransferred({files,bytes});}};
}

export async function publishWebsiteTransfer(target,candidate,{configEtag,id,validateSSH,ownerId,signal,retryPages=false}){
 return target.workspace.withTransferLease(async()=>{
  const saved=await target.read();if(!saved.configured||saved.etag!==configEtag)throw new AppError('PUBLISH_STALE');
  let value=await read(target,saved);
  if(value?.id===id){
   if(value.revision!==candidate.revision||value.releaseId!==candidate.id||value.configEtag!==configEtag||value.state==='settled')throw new AppError('PUBLISH_STALE');
   // Verify the current permission and revision even if delivery was already acknowledged.
   await target.authorizeCandidate(candidate);
   if(value.state==='completed'&&!(retryPages&&value.kind==='github'&&value.journal.receipt?.status==='uploaded-pages-setup-required'))return {receipt:value.journal.receipt,transfer:summary(value)};
  }else{
   if(retryPages)throw new AppError('PUBLISH_STALE');
   if(value&&needsSettlement(value))throw new AppError('PUBLISH_PENDING');
   const plan=saved.config.kind==='github'?await target.readDestinationPlan(candidate,configEtag,{destinationReview:id,destinationReviewed:true}):null;
   let fileInventory;
   if(['ssh','sftp','ftp'].includes(saved.config.kind))fileInventory=(await validateSSH()).inventory;
   else{
    const builder=new LocalExportManifest(target.workspace).builder('files');
    await operationStage('remoteIndexFiles',{unit:'files',total:candidate.files.size},async()=>{for(const [path,content] of candidate.files){signal?.throwIfAborted();await builder.append({path,bytes:contentSize(content),sha256:contentHash(content)});operationAdvance();}});
    fileInventory=await builder.finish();
   }
   const now=new Date().toISOString();
   value={version:1,siteId:candidate.siteId,id,revision:candidate.revision,releaseId:candidate.id,configEtag,destination:saved.destinationKey,kind:saved.config.kind,startedAt:now,updatedAt:now,state:'running',plan,journal:{},manifest:await reviewedManifest(candidate),fileInventory};
  }
  value.state='running';value.errorCode=null;await write(target,value);
  const save=async journal=>{value.journal=journal;value.updatedAt=new Date().toISOString();await write(target,value);};
  try{
   const receipt=await target.deploy(candidate,configEtag,ownerId,{destinationReviewed:true},{plan:value.plan,journal:value.journal,save,signal,fileInventory:value.fileInventory,uploads:uploadProgress()});
   value.journal.receipt=receipt;value.state='completed';await save(value.journal);
   return {receipt,transfer:summary(value)};
  }catch(error){
   value.state='failed';value.errorCode=error instanceof AppError?error.code:'PUBLISH_REMOTE';
   await save(value.journal);throw error;
  }
 });
}

// An edited or withdrawn revision cannot be replayed. Establish which remote
// switch occurred and preserve its ownership before a fresh review can start.
export async function settleWebsiteTransfer(target,{configEtag,id,signal}){
 return target.workspace.withTransferLease(async()=>{
  const saved=await target.read(),value=await read(target,saved);
  if(!value||value.id!==id||value.configEtag!==configEtag||saved.etag!==configEtag)throw new AppError('PUBLISH_STALE');
  if(terminal.has(value.state))return summary(value);
  const {journal}=value;let active=false;
  if(value.kind==='ssh'&&journal.lockAttempted){
   const owner=await target.workspace.deploymentOwnerId();
   const inventory=new LocalExportManifest(target.workspace);
   const checksums=async function*(){for await(const row of inventory.entries(value.fileInventory)){signal?.throwIfAborted();yield row.sha256+'  '+row.path+'\n';}};
   active=await settleSSHTransfer(target.ssh,saved.config.ssh,owner,value,{signal,checksums});
  }else if(['sftp','ftp'].includes(value.kind)&&journal.lockAttempted){
   // Files already put in place stay recorded, so a later publication removes
   // or replaces them; the publication counts as delivered only with its receipt.
   if(journal.remote)await writeRemoteFiles(target.workspace,value.destination,journal.remote);
   active=!!journal.receipt;
  }else if(value.kind==='github'&&(journal.pushAttempted||journal.archiveAttempted)){
   const c=saved.config.github,base='/repos/'+c.owner+'/'+c.repository,plan=admitGithubPlan(value.plan);
   const repo=await target.github(base,'GET',undefined,false,signal);
   if(repo.id!==plan.repositoryId||!repo.permissions?.push)throw new AppError('PUBLISH_STALE');
   if(journal.archiveAttempted){
    const name=plan.replacement?.archiveBranch;if(!name)throw new AppError('JOB_DAMAGED');
    const archive=await target.github(base+'/git/ref/heads/'+name,'GET',undefined,true,signal);
    if(archive&&archive.object?.sha!==journal.parent||!archive&&journal.archive)throw new AppError('PUBLISH_ARCHIVE_BRANCH');
    if(archive)journal.archive={branch:name,commit:journal.parent};
   }
   const head=(await target.github(base+'/git/ref/heads/'+c.branch,'GET',undefined,true,signal))?.object?.sha??null;
   active=!!journal.pushAttempted&&!!journal.commit&&head===journal.commit;
   if(!active&&head!==journal.parent)throw new AppError('PUBLISH_STALE');
  }
  if(journal.receipt&&!active)throw new AppError('PUBLISH_STALE');
  return target.workspace.withPublicationMetadataBatch(async()=>{
   if(active){
    journal.receipt??={releaseId:value.releaseId,commit:journal.commit,at:new Date().toISOString(),status:value.kind==='ssh'?'uploaded-remote-verified':value.kind==='sftp'||value.kind==='ftp'?'uploaded-remote':saved.config.github.pages===false?'uploaded-repository-only':'uploaded',...value.manifest};
    journal.receipt.fileInventory=value.fileInventory;
    if(value.kind==='github')await writeGithubOwnership(target.workspace,value.destination,journal);
    await recordDeploymentInventory(target.workspace,value.destination,journal.receipt,journal.liveInventory);
    const receipts=await target.readFile(target.receiptsFile,{});
    receipts[value.destination]=journal.receipt;await target.workspace.writeMetadata('.observanda/publishing-receipts.json',JSON.stringify(receipts));
   }
   value.state='settled';value.errorCode=null;value.updatedAt=new Date().toISOString();await write(target,value);return summary(value);
  });
 });
}
