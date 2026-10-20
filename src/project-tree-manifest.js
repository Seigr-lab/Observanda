import {createPortabilityCollection,portabilityCollection,validPortabilityCollection,withArchivedPortabilityCollection} from './portability-collection.js';
// A portable project tree names owners by identity and relative folders only.
// Each owner's database and access key remain independently owned.
import path from 'node:path';
import {assertRegular,serialize} from './storage.js';
import {researchId} from './web/research-reference.js';
import {validateStorageName} from './storage-names.js';
import {AppError} from './errors.js';
import {projectRegistryDescendantPrefix} from './project-registry-locations.js';
export const PROJECT_TREE_FILE='.observanda/project-tree.obsv';
const folderKey=value=>['win32','darwin'].includes(process.platform)?value.normalize('NFC').toLowerCase():value;
const keys=(value,fields)=>value&&Object.keys(value).sort().join()===fields.split(',').sort().join();
export function validateProjectTree(value,owner){
 if(value?.version===2){if(!keys(value,'version,projectId,namespaceId,vaultId,projects')||['projectId','namespaceId','vaultId'].some(key=>!researchId(value[key])||owner&&value[key]!==owner[key])||!validPortabilityCollection(value.projects)||value.projects.count<1)throw new AppError('STORAGE_COPY');return value;}
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

// Read only the selected physical tree, then prove that its logical children
// agree. An unrelated project does not enlarge this inventory or its checks.
export function readProjectTreeDirectory(registry,storage){
 return registry.inspect(async view=>{
  const root=await view.get(storage.projectId);if(root?.state!=='active')throw new AppError('CONFLICT');
  const entries=[root.entry];for await(const row of view.entries({index:'location',prefix:projectRegistryDescendantPrefix(storage.root,registry.workspace.root)})){
   entries.push(row.entry);if(entries.length>4097)throw new AppError('LIMIT');
  }
  const tree=selectProjectTree(storage,entries),ids=new Set(entries.map(entry=>entry.projectId));
  for(const entry of entries)for await(const child of view.entries({index:'parent',prefix:entry.projectId+':'}))if(!ids.has(child.entry.projectId))throw new AppError('STORAGE_PATH');
  return tree;
 });
}

export function projectTreeCollection(storage,manifest){
 validateProjectTree(manifest);if(manifest.version===2)return portabilityCollection(storage,manifest.projects);
 const root={kind:'project',relative:'',projectId:manifest.projectId,namespaceId:manifest.namespaceId,vaultId:manifest.vaultId,parentId:null};
 return {count:manifest.projects.length+1,async *entries({index='order',reverse=false}={}){const values=[root,...manifest.projects];if(index==='project')values.sort((a,b)=>a.projectId.localeCompare(b.projectId));if(reverse)values.reverse();yield* values;},async get(relative){return relative===''?root:manifest.projects.find(entry=>entry.relative===relative)??null;},async find(index,key){return index==='project'?(key===root.projectId?root:manifest.projects.find(entry=>entry.projectId===key)??null):index==='relative'||index==='path'?this.get(key):[root,...manifest.projects].find(entry=>entry[index+'Id']===key)??null;}};
}
export async function validateNativeProjectTree(collection,manifest){
 let count=0;for await(const entry of collection.entries()){
  count++;if(!keys(entry,'kind,relative,projectId,namespaceId,vaultId,parentId')||entry.kind!=='project'||['projectId','namespaceId','vaultId'].some(key=>!researchId(entry[key]))||typeof entry.relative!=='string'||entry.relative.length>16384||/[\\:\u0000]/.test(entry.relative))throw new AppError('STORAGE_COPY');
  if(!entry.relative){if(entry.parentId!==null||['projectId','namespaceId','vaultId'].some(key=>entry[key]!==manifest[key]))throw new AppError('STORAGE_COPY');continue;}
  const parts=entry.relative.split('/');if(parts.length>128||!researchId(entry.parentId))throw new AppError('STORAGE_COPY');try{for(const part of parts)validateStorageName(part);}catch{throw new AppError('STORAGE_COPY');}
  const parent=await collection.find('project',entry.parentId);if(!parent||parent.relative!==parts.slice(0,-1).join('/'))throw new AppError('STORAGE_COPY');
 }
 if(count!==collection.count||!await collection.get(''))throw new AppError('STORAGE_COPY');return manifest;
}
export async function withProjectTree(storage,manifest,operation,{archiveDigest}={}){
 validateProjectTree(manifest);const use=async collection=>{if(manifest.version===2)await validateNativeProjectTree(collection,manifest);return operation(collection);};
 return manifest.version===2&&archiveDigest?withArchivedPortabilityCollection(storage,archiveDigest,manifest.projects,use):use(projectTreeCollection(storage,manifest));
}
const treeInside=(root,child)=>{const relative=path.relative(root,child);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const portableTreeRow=(storage,entry)=>({kind:'project',projectId:entry.projectId,namespaceId:entry.namespaceId,vaultId:entry.vaultId,parentId:entry.projectId===storage.projectId?null:entry.parentId,relative:path.relative(storage.root,entry.root).split(path.sep).join('/')});
async function* selectedDirectoryRows(view,registry,storage){
 const root=await view.get(storage.projectId);if(root?.state!=='active'||root.entry.root!==storage.root||root.entry.vaultId!==storage.vault.id)throw new AppError('CONFLICT');
 const check=async entry=>{for await(const child of view.entries({index:'parent',prefix:entry.projectId+':'}))if(path.dirname(child.entry.root)!==entry.root)throw new AppError('STORAGE_PATH');};
 await check(root.entry);yield portableTreeRow(storage,root.entry);
 for await(const {entry} of view.entries({index:'location',prefix:projectRegistryDescendantPrefix(storage.root,registry.workspace.root)})){
  const parent=await view.get(entry.parentId);if(parent?.state!=='active'||path.dirname(entry.root)!==parent.entry.root||parent.entry.root!==storage.root&&!treeInside(storage.root,parent.entry.root))throw new AppError('STORAGE_PATH');await check(entry);yield portableTreeRow(storage,entry);
 }
}
// Stage and commit the native manifest before the transfer takes its independent
// source snapshot, so live copies and archive-only exports carry the same pages.
export async function captureProjectTreeDirectory(registry,storage){
 const projects=await registry.inspect(view=>createPortabilityCollection(storage,selectedDirectoryRows(view,registry,storage),{id:storage.projectId}));
 const collection=portabilityCollection(storage,projects),root=await collection.get(''),manifest=validateProjectTree({version:2,projectId:root.projectId,namespaceId:root.namespaceId,vaultId:root.vaultId,projects});await validateNativeProjectTree(collection,manifest);
 return {manifest,collection,count:projects.count-1,async *entries(options={}){for await(const row of collection.entries(options))if(row.relative)yield {...row,root:path.join(storage.root,...row.relative.split('/'))};}};
}
export async function verifyProjectTreeDirectory(registry,storage,tree){
 return registry.inspect(async view=>{let count=0;for await(const entry of selectedDirectoryRows(view,registry,storage)){count++;const retained=await tree.collection.get(entry.relative);if(serialize(retained)!==serialize(entry))throw new AppError('CONFLICT');}if(count!==tree.collection.count)throw new AppError('CONFLICT');});
}
