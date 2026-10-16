// Pending imports reserve only the selected identities and containing parent.
import path from 'node:path';
import {opendir,unlink} from 'node:fs/promises';
import {assertRegular,privateDirectory,serialize} from './storage.js';
import {researchId} from './web/research-reference.js';
import {validateProjectTree} from './project-tree-manifest.js';
import {validateStorageName} from './storage-names.js';
import {AppError} from './errors.js';
export const projectImportFile=(registry,id,complete=false)=>{if(!researchId(id))throw new AppError('INVALID');return path.join(registry.workspace.root,'.observanda',complete?'project-imported':'project-imports',id+'.obsv');};
export async function readProjectImport(registry,id){
 for(const complete of [true,false]){const file=projectImportFile(registry,id,complete),stat=await assertRegular(file,{missing:true});if(!stat)continue;if(stat.size>16*1024*1024)throw new AppError('LIMIT');let value;
  try{value=JSON.parse(await registry.workspace.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_COPY');}
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
 for(const entry of value.owners.filter(item=>item.kind==='project')){const file=path.join(directory,entry.projectId+'.obsv'),stat=await assertRegular(file,{missing:true});if(stat){if(stat.size>4096)throw new AppError('STORAGE_COPY');const previous=JSON.parse(await registry.workspace.readFile(file,'utf8'));if(previous.id!==value.id)throw new AppError('STORAGE_PROJECT_BUSY');}await registry.workspace.writeFile(file,serialize({version:1,id:value.id,projectId:entry.projectId}));}
}
export async function releaseProjectImport(registry,value){for(const entry of value.owners.filter(item=>item.kind==='project')){const file=path.join(registry.workspace.root,'.observanda/project-import-owners',entry.projectId+'.obsv'),stat=await assertRegular(file,{missing:true});if(!stat)continue;if(stat.size>4096)throw new AppError('STORAGE_COPY');let pointer;try{pointer=JSON.parse(await registry.workspace.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_COPY');}if(pointer.version!==1||pointer.id!==value.id||pointer.projectId!==entry.projectId)throw new AppError('CONFLICT');await unlink(file);}}
export async function assertImportedProjectReady(registry,projectId){
 const file=path.join(registry.workspace.root,'.observanda/project-import-owners',projectId+'.obsv'),stat=await assertRegular(file,{missing:true});if(!stat)return;if(stat.size>4096)throw new AppError('STORAGE_COPY');let pointer;
 try{pointer=JSON.parse(await registry.workspace.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_COPY');}
 if(pointer?.version!==1||pointer.projectId!==projectId||!researchId(pointer.id))throw new AppError('STORAGE_COPY');const value=await readProjectImport(registry,pointer.id);if(!value||!value.owners.some(item=>item.kind==='project'&&item.projectId===projectId))throw new AppError('STORAGE_COPY');if(!['complete','cancelled'].includes(value.phase))throw new AppError('STORAGE_INCOMPLETE');
}
