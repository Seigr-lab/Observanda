// Placement changes move an existing owner between named parent folders.
// The workspace registry supplies membership independently of owner payloads.
import path from 'node:path';
import {assertRegular} from './storage.js';
import {storageCreationPath} from './storage-names.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export function validProjectPlacement(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()==='expectedParentId,parentId'&&[value.parentId,value.expectedParentId].every(id=>id===null||researchId(id));}
export function projectPlacementLocation(registry,directory,entry,name,placement){
 if(placement!==null&&!validProjectPlacement(placement))throw new AppError('INVALID');
 const parentId=placement?.parentId??(placement?null:entry.parentId),byId=new Map(directory.projects.map(item=>[item.projectId,item]));
 if(placement&&entry.parentId!==placement.expectedParentId)throw new AppError('CONFLICT');
 const seen=new Set([entry.projectId]);for(let id=parentId;id!==null;){if(seen.has(id))throw new AppError('STORAGE_PATH');seen.add(id);const owner=byId.get(id);if(!owner)throw new AppError('NOT_FOUND');id=owner.parentId;}
 const parent=parentId===null?registry.workspace.root:byId.get(parentId)?.root;if(!parent)throw new AppError('NOT_FOUND');
 const destination=storageCreationPath(parent,name),relative=path.relative(entry.root,destination);
 if(placement&&destination!==entry.root&&(relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)))throw new AppError('STORAGE_PATH');
 return {parentId,parent,destination};
}
export function selectedProjectPlacement(registry,entry,name,placement){
 return registry.inspect(async view=>{
  const parentId=placement?.parentId??(placement?null:entry.parentId),projects=parentId===null?[]:await view.ancestors(parentId);
  return {...projectPlacementLocation(registry,{projects},entry,name,placement),revision:view.revision};
 });
}
export async function checkPlacementParent(registry,value){
 if(!value.placement)return;
 const selected=value.placement.parentId===null?null:await registry.state(value.placement.parentId),parent=value.placement.parentId===null?registry.workspace.root:selected?.state==='active'?selected.entry.root:null;
 if(!parent||path.relative(registry.workspace.root,parent).split(path.sep).join('/')!==value.placementParent.relative)throw new AppError('STORAGE_RENAME_STATE');
 const stat=await assertRegular(parent,{directory:true});if(String(stat.dev)!==value.placementParent.dev||String(stat.ino)!==value.placementParent.ino)throw new AppError('STORAGE_RENAME_STATE');
}
