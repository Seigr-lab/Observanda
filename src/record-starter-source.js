// Template capture reads chosen instruction values from one pinned source.
// Source discovery reads headings only; it never assembles a research record.
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validStarter} from './web/record-starter-model.js';
import {withRecordDocument} from './record-document.js';
import {RecordMemberCollections,memberCollectionCount} from './record-member-collections.js';

const natural=value=>Number.isSafeInteger(value)&&value>=0;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.slice().sort().join();
const invalid=()=>{throw new AppError('INVALID');};
const targetKeys=['workspaceId','recordId','snapshotId'];
export class RecordStarterSource{
 constructor(workspace){this.workspace=workspace;}
 async source(command,keys,read,{signal}={}){
  if(!exact(command,[...targetKeys,...keys])||!researchId(command.workspaceId)||!researchId(command.recordId)||!revisionId(command.snapshotId))invalid();
  signal?.throwIfAborted();
  return this.workspace.catalogue(async store=>{
   const current=await store.snapshot(await store.head()),snapshot=await store.snapshot(command.snapshotId);
   if(current.metadata.id!==command.workspaceId||snapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   if(snapshot.metadata.formatVersion!==21)throw new AppError('FORMAT');
   const row=await store.member(snapshot,command.recordId);if(!row)throw new AppError('MISSING');
   return withRecordDocument(store,row.id,row.revision,document=>read({store,row,document,signal}));
  });
 }
 async page(command,options){
  if(!natural(command?.offset))invalid();
  return this.source(command,['offset'],async({document,row,signal})=>{
   const total=memberCollectionCount(row,'sections');if(!natural(total)||command.offset>total)invalid();
   const values=[];
   for(let position=command.offset;position<Math.min(total,command.offset+20);position++){
    const path=['sections',String(position)],id=(await document.field([...path,'id'],{signal})).value,title=(await document.field([...path,'title'],{signal})).value;
    if(!researchId(id)||typeof title!=='string')throw new AppError('CATALOGUE_DAMAGED');values.push({id,title,position});
   }
   return {...command,storageRevision:row.revision,title:(await document.field(['title'],{signal})).value,type:(await document.field(['type'],{signal})).value,total,values};
  },options);
 }
 async prepare(command,options){
  if(typeof command?.body!=='boolean'||!Array.isArray(command.sections)||command.sections.length>20||command.sections.some(item=>!exact(item,['id','body'])||!researchId(item.id)||typeof item.body!=='boolean')||new Set(command.sections.map(item=>item.id)).size!==command.sections.length)invalid();
  return this.source(command,['body','sections'],async({store,row,document,signal})=>{
   const title=(await document.field(['title'],{signal})).value,type=(await document.field(['type'],{signal})).value;
   const draft={name:title.slice(0,120),type,title,body:command.body?(await document.field(['body'],{signal})).value:'',sections:[],tags:[]};
   if(!validStarter(draft,{portable:false}))throw new AppError('STARTER_INVALID');
   const membership=new RecordMemberCollections(store),chosen=[];
   for(const item of command.sections){signal?.throwIfAborted();const position=await membership.position(row,'sections',item.id);if(position<0)throw new AppError('MISSING');chosen.push({...item,position});}
   chosen.sort((a,b)=>a.position-b.position);
   for(const item of chosen){
    const path=['sections',String(item.position)];
    if((await document.field([...path,'id'],{signal})).value!==item.id)throw new AppError('CATALOGUE_DAMAGED');
    draft.sections.push({title:(await document.field([...path,'title'],{signal})).value,body:item.body?(await document.field([...path,'body'],{signal})).value:''});
    // Validate each selected instruction before returning this request's batch.
    if(!validStarter(draft,{portable:false}))throw new AppError('STARTER_INVALID');
   }
   return {workspaceId:command.workspaceId,recordId:row.id,snapshotId:command.snapshotId,storageRevision:row.revision,draft};
  },options);
 }
}
