import {AppError} from './errors.js';
import {ownerSourceDirectory} from './owner-source-directory.js';
import {ownerSourceHost} from './owner-source-host.js';
import {projectCollectionReader} from './project-collection-reader.js';
import {LabBookDirectory} from './lab-book-directory.js';
import {materialRecordSummary} from './material-record-summary.js';
import {sourceRecordAllowed,publicRecordAttachments} from './web/source-publication-permissions.js';
import {researchId} from './web/research-reference.js';
import {exact} from './modules/validation.js';

// One workspace is one body of work: any of its projects and lab books can be
// reached from any other part of it, never from another workspace. An owner is
// opened only with the grant this client already holds (its session or this
// device's key); knowing an id grants nothing. Records leave an owner only
// through the source projection, so the owner's own privacy decides visibility.
export const LOCKED_OWNER_CODES=Object.freeze(['ACCESS_LOCKED','ACCESS_DENIED','AUTH','DEVICE_UNKNOWN']);
const locked=error=>LOCKED_OWNER_CODES.includes(error?.code);
const ownerKind={content:'project',book:'lab-book'};

export async function workspaceOwnerReach(application,client,workspaceId,{scope=null,labBookId=null,check=async()=>{},signal}={}){
 await check();signal?.throwIfAborted();
 const {registry,directory}=await ownerSourceHost(application,{workspaceId,scope,labBookId}),reader=projectCollectionReader(application,client,check);
 async function locate(sourceId){
  if(!researchId(sourceId))throw new AppError('INVALID');
  if(sourceId===registry.workspaceId)return {workspaceId:sourceId,projectId:null,labBookId:null};
  let entry;
  try{entry=await registry.namespace(sourceId);}
  catch(error){if(error.code!=='NOT_FOUND')throw error;entry=await new LabBookDirectory(registry).locate(sourceId);if(!entry)throw error;}
  return {workspaceId:entry.namespaceId,projectId:entry.projectId,labBookId:entry.labBookId??null};
 }
 // Authentication only: the probe opens no record and keeps no credential.
 async function access(owner){
  if(!owner.projectId)return 'open';
  try{await reader.useStorage(owner,async()=>true);return 'open';}
  catch(error){if(locked(error))return 'locked';throw error;}
 }
 async function use(owner,consume){
  try{return await reader.use(owner,undefined,consume);}
  catch(error){if(locked(error)){error.projectId??=owner.projectId;if(owner.labBookId)error.labBookId??=owner.labBookId;}throw error;}
 }
 return {
  host:{workspaceId,projectId:scope,labBookId},
  async owners(command){
   const page=await ownerSourceDirectory(application,client,command,{scope,labBookId,check,signal,includeHost:true}),items=[];
   for(const item of page.items){
    signal?.throwIfAborted();const owner={workspaceId:item.workspaceId,projectId:item.projectId,labBookId:item.labBookId};
    items.push({...item,kind:ownerKind[item.kind]??item.kind,current:item.workspaceId===workspaceId,access:item.workspaceId===workspaceId?'open':await access(owner)});
   }
   return {...page,items};
  },
  async records(command){
   if(!exact(command,['workspaceId','sourceId','search','offset','limit'])||command.workspaceId!==workspaceId||typeof command.search!=='string'||command.search.length>160||!Number.isSafeInteger(command.offset)||command.offset<0||!Number.isSafeInteger(command.limit)||command.limit<1||command.limit>25)throw new AppError('INVALID');
   const owner=await locate(command.sourceId),needle=command.search.trim().toLocaleLowerCase();
   return use(owner,async(store,snapshot,{snapshotId})=>{
    const metadata=snapshot.metadata,chosen=[];let total=0;
    for await(const record of store.queryDocuments(store.members(snapshot,{signal}),metadata,{signal,search:false})){
     signal?.throwIfAborted();
     if(!sourceRecordAllowed(record,metadata)||needle&&!record.title.toLocaleLowerCase().includes(needle))continue;
     if(total>=command.offset&&chosen.length<command.limit)chosen.push(record.id);total++;
    }
    const items=[];
    for(const id of chosen){
     signal?.throwIfAborted();const row=await store.member(snapshot,id);if(!row)throw new AppError('CATALOGUE_DAMAGED');
     const [summary,record]=await Promise.all([materialRecordSummary(store,row),store.record(row.id,row.revision)]);
     if(!sourceRecordAllowed(record,metadata))throw new AppError('CATALOGUE_DAMAGED');
     const book=metadata.notebooks.find(item=>item.id===record.notebookId);
     items.push({id:record.id,revision:summary.revision,title:record.title,notebookId:record.notebookId,notebook:book?.title??'',projectId:book?.projectId??null,
      attachments:publicRecordAttachments(record).map(item=>({id:item.id,name:typeof item.name==='string'?item.name:''}))});
    }
    return {workspaceId,sourceId:command.sourceId,owner,snapshotId,title:metadata.title,items,offset:command.offset,total};
   });
  },
  async verify(){await reader.verify();if(await registry.version()!==directory.revision)throw new AppError('CONFLICT');signal?.throwIfAborted();},
  close:()=>reader.close()
 };
}

// HTTP entry for the project, lab-book and workspace routes.
export async function workspaceOwnerRequest(application,client,operation,data,{scope=null,labBookId=null,check,signal}={}){
 if(!data||typeof data!=='object'||Array.isArray(data)||data.workspaceId!==null&&!researchId(data.workspaceId))throw new AppError('INVALID');
 // The workspace's own editors (such as the website files editor) address the
 // workspace itself; any other host names the namespace it was opened from.
 if(data.workspaceId===null){if(scope!==null||labBookId!==null)throw new AppError('INVALID');data={...data,workspaceId:(await application.registry()).workspaceId};}
 const reach=await workspaceOwnerReach(application,client,data.workspaceId,{scope,labBookId,check,signal});
 try{
  const result=operation==='workspace-owners'?await reach.owners(data):await reach.records(data);
  await reach.verify();return result;
 }finally{await reach.close();}
}
