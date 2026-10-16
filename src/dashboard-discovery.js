import {recordCardDiscovery} from './record-card-discovery.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {researchCardFields} from './web/research-card-items.js';
import {discoveryMatches} from './web/data-discovery.js';
import {labRecordProvider,labDataNotebooks,labDataRecord} from './web/laboratory/data-scope.js';
import {memberCollectionCount} from './record-member-collections.js';

// One immutable snapshot, one provider and one retained result page. Reuses
// encrypted query documents; discovery never assembles an editable workspace.
export class DashboardDiscovery{
 constructor(workspace){this.workspace=workspace;}
 async read(command,{signal}={}){
  if(!command||Object.keys(command).sort().join()!=='etag,limit,offset,provider,search,workspaceId')throw new AppError('INVALID');
  const {workspaceId,etag,provider,search,offset,limit}=command;
  const lab=labRecordProvider(provider),recordProvider=provider==='records'||Boolean(lab);
  if(!researchId(workspaceId)||!revisionId(etag)||!recordProvider&&!Object.hasOwn(researchCardFields,provider)||typeof search!=='string'||search.length>512||!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>12)throw new AppError('INVALID');
  signal?.throwIfAborted();
  return this.workspace.catalogue(async store=>{
   if((await store.snapshot()).metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const snapshot=await store.snapshot(etag);if(snapshot.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const notebooks=new Map((lab?labDataNotebooks(snapshot.metadata.notebooks,lab.profile):snapshot.metadata.notebooks).map(n=>[n.id,n.title])),items=[];let total=0;
   const rows=async function*(){for await(const row of store.members(snapshot,{signal,notebookIds:new Set(notebooks.keys())})){
    const field=researchCardFields[provider],count=recordProvider?null:memberCollectionCount(row,field);
    if(recordProvider||count===null||count)yield row;
   }};
   for await(const doc of store.queryDocuments(rows(),snapshot.metadata,{signal,search:false,cardSources:false})){
    if(!notebooks.has(doc.notebookId)||lab&&!labDataRecord(doc,lab.profile))continue;
    if(recordProvider){const item={key:doc.id,title:doc.title,subtitle:notebooks.get(doc.notebookId)??''};if(discoveryMatches(item,search)){if(total>=offset&&items.length<limit)items.push(item);total++;}}
    else{const row=await store.member(snapshot,doc.id),result=await recordCardDiscovery(store,row,doc,{provider,search,offset:Math.max(0,offset-total),limit:Math.max(0,limit-items.length),signal});items.push(...result.items);total+=result.total;}
   }
   return {workspaceId,etag,provider,items,total,offset};
  });
 }
}
