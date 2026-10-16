import {recordRevision} from './research.js';
import {exact,uuid,requireValue,unique} from './modules/validation.js';

const revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const validReviewRecords=records=>Array.isArray(records)&&records.length>0&&records.length<=50&&unique(records.map(r=>r?.id))&&records.every(r=>exact(r,['id','revision'])&&uuid(r.id)&&revision(r.revision));

// Reviews use the same authenticated membership and query documents as record
// browsing. Planning and status checks never assemble the workspace's bodies.
export class ReviewRecords{
 constructor(workspace){this.workspace=workspace;}
 async plan(workspaceId,scope){
  requireValue(exact(scope,['kind','id'])&&['record','notebook'].includes(scope.kind)&&uuid(scope.id),'Review selection');
  return this.workspace.catalogue(async store=>{
   const source=await store.snapshot();requireValue(source.metadata.id===workspaceId,'Workspace changed');
   const rows=[];
   if(scope.kind==='record'){const row=await store.member(source,scope.id);if(row)rows.push(row);}
   else{
    requireValue(source.metadata.notebooks.some(n=>n.id===scope.id),'Lab book unavailable');
    for await(const row of store.members(source,{notebookIds:new Set([scope.id])})){
     rows.push(row);requireValue(rows.length<=50,'Choose a lab book with up to 50 records, or request review from an individual record.');
    }
   }
   requireValue(rows.length>0,'No saved records in this selection');
   rows.sort((a,b)=>a.position-b.position);
   const records=[];
   for await(const value of store.queryDocuments(rows,source.metadata,{revisions:true,search:false}))records.push({id:value.id,title:value.title,revision:value.revision??recordRevision(await store.record(value.id,value.storageRevision))});
   return {workspaceId,scope,records};
  });
 }
 async load(workspaceId,records){
  requireValue(validReviewRecords(records),'Choose 1 to 50 saved record revisions');
  return this.workspace.catalogue(async store=>{
   const source=await store.snapshot();requireValue(source.metadata.id===workspaceId,'Workspace changed');const selected=[];
   for(const ref of records){
    const row=await store.member(source,ref.id);requireValue(!!row,'A selected record is unavailable. Preview the selection again.');
    const record=await store.record(row.id,row.revision);
    requireValue(recordRevision(record)===ref.revision,'A selected record changed. Preview the selection again.');
    selected.push({...ref,record});
   }
   return selected;
  });
 }
 async current(workspaceId,ids){
  return this.workspace.catalogue(async store=>{
   const source=await store.snapshot();requireValue(source.metadata.id===workspaceId,'Workspace changed');const values=new Map();
   for(const id of new Set(ids)){
    const row=await store.member(source,id);if(!row){values.set(id,null);continue;}
    for await(const value of store.queryDocuments([row],source.metadata,{revisions:true,search:false}))values.set(id,value.revision??recordRevision(await store.record(id,row.revision)));
   }
   return values;
  });
 }
}
