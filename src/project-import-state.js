import {portabilityCollection,validPortabilityCollection} from './portability-collection.js';
// Pending imports reserve only the selected identities and containing parent.
import path from 'node:path';
import {opendir,unlink} from 'node:fs/promises';
import {assertRegular,privateDirectory,serialize} from './storage.js';
import {researchId} from './web/research-reference.js';
import {validateProjectTree,projectTreeCollection,validateNativeProjectTree} from './project-tree-manifest.js';
import {validateStorageName} from './storage-names.js';
import {AppError} from './errors.js';
export const projectImportFile=(registry,id,complete=false)=>{if(!researchId(id))throw new AppError('INVALID');return path.join(registry.workspace.root,'.observanda',complete?'project-imported':'project-imports',id+'.obsv');};
export function readProjectImport(registry,id){return registry.workspace.withCatalogueConnections(()=>readProjectImportValue(registry,id));}
async function readProjectImportValue(registry,id){
 for(const complete of [true,false]){const file=projectImportFile(registry,id,complete),stat=await assertRegular(file,{missing:true});if(!stat)continue;if(stat.size>16*1024*1024)throw new AppError('LIMIT');let value;
  try{value=JSON.parse(await registry.workspace.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_COPY');}
  if(value?.version===2){await validateNativeImport(registry,value,id);return value;}
  if(value?.version!==1||value.id!==id||!['prepared','copied','registered','complete','cancelling','cancelled'].includes(value.phase)||!path.isAbsolute(value.source??'')||path.resolve(value.source)!==value.source||!path.isAbsolute(value.destination??'')||path.resolve(value.destination)!==value.destination||value.parentId!==null&&!researchId(value.parentId)||!value.sourceIdentity||Object.keys(value.sourceIdentity).sort().join()!=='dev,ino'||Object.values(value.sourceIdentity).some(part=>typeof part!=='string')||value.destinationIdentity!==null&&(!value.destinationIdentity||Object.keys(value.destinationIdentity).sort().join()!=='dev,ino'||Object.values(value.destinationIdentity).some(part=>typeof part!=='string'))||!Array.isArray(value.owners)||!value.owners.length||value.owners.length>8192)throw new AppError('STORAGE_COPY');
  validateProjectTree(value.manifest);const ids=new Set(),paths=new Set();
  for(const entry of value.owners){if(!['project','lab-book'].includes(entry.kind)||typeof entry.relative!=='string'||entry.relative&&entry.relative.split('/').some(part=>{try{validateStorageName(part);return false;}catch{return true;}})||entry.relative.includes('\\')||paths.has(entry.relative)||!researchId(entry.transferId)||!researchId(entry.projectId)||entry.kind==='lab-book'&&!researchId(entry.labBookId)||!researchId(entry.namespaceId)||!researchId(entry.vaultId)||typeof entry.accessEtag!=='string'||typeof entry.copied!=='boolean'||typeof entry.restored!=='boolean'||entry.archiveDigest!==null&&!/^[a-f0-9]{64}$/.test(entry.archiveDigest)||ids.has(entry.namespaceId))throw new AppError('STORAGE_COPY');paths.add(entry.relative);ids.add(entry.namespaceId);}
  const root=value.owners[0];if(root.kind!=='project'||root.relative!==''||['projectId','namespaceId','vaultId'].some(key=>root[key]!==value.manifest[key]))throw new AppError('STORAGE_COPY');
  const projects=new Map([[root.projectId,{...root,relative:''}],...value.manifest.projects.map(entry=>[entry.projectId,entry])]);
  if(value.owners.filter(entry=>entry.kind==='project').length!==projects.size||new Set(value.owners.map(entry=>entry.transferId)).size!==value.owners.length)throw new AppError('STORAGE_COPY');
  for(const entry of value.owners){const project=projects.get(entry.projectId);if(!project||entry.kind==='project'&&['relative','namespaceId','vaultId'].some(key=>entry[key]!==project[key])||entry.kind==='lab-book'&&entry.relative.split('/').slice(0,-1).join('/')!==project.relative||['copied','registered','complete'].includes(value.phase)&&(!entry.copied||!entry.restored))throw new AppError('STORAGE_COPY');}
  return value;
 }return null;
}
export async function saveProjectImport(registry,value){
 if(value.version===2&&Buffer.byteLength(serialize(value))>16384)throw new AppError('LIMIT');
 const complete=['complete','cancelled'].includes(value.phase),file=projectImportFile(registry,value.id,complete);await privateDirectory(registry.workspace.root,complete?'.observanda/project-imported':'.observanda/project-imports');await registry.workspace.writeFile(file,serialize(value));
 if(complete)await unlink(projectImportFile(registry,value.id)).catch(error=>{if(error.code!=='ENOENT')throw error;});
}
export async function* pendingProjectImports(registry){
 const directory=path.join(registry.workspace.root,'.observanda/project-imports');if(!await assertRegular(directory,{directory:true,missing:true}))return;
 for await(const entry of await opendir(directory)){if(entry.name.endsWith('.obsv')&&researchId(entry.name.slice(0,-5))){const value=await readProjectImport(registry,entry.name.slice(0,-5));if(value&&!['complete','cancelled'].includes(value.phase))yield value;}}
}
export async function assertProjectImportsSettled(registry,parents){const ids=new Set(parents);for await(const value of pendingProjectImports(registry))if(ids.has(value.parentId))throw new AppError('STORAGE_PROJECT_BUSY');}

export async function reserveProjectImport(registry,value){
 const directory=await privateDirectory(registry.workspace.root,'.observanda/project-import-owners');
 for await(const entry of projectImportOwners(registry,value).entries({index:'project'})){const file=path.join(directory,entry.projectId+'.obsv'),stat=await assertRegular(file,{missing:true});if(stat){if(stat.size>4096)throw new AppError('STORAGE_COPY');const previous=JSON.parse(await registry.workspace.readFile(file,'utf8'));if(previous.id!==value.id)throw new AppError('STORAGE_PROJECT_BUSY');}await registry.workspace.writeFile(file,serialize({version:1,id:value.id,projectId:entry.projectId}));}
}
export async function releaseProjectImport(registry,value){for await(const entry of projectImportOwners(registry,value).entries({index:'project'})){const file=path.join(registry.workspace.root,'.observanda/project-import-owners',entry.projectId+'.obsv'),stat=await assertRegular(file,{missing:true});if(!stat)continue;if(stat.size>4096)throw new AppError('STORAGE_COPY');let pointer;try{pointer=JSON.parse(await registry.workspace.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_COPY');}if(pointer.version!==1||pointer.id!==value.id||pointer.projectId!==entry.projectId)throw new AppError('CONFLICT');await unlink(file);}}
export async function assertImportedProjectReady(registry,projectId){
 const file=path.join(registry.workspace.root,'.observanda/project-import-owners',projectId+'.obsv'),stat=await assertRegular(file,{missing:true});if(!stat)return;if(stat.size>4096)throw new AppError('STORAGE_COPY');let pointer;
 try{pointer=JSON.parse(await registry.workspace.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_COPY');}
 if(pointer?.version!==1||pointer.projectId!==projectId||!researchId(pointer.id))throw new AppError('STORAGE_COPY');const value=await readProjectImport(registry,pointer.id);if(!value||!await projectImportOwners(registry,value).find('project',projectId))throw new AppError('STORAGE_COPY');if(!['complete','cancelled'].includes(value.phase))throw new AppError('STORAGE_INCOMPLETE');
}

// One adapter for legacy recovery arrays and current authenticated native roots.
// Updating a native row commits its blocks before the caller saves the new root.
export function projectImportOwners(registry,value){
 if(!Array.isArray(value.owners))return portabilityCollection(registry.workspace,value.owners);
 const owners=value.owners;return {get count(){return owners.length;},
  async *entries({reverse=false,index='order'}={}){if(index==='order'){if(reverse){for(let i=owners.length-1;i>=0;i--)yield owners[i];}else yield* owners;}else{const field=index==='project'?'projectId':index+'Id';yield* owners.filter(row=>index!=='project'||row.kind==='project').toSorted((a,b)=>String(a[field]).localeCompare(String(b[field])));}},
  async get(relative){return owners.find(row=>row.relative===relative)??null;},
  async find(index,key){return owners.find(row=>index==='relative'||index==='path'?row.relative===key:index==='project'?row.kind==='project'&&row.projectId===key:row[index+'Id']===key)??null;},
  async update(relative,patch){const row=owners.find(row=>row.relative===relative);if(!row)throw new AppError('NOT_FOUND');Object.assign(row,patch);return row;}
 };
}
async function validateNativeImport(registry,value,id){
 if(value.id!==id||!['prepared','copied','registered','complete','cancelling','cancelled'].includes(value.phase)||!path.isAbsolute(value.source??'')||path.resolve(value.source)!==value.source||!path.isAbsolute(value.destination??'')||path.resolve(value.destination)!==value.destination||value.parentId!==null&&!researchId(value.parentId)||!value.sourceIdentity||Object.keys(value.sourceIdentity).sort().join()!=='dev,ino'||Object.values(value.sourceIdentity).some(part=>typeof part!=='string')||value.destinationIdentity!==null&&(!value.destinationIdentity||Object.keys(value.destinationIdentity).sort().join()!=='dev,ino'||Object.values(value.destinationIdentity).some(part=>typeof part!=='string'))||!validPortabilityCollection(value.owners)||!value.owners.count||value.manifest?.version!==2)throw new AppError('STORAGE_COPY');
 validateProjectTree(value.manifest);const owners=projectImportOwners(registry,value),tree=projectTreeCollection(registry.workspace,value.manifest);await owners.verify();await tree.verify();await validateNativeProjectTree(tree,value.manifest);let projects=0;
 for await(const entry of owners.entries()){
  if(!['project','lab-book'].includes(entry.kind)||typeof entry.relative!=='string'||entry.relative.length>16384||entry.relative.includes('\\')||entry.relative&&entry.relative.split('/').some(part=>{try{validateStorageName(part);return false;}catch{return true;}})||!researchId(entry.transferId)||!researchId(entry.projectId)||entry.kind==='lab-book'&&!researchId(entry.labBookId)||!researchId(entry.namespaceId)||!researchId(entry.vaultId)||typeof entry.accessEtag!=='string'||typeof entry.copied!=='boolean'||typeof entry.restored!=='boolean'||entry.archiveDigest!==null&&!/^[a-f0-9]{64}$/.test(entry.archiveDigest)||['copied','registered','complete'].includes(value.phase)&&(!entry.copied||!entry.restored))throw new AppError('STORAGE_COPY');
  const project=await tree.find('project',entry.projectId);if(!project||entry.kind==='project'&&['relative','namespaceId','vaultId','parentId'].some(key=>entry[key]!==project[key])||entry.kind==='lab-book'&&entry.relative.split('/').slice(0,-1).join('/')!==project.relative)throw new AppError('STORAGE_COPY');if(entry.kind==='project')projects++;
 }
 const root=await owners.get('');if(!root||root.kind!=='project'||['projectId','namespaceId','vaultId'].some(key=>root[key]!==value.manifest[key])||projects!==tree.count)throw new AppError('STORAGE_COPY');
}
