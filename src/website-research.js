import {sourceRecordAllowed} from './web/source-publication-permissions.js';
import {publicationWorkspace,publicationSnapshot,assertWebsitePin} from './publication-pin.js';
import {websiteEditorProjection} from './website-editor-projection.js';
import {websiteRecordSections} from './website-record-sections.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validWebsiteSelection,websiteRecordShare} from './web/website-selection.js';
import {compareTitles,compareKey} from './web/query-order.js';
import {summaryPage} from './summary-page.js';
import {digest} from './storage-format.js';

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const invalid=()=>{throw new AppError('INVALID');};
const searchValid=value=>typeof value==='string'&&value.length<=512;
const cursorValid=value=>value===null||typeof value==='string'&&value.length>0&&value.length<=4096;
// Native website discovery needs only its immutable header. Keep the same
// notebook boundary as the legacy website adapter when using research storage.
function scopedResearchStore(store,metadata){
 const ids=new Set(metadata.notebooks.map(notebook=>notebook.id)),adapter={
  async member(snapshot,id){const row=await store.member(snapshot,id);return row&&ids.has(row.notebookId)?row:null;},
  async *members(snapshot,options){for await(const row of store.members(snapshot,options))if(ids.has(row.notebookId))yield row;},
  async *queryDocuments(rows,book,options){async function* selected(){for await(const row of rows)if(!row.notebookId||ids.has(row.notebookId))yield row;}yield* store.queryDocuments(selected(),book,options);}
 };
 return new Proxy(store,{get(target,key){if(Object.hasOwn(adapter,key))return adapter[key];const value=target[key];return typeof value==='function'?value.bind(target):value;}});
}
export class WebsiteResearch{
 constructor(workspace){this.workspace=publicationWorkspace(workspace);}
 async run(operation,command,{signal}={}){
  const fields={summary:['selection','search'],content:['projectId','search','cursor'],record:['recordId'],sections:['recordId','offset'],media:['search','cursor']}[operation];
  if(!fields||!exact(command,['workspaceId','snapshotId',...(Object.hasOwn(command??{},'websitePin')?['websitePin']:[]),...fields])||!researchId(command.workspaceId)||!revisionId(command.snapshotId))invalid();
  if('search' in command&&!searchValid(command.search)||'cursor' in command&&!cursorValid(command.cursor)||operation==='summary'&&!validWebsiteSelection(command.selection)||operation==='content'&&!researchId(command.projectId)||['record','sections'].includes(operation)&&!researchId(command.recordId)||operation==='sections'&&(!Number.isSafeInteger(command.offset)||command.offset<0))invalid();
  command=structuredClone(command);signal?.throwIfAborted();if(await this.workspace.storageKind()!=='catalogue')throw new AppError('FORMAT');
  const native=!!command.websitePin?.websiteRevision,workspace=native?(this.workspace.baseWorkspace??this.workspace):this.workspace;
  return workspace.catalogue(async sourceStore=>{
   if((await sourceStore.snapshot()).metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   let snapshot,store=sourceStore;
   if(native){
    assertWebsitePin(this.workspace,command.websitePin,command.snapshotId);
    ({snapshot}=await websiteEditorProjection(sourceStore,this.workspace.websiteId??null,{websitePin:command.websitePin,pageLabels:false,signal}));
    store=scopedResearchStore(sourceStore,snapshot.metadata);
   }else snapshot=await publicationSnapshot(store,this.workspace,command.snapshotId,command.websitePin);
   const metadata=snapshot.metadata;
   if(metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const response={workspaceId:command.workspaceId,snapshotId:command.snapshotId,websitePin:snapshot.websitePin},projectIds=new Map(metadata.notebooks.map(n=>[n.id,n.projectId])),needle=command.search?.trim().toLocaleLowerCase();
   const documents=(rows,options={})=>store.queryDocuments(rows,metadata,{signal,search:false,cardSources:true,publication:true,...options});
   const window=(limit,order,point)=>{
    const {cursor,...query}=command,identity=digest(JSON.stringify({operation,...query,websitePin:snapshot.websitePin}));let anchor={identity,offset:0,after:null};
    if(cursor){try{anchor=store.decode('website-research-page',command.workspaceId,Buffer.from(cursor,'base64url'));}catch{throw new AppError('RECORD_QUERY_CURSOR');}}
    if(anchor?.identity!==identity||!Number.isSafeInteger(anchor.offset)||anchor.offset<0||anchor.offset%limit||anchor.offset>0&&(!anchor.after||typeof anchor.after.title!=='string'||typeof anchor.after.id!=='string'))throw new AppError('RECORD_QUERY_CURSOR');
    const page=summaryPage({...anchor,limit,order,point}),encode=value=>store.encode('website-research-page',command.workspaceId,value).toString('base64url');
    return {add:page.add,finish(){const {records:items,total,after,previousAfter}=page.finish();return {items,total,offset:anchor.offset,previousCursor:anchor.offset?encode({...anchor,offset:Math.max(0,anchor.offset-limit),after:previousAfter}):null,nextCursor:anchor.offset+items.length<total?encode({...anchor,offset:anchor.offset+items.length,after}):null};}};
   };
   if(operation==='sections')return {...response,...await websiteRecordSections(store,snapshot,command.recordId,command.offset,{signal})};
   if(operation==='record'){
    const row=await store.member(snapshot,command.recordId);if(!row)throw new AppError('NOT_FOUND');
    const record=await store.record(row.id,row.revision);signal?.throwIfAborted();
    // Attachment metadata only, not record prose, figures, fields or evidence.
    return {...response,record:{id:record.id,title:record.title,notebookId:record.notebookId,type:record.type,share:record.share,attachments:record.attachments}};
   }
   if(operation==='summary'){
    const projects=new Map(metadata.projects.map(p=>[p.id,{id:p.id,total:0,included:0,media:0,includedMedia:0,matches:!needle||p.title.toLocaleLowerCase().includes(needle)}]));
    const selectedNotebooks=new Set(),selectionProjects={},overrides=new Set(command.selection.records.map(row=>row.id));let media=0,entries=0;
    for await(const record of documents(store.members(snapshot,{signal}))){
     signal?.throwIfAborted();const projectId=projectIds.get(record.notebookId),group=projects.get(projectId);if(!group)throw new AppError('CATALOGUE_DAMAGED');
     group.total++;group.media+=record.cardSources.files.length;if(overrides.has(record.id))selectionProjects[record.id]=projectId;
     if(needle&&record.title.toLocaleLowerCase().includes(needle))group.matches=true;
     if(sourceRecordAllowed(record,metadata)&&websiteRecordShare(command.selection,record,projectId)){
      group.included++;selectedNotebooks.add(record.notebookId);entries++;
      const choices=command.selection.records.find(r=>r.id===record.id)?.attachments??[];
      const includedMedia=record.publication.attachments.filter(a=>a.share===true&&(choices.find(choice=>choice.id===a.id)?.share??true)).length;
      media+=includedMedia;group.includedMedia+=includedMedia;
     }
    }
    return {...response,projects:[...projects.values()],notebookIds:[...selectedNotebooks],entries,media,selectionProjects};
   }
   if(operation==='content'){
    const project=metadata.projects.find(p=>p.id===command.projectId);if(!project)invalid();
    const ids=new Set(metadata.notebooks.filter(n=>n.projectId===project.id).map(n=>n.id)),all=!needle||project.title.toLocaleLowerCase().includes(needle);
    const page=window(10,(a,b)=>compareTitles(a.title,b.title)||compareKey(a.id,b.id),({id,title})=>({id,title}));
    for await(const record of documents(store.members(snapshot,{signal,notebookIds:ids}))){
     if(!ids.has(record.notebookId)||!all&&!record.title.toLocaleLowerCase().includes(needle))continue;
     const {id,title,notebookId,type,share}=record;page.add({id,title,notebookId,type,share,attachmentCount:record.cardSources.files.length});
    }
    return {...response,...page.finish()};
   }
   const page=window(12,(a,b)=>compareTitles(a.title,b.title)||compareKey(a.id,b.id),({id,title})=>({id,title}));
   for await(const record of documents(store.members(snapshot,{signal}),{revisions:true}))for(const file of record.cardSources.files){
    const label=record.title+' / '+file.title;if(needle&&!label.toLocaleLowerCase().includes(needle))continue;
    page.add({id:file.key,title:label,key:file.key,label,entryId:record.id,storageRevision:record.storageRevision});
   }
   const result=page.finish(),items=[];
   for(const item of result.items){
    signal?.throwIfAborted();const record=await store.record(item.entryId,item.storageRevision),asset=record.attachments.find(a=>item.key===record.id+':'+a.id);if(!asset)throw new AppError('CATALOGUE_DAMAGED');
    items.push({key:item.key,label:item.label,entryId:item.entryId,asset});
   }
   return {...response,...result,items};
  });
 }
}
