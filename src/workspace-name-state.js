// The directory is the current workspace name. Historical snapshots retain
// their original titles; adopting this contract adds one metadata revision.
import {workspaceFolderName,validateWorkspaceName} from './workspace-names.js';
import {AppError} from './errors.js';

export async function synchronizeWorkspaceName(workspace){
 if(!workspace||workspace.projectId!==undefined)throw new AppError('INVALID');
 const title=validateWorkspaceName(workspaceFolderName(workspace.root));
 const outline=await workspace.outline();
 if(outline.metadata.title===title)return outline;
 if(await workspace.storageKind()!=='catalogue'){
  await workspace.update(book=>book.title===title?null:{...book,title});
 }else await workspace.withLock(()=>workspace.catalogue(async store=>{
  const head=await store.head(),snapshot=await store.snapshot(head);
  if(snapshot.metadata.title===title)return;
  const current=await store.indexed(snapshot);
  await store.commitChanges(head,current,{...current.metadata,title},[],{now:new Date().toISOString()});
 }));
 return workspace.outline();
}

export function requireCurrentWorkspaceName(workspace,title){
 if(workspace?.projectId===undefined&&title!==undefined&&title!==workspaceFolderName(workspace.root))throw new AppError('WORKSPACE_NAME_MISMATCH');
}
