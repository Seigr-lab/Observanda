// A project may live inside its workspace while retaining its own storage owner.
// Workspace internals and overlapping project roots are separate boundaries.
import path from 'node:path';
import {AppError} from './errors.js';
const below=(root,child)=>{const relative=path.relative(root,child);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
export function assertProjectRoot(workspaceRoot,root,projects,{existing=false,parentId}={}){
 if(below(root,workspaceRoot))throw new AppError('STORAGE_PATH');
 if(below(workspaceRoot,root)&&path.relative(workspaceRoot,root).split(path.sep).some(part=>part.toLowerCase()==='.observanda'))throw new AppError('STORAGE_PATH');
 const selected=existing?projects.find(entry=>entry.root===root):null,ancestors=new Set();
 let parent=parentId===undefined?selected?.parentId??null:parentId;
 const direct=parent===null?workspaceRoot:projects.find(entry=>entry.projectId===parent)?.root;
 if(parentId!==undefined&&(!direct||path.dirname(root)!==direct))throw new AppError('STORAGE_PATH');
 while(parent!==null){
  if(ancestors.has(parent))throw new AppError('STORAGE_PATH');ancestors.add(parent);
  const entry=projects.find(entry=>entry.projectId===parent);if(!entry)throw new AppError('STORAGE_PATH');parent=entry.parentId;
 }
 if(projects.some(entry=>!(existing&&entry.root===root)&&!(ancestors.has(entry.projectId)&&entry.root!==root&&below(entry.root,root))&&(below(entry.root,root)||below(root,entry.root))))throw new AppError('STORAGE_PATH');
}
