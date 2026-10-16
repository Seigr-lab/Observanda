// Recovery uses only the current workspace's authenticated device journal.
// Folder names in the request are never treated as recovery authority.
import path from 'node:path';
import {readAccess} from './access.js';
import {AppError} from './errors.js';
export async function workspaceRenameAccess(context,renames){
 const root=context.renameAccessRoot??context.root;
 if(!root)return {value:{formatVersion:1,username:'',password:null},etag:'none'};
 let access=await readAccess(root);
 if(access.etag==='none'){
  const recovery=await renames.recovery(context.root);
  if(recovery&&recovery.root!==root){context.renameAccessRoot=recovery.root;access=await readAccess(recovery.root);}
 }
 return access;
}
export async function workspaceRenameRecovery(renames,root){
 const recovery=root?await renames.recovery(root):null;if(!recovery)return null;
 const {value}=recovery;return {id:value.id,sourceName:path.basename(value.source),name:path.basename(value.destination),phase:value.phase};
}
export async function resumeWorkspaceRename(renames,root,id,vault,options={}){
 const recovery=await renames.recovery(root);if(!recovery||recovery.value.id!==id)throw new AppError('STORAGE_RENAME_STATE');
 const {value}=recovery;
 if(value.phase==='complete'){await renames.clearCompleted(recovery.root);return {id,source:value.source,destination:value.destination,complete:true};}
 return renames.resume(recovery.root,vault,options);
}
