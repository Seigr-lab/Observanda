// Keep each independent owner in its declared physical project tree.
import path from 'node:path';
import {validateStorageName} from './storage-names.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const inside=(parent,child)=>{const relative=path.relative(parent,child);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const pathKey=value=>['win32','darwin'].includes(process.platform)?value.normalize('NFC').toLowerCase():value;
const absolute=value=>typeof value==='string'&&path.isAbsolute(value)&&path.resolve(value)===value;
export function legacyWorkspaceProjectDestination(source,destination,entry){
 return path.resolve(destination,inside(source,entry.root)?path.relative(source,entry.root):path.join('projects',entry.projectId,path.basename(entry.root)));
}
export function workspaceProjectPlacements(source,destination,entries,{version=2}={}){
 if(![1,2].includes(version)||!absolute(source)||!absolute(destination)||source===destination||inside(source,destination)||inside(destination,source)||!Array.isArray(entries))throw new AppError('STORAGE_PATH');
 const byId=new Map(),roots=new Map(),children=new Map(),pending=[];
 for(const entry of entries){
  if(!researchId(entry?.projectId)||entry.parentId!==null&&!researchId(entry.parentId)||!absolute(entry.root)||entry.root===source||inside(entry.root,source)||byId.has(entry.projectId)||roots.has(pathKey(entry.root)))throw new AppError('STORAGE_PATH');
  if(version===2){const name=validateStorageName(path.basename(entry.root),{nameError:'STORAGE_PATH'});if(['.observanda','observanda.json'].includes(pathKey(name)))throw new AppError('STORAGE_PATH');}
  byId.set(entry.projectId,entry);roots.set(pathKey(entry.root),entry.projectId);
 }
 for(const entry of entries){
  if(entry.parentId===null)pending.push(entry);
  else {const parent=byId.get(entry.parentId);if(!parent||path.dirname(entry.root)!==parent.root)throw new AppError('STORAGE_PATH');const list=children.get(parent.projectId)??[];list.push(entry);children.set(parent.projectId,list);}
  // An undeclared physical parent would let a sibling transfer claim its files.
  let parent=path.dirname(entry.root);while(parent!==path.dirname(parent)&&!roots.has(pathKey(parent)))parent=path.dirname(parent);
  const physical=roots.get(pathKey(parent))??null;if(physical!==entry.parentId)throw new AppError('STORAGE_PATH');
 }
 const mapped=new Map(),destinations=new Map(),result=[];
 for(let index=0;index<pending.length;index++){
  const entry=pending[index],target=entry.parentId===null?(version===1||inside(source,entry.root)?legacyWorkspaceProjectDestination(source,destination,entry):path.join(destination,path.basename(entry.root))):path.join(mapped.get(entry.parentId),path.basename(entry.root));
  if(!inside(destination,target)||destinations.has(pathKey(target))||entry.destination!==undefined&&entry.destination!==target)throw new AppError('STORAGE_PATH');
  mapped.set(entry.projectId,target);destinations.set(pathKey(target),entry.projectId);result.push({...entry,destination:target});pending.push(...(children.get(entry.projectId)??[]));
 }
 if(result.length!==entries.length)throw new AppError('STORAGE_PATH');
 for(const entry of result){
  let parent=path.dirname(entry.destination);while(parent!==path.dirname(parent)&&!destinations.has(pathKey(parent)))parent=path.dirname(parent);
  if((destinations.get(pathKey(parent))??null)!==entry.parentId)throw new AppError('STORAGE_PATH');
 }
 return result;
}
