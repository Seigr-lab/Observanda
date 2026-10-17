// Imported history is a selected original, never a second lab-book snapshot.
// Its original notebook scope and bytes stay exact while its lookup belongs to
// the destination catalogue. Current lab-book metadata invariants stay strict.
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validMember} from './snapshot-index.js';
import {validRecordOwner} from './record-owner-transfer-state.js';
import {catalogueFormat,catalogueRequiresRecordOwnerTransfers} from './catalogue-format.js';
import {websiteMetadataShell} from './website-owned-metadata.js';
import {retainRecordOwnerResource} from './record-owner-resources.js';
const prefix='record-owner-history:';
const hash=value=>digest(serialize(value));
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
function* configurations(metadata){
 for(const notebook of metadata.notebooks??[])if(notebook.configuration?.format==='observanda-configuration')yield {owner:{workspaceId:metadata.id,projectId:notebook.projectId,notebookId:notebook.id,slot:'configuration'},pointer:notebook.configuration,replace:value=>{notebook.configuration=value;}};
 for(const project of metadata.projects??[])if(project.labBookTemplate?.configuration?.format==='observanda-configuration')yield {owner:{workspaceId:metadata.id,projectId:project.id,notebookId:null,slot:'labBookTemplate'},pointer:project.labBookTemplate.configuration,replace:value=>{project.labBookTemplate.configuration=value;}};
}
const configurationResources=metadata=>[...configurations(metadata)].flatMap(({pointer})=>[{kind:'state',key:'configuration-block:value:'+pointer.root,revision:pointer.root},...(pointer.index.root?[{kind:'state',key:'configuration-block:index:'+pointer.index.root.hash,revision:pointer.index.root.hash}]:[])]);
async function checkConfigurations(store,metadata,{verify=false,signal,verified={once:(_identity,check)=>check()}}={}){
 for(const {owner,pointer} of configurations(metadata)){
  const {ConfigurationDocuments}=await import('./configuration-documents.js'),documents=new ConfigurationDocuments(store);
  if(verify)await verified.once(['configuration-document',owner,pointer],()=>documents.verify(owner,pointer,{signal}));else await documents.open(owner,pointer,{signal});
 }
}
export function recordOwnerHistoryMetadata(metadata,notebookId,workspaceId){
 const notebook=metadata.notebooks.find(value=>value.id===notebookId);if(!notebook)fail();
 const project=metadata.projects.find(value=>value.id===notebook.projectId);if(!project)fail();
 const value=metadata.formatVersion===21?websiteMetadataShell(metadata):structuredClone(metadata);
 value.id=workspaceId;value.entries=[];value.notebooks=[structuredClone(notebook)];value.projects=[{...structuredClone(project),parentId:null}];
 if(value.pages)value.pages=[];if(value.branding)value.branding=[];delete value.websites;
 if(value.website){value.website={...value.website,navigation:[],layouts:[]};}
 return value;
}
// Configuration cloning uses the transfer's short persistence callback. The
// read connection never holds the target writer while traversing a large tree.
export async function copyRecordOwnerHistoryMetadata(from,target,metadata,notebookId,workspaceId,{write,signal}={}){
 const value=recordOwnerHistoryMetadata(metadata,notebookId,workspaceId),references=[...configurations(value)];if(!references.length)return value;
 if(typeof write!=='function')throw new AppError('INVALID');signal?.throwIfAborted();const db=await target.openCatalogue();
 try{
  await db.run('BEGIN ISOLATION LEVEL READ COMMITTED');const store=target.catalogueStore(db),{ConfigurationDocuments}=await import('./configuration-documents.js');
  if((await store.snapshot()).metadata.id!==workspaceId)fail();
  await db.scope(()=>target.inspectCatalogue(store,async()=>{
   const destination=new ConfigurationDocuments(store,{write}),source=new ConfigurationDocuments(from);
   for(const reference of references){signal?.throwIfAborted();const reader=await source.open({...reference.owner,workspaceId:metadata.id},reference.pointer,{signal});reference.replace(await destination.clone(reference.owner,reader,{signal}));}
  }));
  await db.run('COMMIT');return value;
 }finally{await db.close();}
}
export async function retainRecordOwnerHistory(store,{recordId,sourceOwner,sourceSnapshotId,metadata,member}){
 if(!researchId(recordId)||!validRecordOwner(sourceOwner)||!revisionId(sourceSnapshotId)||!validMember(member)||member.id!==recordId||metadata.id!==(await store.snapshot()).metadata.id)throw new AppError('INVALID');
 await checkConfigurations(store,metadata);
 const value={version:1,recordId,sourceOwner,sourceSnapshotId,metadata,member},id=hash(value),slot=prefix+id;
 const prior=await store.object(slot);if(prior&&hash(prior)!==id)fail();
 await retainRecordOwnerResource(store,{kind:'object',key:slot,revision:id},{present:!!prior,dependencies:[{kind:'record',id:recordId,revision:member.revision},...Object.values(member.collections??{}).filter(Boolean).map(ref=>({kind:'state',key:'record-member-collection:'+ref.hash,revision:ref.hash})),...configurationResources(metadata)]});if(!prior)await store.putObject(slot,value);return id;
}
export async function readRecordOwnerHistory(store,id,recordId,{verifyConfigurations=false,signal,verified}={}){
 if(!revisionId(id)||!researchId(recordId))throw new AppError('INVALID');
 const value=await store.object(prefix+id);if(!value)return null;
 if(!catalogueRequiresRecordOwnerTransfers(await catalogueFormat(store.db))||Object.keys(value).sort().join()!=='member,metadata,recordId,sourceOwner,sourceSnapshotId,version'||value.version!==1||value.recordId!==recordId||hash(value)!==id||!validRecordOwner(value.sourceOwner)||!revisionId(value.sourceSnapshotId)||!validMember(value.member)||value.member.id!==recordId||value.metadata.id!==(await store.snapshot()).metadata.id||value.metadata.entries?.length!==0||!value.metadata.notebooks?.some(book=>book.id===value.member.notebookId))fail();
 await checkConfigurations(store,value.metadata,{verify:verifyConfigurations,signal,verified});
 return {metadata:value.metadata,records:[value.member],recordOwnerHistory:{id,sourceOwner:value.sourceOwner,sourceSnapshotId:value.sourceSnapshotId}};
}
