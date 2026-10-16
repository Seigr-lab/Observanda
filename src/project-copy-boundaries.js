// Physical child owners are excluded by declared registry roots. Discovering a
// boundary never opens that child's database or requires its decryption key.
import path from 'node:path';
import {AppError} from './errors.js';
const inside=(parent,child)=>{const relative=path.relative(parent,child);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
export function projectCopyRoots(root,entries){return entries.map(entry=>entry.root).filter(child=>inside(root,child));}
export function projectCopyBoundaries(root,roots=[]){
 if(!Array.isArray(roots)||roots.some(root=>typeof root!=='string'))throw new AppError('INVALID');
 const sorted=[...new Set(roots)].sort((a,b)=>a.length-b.length||a.localeCompare(b)),boundaries=[];
 for(const child of sorted){
  if(typeof child!=='string'||!path.isAbsolute(child)||path.resolve(child)!==child||!inside(root,child))throw new AppError('STORAGE_PATH');
  const relative=path.relative(root,child).split(path.sep).join('/');
  if(relative==='.observanda')throw new AppError('STORAGE_PATH');
  if(!boundaries.some(parent=>relative.startsWith(parent+'/')))boundaries.push(relative);
 }
 return boundaries.sort();
}
export function retainedCopyRoots(receipt){
 const boundaries=receipt.version===1?[]:receipt.boundaries;
 if(!Array.isArray(boundaries)||boundaries.some(relative=>typeof relative!=='string'||relative.split('/').some(part=>!part||part==='.'||part==='..')||/[\\:\u0000]/.test(relative)))throw new AppError('STORAGE_COPY');
 const roots=boundaries.map(relative=>path.resolve(receipt.source,...relative.split('/')));
 if(JSON.stringify(projectCopyBoundaries(receipt.source,roots))!==JSON.stringify(boundaries))throw new AppError('STORAGE_COPY');
 return roots;
}
