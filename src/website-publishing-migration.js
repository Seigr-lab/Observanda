import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {readWebsiteDocumentRegistry} from './website-document-registry.js';
import {Publisher} from './publishing.js';
import {deploymentUncertain} from './publication-deployment-state.js';
import {liveManifestReceipt} from './publication-live-budget.js';
import {deploymentInventory,deploymentInventoryPaths,LivePathIndex} from './publication-live-inventory.js';
import {GithubPlanIndex} from './github-plan-index.js';
import {githubArchiveBranch,githubTreeFiles,readGithubOwnership} from './github-publication-plan.js';
import {LocalExport} from './local-export.js';
import {LocalExportManifest} from './local-export-manifest.js';
import {outputName} from './local-export-files.js';

const originFile='.observanda/publishing-origin.json';
const ownersFolder='.observanda/local-exports/owners';
const configFile='.observanda/publishing.json';
const receiptsFile='.observanda/publishing-receipts.json';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const commitHash=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const fail=()=>{throw new AppError('PUBLISH_OWNERSHIP');};

// A converted default website keeps the identity already installed in its SSH
// directory. The public site ID and the remote directory owner can differ.
export async function websiteDeploymentOwner(metadata,siteId){
 const raw=await metadata.readMetadata(originFile,1024);
 if(raw===null)return siteId;
 const value=JSON.parse(raw);
 if(value?.version!==1||value.siteId!==siteId||!researchId(value.ownerId))fail();
 return value.ownerId;
}

async function checkDeployment(source,key,workspaceId){
 const active=await source.readMetadata('.observanda/deployment-active/'+key+'.json',4096);
 if(active===null)return;
 const {id}=JSON.parse(active);
 if(!researchId(id))fail();
 const operation=JSON.parse(await source.readMetadata('.observanda/deployments/'+id+'.json',16*1024*1024));
 const job=JSON.parse(await source.readMetadata('.observanda/jobs/'+id+'.json',1024*1024));
 if(operation?.id!==id||operation.scope!==workspaceId||operation.intent?.key!==key||!operation.journal||
    job?.id!==id||job.type!=='publication.deploy'||job.scope!==workspaceId||(job.input?.websiteId??null)!==source.websiteId)fail();
 if(!['completed','failed','cancelled'].includes(job.state)||deploymentUncertain(operation.journal,operation.intent.config.kind))throw new AppError('PUBLISH_PENDING');
}

async function confirmedReceipt(source,saved,key){
 if(!saved.receipt)return null;
 const receipt=await liveManifestReceipt(source,key,saved.receipt)??saved.receipt;
 const {releaseId,commit,at,status,manifestHash,manifestBytes,manifestFiles}=receipt;
 const github=saved.config.kind==='github';
 const validStatus=github?['uploaded','uploaded-repository-only','uploaded-awaiting-pages','uploaded-pages-setup-required']:['uploaded-remote-verified'];
 if(!hash(releaseId)||!(github?commitHash(commit):commit===releaseId)||!Number.isFinite(Date.parse(at))||!validStatus.includes(status)||!hash(manifestHash))fail();
 const result={releaseId,commit,at,status,manifestHash};
 if(manifestBytes!==undefined||manifestFiles!==undefined){
  if(!Number.isSafeInteger(manifestBytes)||manifestBytes<1||!Number.isSafeInteger(manifestFiles)||manifestFiles<0)fail();
  Object.assign(result,{manifestBytes,manifestFiles});
 }
 if(Object.hasOwn(receipt,'previousRelease')){
  if(github||receipt.previousRelease!==null&&!hash(receipt.previousRelease))fail();
  result.previousRelease=receipt.previousRelease;
 }
 if(receipt.archive){
  if(!github||!githubArchiveBranch(receipt.archive.branch)||!commitHash(receipt.archive.commit))fail();
  result.archive={branch:receipt.archive.branch,commit:receipt.archive.commit};
 }
 if(receipt.deploymentId!==undefined){
  if(!researchId(receipt.deploymentId))fail();
  result.deploymentId=receipt.deploymentId;
 }
 // The previous live check belongs to the old edition. An explicit fresh
 // check can populate verification using the retained manifest fingerprint.
 return result;
}

async function transferGithubOwnership(publisher,target,config,key,receipt,signal){
 const ownership=await readGithubOwnership(publisher,config,receipt);
 if(!ownership)return;
 if(!receipt||ownership.repositoryId<1)fail();
 const entries=ownership.version===1?ownership.files:new GithubPlanIndex(publisher.workspace,ownership.document,{signal}).values('entries');
 const next=new GithubPlanIndex(target,{version:1,collections:{entries:null}},{signal});
 const prefix=config.github.directory?config.github.directory+'/':'';
 for await(const item of entries){
  signal?.throwIfAborted();
  const [row]=githubTreeFiles({tree:[item]});
  if(row?.type!=='blob'||row.mode!=='100644'||!row.path.startsWith(prefix))fail();
  outputName(row.path.slice(prefix.length));
  await next.add('entries',row.path,row);
 }
 const document=await next.finish();
 await target.writeMetadata('.observanda/publishing-ownership/'+key+'.json',serialize({
  version:2,repositoryId:ownership.repositoryId,commit:receipt.commit,releaseId:receipt.releaseId,document
 }));
}

