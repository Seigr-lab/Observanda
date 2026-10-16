import {AppError} from './errors.js';
import {websiteRecordShare} from './web/website-selection.js';

// Called with an exact-base workspace command inside the writer transaction.
// Yield one changed original at a time, retaining every other field verbatim.
export async function* websiteSelectionRecords(store,snapshot,selection,{now,excluded=[]}={}){
 if(!selection)return;
 const metadata=snapshot.metadata,projects=new Set(metadata.projects.map(p=>p.id)),notebooks=new Map(metadata.notebooks.map(n=>[n.id,n.projectId]));
 if(selection.includeProjects.some(id=>!projects.has(id)))throw new AppError('INVALID');
 const selected=new Map(selection.records.map(item=>[item.id,item])),skip=new Set(excluded),found=new Set();
 for await(const row of store.members(snapshot)){
  const patch=selected.get(row.id),projectId=notebooks.get(row.notebookId);
  if(!patch&&!selection.includeProjects.includes(projectId))continue;
  if(skip.has(row.id))throw new AppError('INVALID');
  if(patch)found.add(row.id);
  const original=await store.record(row.id,row.revision),share=websiteRecordShare(selection,original,projectId);
  const attachments=original.attachments.map(attachment=>{const choice=patch?.attachments.find(a=>a.id===attachment.id);return choice?{...attachment,share:choice.share}:attachment;});
  if(patch?.attachments.some(a=>!original.attachments.some(item=>item.id===a.id)))throw new AppError('INVALID');
  if(share===original.share&&attachments.every((a,i)=>a.share===original.attachments[i].share))continue;
  yield {...original,share,attachments,updatedAt:now??original.updatedAt};
 }
 if(found.size!==selected.size)throw new AppError('RECORD_CHANGED');
}
