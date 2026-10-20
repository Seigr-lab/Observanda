import {nativeRelocationOwners} from './native-relocation-state.js';
// Pending source addresses follow the authenticated handoff location. Storage
// fences still prevent ordinary writes until both directories agree.
import path from 'node:path';
import {readFile,realpath,opendir} from 'node:fs/promises';
import {assertRegular,digest} from './storage.js';
import {readProjectWorkspaceMove,workspaceMoveScope,projectWorkspaceMoveFile} from './project-workspace-move-state.js';
import {projectMoveDirectory} from './project-move-boundaries.js';
import {projectTransferRunning} from './project-transfer-tasks.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export async function locateWorkspaceProjectMove(registry,value){
 const native=value.ownerDirectoryVersion===2,transferred=native?value.copied===true:value.version===2,scope=workspaceMoveScope(registry,value),owner=transferred?(native?await nativeRelocationOwners(registry,value).get(''):value.transfer.owners.find(item=>item.relative==='')):null;
 for(const root of transferred?[value.phase==='copying'?scope.source:scope.destination]:[scope.destination,scope.source]){
  const stat=await assertRegular(root,{directory:true,missing:true});if(!stat)continue;
  const actual=transferred||native?await projectMoveDirectory(root):{dev:String(stat.dev),ino:String(stat.ino)},expected=transferred?(root===scope.source?(native?owner.identity:owner.sourceIdentity):owner.destinationIdentity):value.identity;
  if(actual.dev!==expected?.dev||actual.ino!==expected?.ino||await realpath(root)!==root)continue;
  if(digest(await readFile(path.join(root,'.observanda/access.json')))!==value.accessHash&&!(['preparing','prepared'].includes(value.phase)&&root===scope.source))throw new AppError('STORAGE_MOVE_STATE');return root;
 }
 throw new AppError('STORAGE_MOVE_STATE');
}
export async function pendingWorkspaceProjectMove(registry,projectId,projects){
 const walk=async get=>{
  const seen=new Set();for(let id=projectId;id!==null;){
   if(seen.has(id))throw new AppError('FORMAT');seen.add(id);const value=await readProjectWorkspaceMove(registry,id);
   if(value&&!['complete','cancelled'].includes(value.phase))return value;
   const entry=await get(id);if(!entry)return null;id=entry.parentId;
  }
  return null;
 };
 if(projects===undefined)return registry.inspect(view=>walk(async id=>{const row=await view.get(id);return row?.state==='active'?row.entry:null;}));
 const entries=new Map(projects.map(entry=>[entry.projectId,entry]));return walk(id=>entries.get(id));
}
export async function workspaceProjectMoveLocation(registry,entry,projects){
 const value=await pendingWorkspaceProjectMove(registry,entry.projectId,projects);if(!value)return entry;
 const selected=value.ownerDirectoryVersion===2?(value.phase==='preparing'?{...entry,relative:path.relative(workspaceMoveScope(registry,value).source,entry.root).split(path.sep).join('/')}:await nativeRelocationOwners(registry,value).find('project',entry.projectId)):value.entries.find(item=>item.projectId===entry.projectId);if(!selected||selected.namespaceId!==entry.namespaceId||selected.vaultId!==entry.vaultId)throw new AppError('STORAGE_MOVE_STATE');
 return {...entry,root:path.join(await locateWorkspaceProjectMove(registry,value),...selected.relative.split('/'))};
}
export async function pendingWorkspaceProjectMoves(registry,{after=null,limit=20}={}){
 if(after!==null&&!researchId(after)||!Number.isSafeInteger(limit)||limit<1||limit>50)throw new AppError('INVALID');
 const directory=path.join(registry.workspace.root,'.observanda/project-workspace-moves'),items=[];if(!await assertRegular(directory,{directory:true,missing:true}))return {items,next:null};
 for await(const file of await opendir(directory)){
  if(!file.name.endsWith('.obsv')||!researchId(file.name.slice(0,-5))||after&&file.name.slice(0,-5)<=after)continue;
  const value=await readProjectWorkspaceMove(registry,file.name.slice(0,-5));if(!value||value.phase==='cancelled'||value.phase==='complete'&&value.released===true)continue;
  items.push({id:value.id,projectId:value.projectId,title:path.posix.basename(value.source),targetTitle:path.basename(value.target.root),path:value.target.root,workspaceId:value.target.workspaceId,parentId:value.placement.parentId,expectedParentId:value.parentId,phase:value.phase,running:projectTransferRunning(projectWorkspaceMoveFile(registry,value.projectId))});items.sort((a,b)=>a.projectId.localeCompare(b.projectId));if(items.length>limit+1)items.pop();
 }
 const more=items.length>limit;if(more)items.pop();return {items,next:more?items.at(-1).projectId:null};
}