async function transferLiveInventory(source,target,key,receipt,signal){
 const previous=await deploymentInventory(source,key);
 if(!previous)return;
 if(!receipt||previous.commit!==receipt.commit||previous.releaseId!==receipt.releaseId)fail();
 const index=new LivePathIndex(target);
 const result={version:2,commit:receipt.commit,releaseId:receipt.releaseId};
 for(const kind of ['files','removed']){
  const members=index.builder();
  for await(const path of deploymentInventoryPaths(source,previous,kind)){
   signal?.throwIfAborted();
   if(kind==='removed'&&await index.has(result.files,path))fail();
   await members.add(path);
  }
  result[kind]=await members.finish();
 }
 await target.writeMetadata('.observanda/publication-live/'+key+'.json',serialize(result));
}

async function transferFolderOwners(source,target,signal){
 const local=new LocalExport(source),files=new LocalExportManifest(target);
 for await(const name of source.metadataNames(ownersFolder,{signal})){
  if(!/^[a-f0-9]{64}\.json$/.test(name))fail();
  const file=ownersFolder+'/'+name,owner=await local.read(file);
  local.validateOwner(owner,owner?.directory);
  // The original exporter keys its destination by the host platform's path
  // comparison. Retain the original key on a cross-platform workspace copy.
  if(![digest(owner.directory),digest(owner.directory.toLowerCase())].includes(name.slice(0,-5)))fail();
  if(owner.pending!==null)throw new AppError('LOCAL_EXPORT_RECOVER');
  const builder=files.builder('files');
  const entries=owner.version===1?owner.files:local.manifest.entries(owner.files);
  for await(const row of entries){signal?.throwIfAborted();await builder.append(row);}
  const result={version:2,directory:owner.directory,files:await builder.finish(),pending:null};
  if(owner.directoryIdentity!==undefined)result.directoryIdentity=owner.directoryIdentity;
  if(owner.releaseId!==undefined)result.releaseId=owner.releaseId;
  await target.writeMetadata(file,serialize(result));
 }
}

// The caller holds the source website and destination file writer locks until
// importFiles commits its first head. Before that head, no staged metadata is
// reachable through the website API. Retries replace only staged owner roots.
export async function migrateWebsitePublishingMetadata(source,store,siteId,{signal}={}){
 signal?.throwIfAborted();
 if(!researchId(siteId)||!source.websiteContext||source.baseWorkspace!==store.workspace)fail();
 const registry=await source.baseWorkspace.catalogue(readWebsiteDocumentRegistry);
 if(!registry||siteId!==(source.websiteId??registry.defaultSiteId)||source.websiteId===registry.defaultSiteId)fail();
 if(await store.raw(siteId,{missing:true}))throw new AppError('CONFLICT');
 const base=store.publicationWorkspace(siteId);
 // Each index is rebuilt solely from validated public paths/fingerprints.
 // Give its builders only file metadata capabilities so they cannot resolve
 // a research catalogue through the migration's surrounding transaction.
 const direct=operation=>operation();
 const target={readMetadata:base.readMetadata,writeMetadata:base.writeMetadata,withLock:direct,
  withPublicationMetadataBatch:direct,withPublicationMetadataSnapshot:direct};
 const prior=await base.readMetadata(originFile,1024);
 const origin={version:1,ownerId:source.websiteId??registry.workspaceId,siteId};
 if(prior!==null&&prior!==serialize(origin))fail();
 if(prior===null&&await base.readMetadata(configFile,1024*1024)!==null)throw new AppError('CONFLICT');
 await base.writeMetadata(originFile,serialize(origin));
 for(const folder of [ownersFolder,'.observanda/publishing-ownership','.observanda/publication-live']){
  for await(const name of base.metadataNames(folder)){
   if(!/^[a-f0-9]{64}\.json$/.test(name))fail();
   await base.removeMetadata(folder+'/'+name);
  }
 }
 const publisher=new Publisher(source.root,{workspace:source}),saved=await publisher.read();
 if(saved.configured){
  const key=saved.destinationKey;
  await checkDeployment(source,key,registry.workspaceId);
  const receipt=await confirmedReceipt(source,saved,key);
  if(saved.config.kind==='github')await transferGithubOwnership(publisher,target,saved.config,key,receipt,signal);
  await transferLiveInventory(source,target,key,receipt,signal);
  await target.writeMetadata(receiptsFile,serialize(receipt?{[key]:receipt}:{}));
  await target.writeMetadata(configFile,serialize(saved.config));
 }else if(prior!==null){
  await base.removeMetadata(configFile);
  await base.removeMetadata(receiptsFile);
 }
 await transferFolderOwners(source,target,signal);
}
