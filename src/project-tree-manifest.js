// A portable project tree names owners by identity and relative folders only.
// Each owner's database and access key remain independently owned.
import path from 'node:path';
import {assertRegular,serialize} from './storage.js';
import {researchId} from './web/research-reference.js';
import {validateStorageName} from './storage-names.js';
import {AppError} from './errors.js';
export const PROJECT_TREE_FILE='.observanda/project-tree.obsv';
const folderKey=value=>['win32','darwin'].includes(process.platform)?value.normalize('NFC').toLowerCase():value;
const keys=(value,fields)=>value&&Object.keys(value).sort().join()===fields.split(',').sort().join();
export function validateProjectTree(value,owner){
 if(!keys(value,'version,projectId,namespaceId,vaultId,projects')||value.version!==1||['projectId','namespaceId','vaultId'].some(key=>!researchId(value[key])||owner&&value[key]!==owner[key])||!Array.isArray(value.projects)||value.projects.length>4096)throw new AppError('STORAGE_COPY');
 const ids=new Map([[value.projectId,{relative:''}]]),namespaces=new Set([value.namespaceId]),vaults=new Set([value.vaultId]),folders=new Set();
 for(const entry of value.projects){
  if(!keys(entry,'projectId,namespaceId,vaultId,parentId,relative')||['projectId','namespaceId','vaultId','parentId'].some(key=>!researchId(entry[key]))||ids.has(entry.projectId)||namespaces.has(entry.namespaceId)||vaults.has(entry.vaultId)||!ids.has(entry.parentId)||typeof entry.relative!=='string'||entry.relative.length>16384||/[\\:\u0000]/.test(entry.relative))throw new AppError('STORAGE_COPY');
  const parts=entry.relative.split('/');if(parts.length>128||!parts.length)throw new AppError('STORAGE_COPY');
  try{for(const part of parts)validateStorageName(part);}catch{throw new AppError('STORAGE_COPY');}
  const parent=parts.slice(0,-1).join('/');if(parent!==ids.get(entry.parentId).relative||folders.has(folderKey(entry.relative)))throw new AppError('STORAGE_COPY');
  ids.set(entry.projectId,entry);namespaces.add(entry.namespaceId);vaults.add(entry.vaultId);folders.add(folderKey(entry.relative));
 }
 if(Buffer.byteLength(serialize(value))>4*1024*1024)throw new AppError('LIMIT');return value;
}
export async function readProjectTree(storage,owner){
 const file=path.join(storage.root,PROJECT_TREE_FILE),stat=await assertRegular(file,{missing:true});if(!stat)return null;if(stat.size>4*1024*1024+256)throw new AppError('LIMIT');
 let value;try{value=JSON.parse(await storage.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_COPY');}return validateProjectTree(value,owner);
}
export async function writeProjectTree(storage,value){await storage.writeFile(path.join(storage.root,PROJECT_TREE_FILE),serialize(validateProjectTree(value)));}
export function selectProjectTree(root,entries){
 const selected=entries.find(entry=>entry.projectId===root.projectId);if(!selected||selected.root!==root.root||selected.vaultId!==root.vault.id)throw new AppError('CONFLICT');
 const children=new Map();for(const entry of entries){const list=children.get(entry.parentId)??[];list.push(entry);children.set(entry.parentId,list);}
 const result=[],pending=[selected],seen=new Set();
 for(let index=0;index<pending.length;index++){const parent=pending[index];if(seen.has(parent.projectId))throw new AppError('FORMAT');seen.add(parent.projectId);if(result.length>4096)throw new AppError('LIMIT');
  for(const entry of (children.get(parent.projectId)??[]).sort((a,b)=>a.root.localeCompare(b.root))){if(path.dirname(entry.root)!==parent.root)throw new AppError('STORAGE_PATH');result.push(entry);pending.push(entry);}
 }
 const physical=entries.filter(entry=>{const rel=path.relative(root.root,entry.root);return rel!==''&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);});
 if(physical.length!==result.length||physical.some(entry=>!seen.has(entry.projectId)))throw new AppError('STORAGE_PATH');
 const manifest=validateProjectTree({version:1,projectId:selected.projectId,namespaceId:selected.namespaceId,vaultId:selected.vaultId,projects:result.map(({projectId,namespaceId,vaultId,parentId,root:folder})=>({projectId,namespaceId,vaultId,parentId,relative:path.relative(root.root,folder).split(path.sep).join('/')}))});
 return {entries:result,manifest};
}
