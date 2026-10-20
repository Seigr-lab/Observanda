// A workspace move grants only the placement saved in its authenticated
// directory pin. Ordinary external moves cannot borrow this path exception.
import path from 'node:path';
import {Workspace,serialize} from './storage.js';
import {readWorkspaceProjectMove} from './workspace-project-move-state.js';
import {withWorkspaceMoveDirectory} from './workspace-move-directory.js';
import {projectRegistryDescendantPrefix} from './project-registry-locations.js';
import {AppError} from './errors.js';
const same=(a,b)=>a&&b&&['projectId','namespaceId','vaultId','parentId'].every(key=>a[key]===b[key]);
const inside=(root,child)=>{const part=path.relative(root,child);return part!==''&&part!=='..'&&!part.startsWith('..'+path.sep)&&!path.isAbsolute(part);};
export async function assertWorkspaceProjectMoveOwner(registry,owner,context){
 const value=await readWorkspaceProjectMove(new Workspace(owner.workspaceMoveDestination,registry.workspace.vault));
 if(!value||value.version!==2||value.id!==owner.workspaceMoveId||value.workspaceId!==registry.workspaceId||![value.source,value.destination].includes(registry.workspace.root)||value.directory.revision!==owner.workspaceMoveRevision||value.phase!=='projects'&&owner.phase!=='complete')throw new AppError('STORAGE_MOVE_STATE');
 const check=async directory=>{
  const selected=await directory.get(owner.projectId);
  if(!same(selected,owner)||selected.root!==owner.source||selected.destination!==owner.destination||selected.transferId!==owner.id||!inside(value.destination,owner.destination))throw new AppError('STORAGE_MOVE_STATE');
  await registry.inspect(async view=>{
   const current=await view.get(owner.projectId);if(current?.state!=='active'||!same(current.entry,selected)||![selected.root,selected.destination].includes(current.entry.root))throw new AppError('CONFLICT');
   // Each already moved ancestor must still be the pinned owner, at its exact
   // target path. No caller-provided list can authorize an unrelated parent.
   let parentId=selected.parentId,child=selected;
   for(let root=path.dirname(selected.destination);root!==value.destination;root=path.dirname(root)){
    if(!inside(value.destination,root))throw new AppError('STORAGE_MOVE_STATE');const actual=await view.get(registry.locationKey(root),{index:'location'});
    if(actual){const parent=parentId===null?null:await directory.get(parentId);if(!same(actual.entry,parent)||actual.entry.root!==parent?.destination||parent.destination!==root||path.dirname(child.destination)!==root)throw new AppError('STORAGE_PATH');parentId=parent.parentId;child=parent;}
   }
   if(parentId!==null)throw new AppError('STORAGE_PATH');
   const occupied=await view.get(registry.locationKey(owner.destination),{index:'location'});if(occupied&&occupied.entry.projectId!==owner.projectId)throw new AppError('STORAGE_PATH');
   if(current.entry.root===owner.source){const children=await view.page({index:'location',prefix:projectRegistryDescendantPrefix(owner.destination,registry.workspace.root),limit:1});if(children.items.length)throw new AppError('STORAGE_PATH');}
  });
 };
 if(context){if(context.value.id!==value.id||context.value.source!==value.source||context.value.destination!==value.destination||serialize(context.value.directory)!==serialize(value.directory))throw new AppError('STORAGE_MOVE_STATE');return check(context.directory);}
 return withWorkspaceMoveDirectory(registry.workspace,value,check);
}
