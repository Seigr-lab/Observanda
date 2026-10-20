// Compact encrypted workspace move receipts bind independently moved owners.
import path from 'node:path';
import {assertRegular,serialize} from './storage.js';
import {WORKSPACE_BUNDLE_MOVE} from './workspace-transfer-controls.js';
import {workspaceProjectPlacements} from './workspace-project-placement.js';
import {validWorkspaceCopyDirectory} from './workspace-copy-directory.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const limit=32*1024*1024;
const inside=(parent,child)=>{const r=path.relative(parent,child);return r!==''&&r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
export async function readWorkspaceProjectMove(target){
 if(!await assertRegular(target.root,{missing:true,directory:true})||!await assertRegular(path.join(target.root,'.observanda'),{missing:true,directory:true}))return null;
 const file=path.join(target.root,WORKSPACE_BUNDLE_MOVE),stat=await assertRegular(file,{missing:true});if(!stat)return null;if(stat.size>limit)throw new AppError('STORAGE_MOVE_STATE');
 let value;try{value=JSON.parse(await target.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_MOVE_STATE');}
 if(![1,2].includes(value?.version)||value.projectPlacement!==undefined&&value.projectPlacement!==2||!researchId(value.id)||!researchId(value.workspaceId)||value.vaultId!==target.vault?.id||value.destination!==target.root||typeof value.source!=='string'||!path.isAbsolute(value.source)||path.resolve(value.source)!==value.source||value.source===value.destination||inside(value.source,value.destination)||inside(value.destination,value.source)||!['projects','workspace','complete'].includes(value.phase)||(value.version===1?!Array.isArray(value.projects):value.projects!==undefined||value.projectPlacement!==2||!validWorkspaceCopyDirectory(value.directory)||value.directory.head.ownerId!==value.workspaceId))throw new AppError('STORAGE_MOVE_STATE');
 if(value.version===2)return value;
 const ids=new Set(),destinations=new Set();for(const entry of value.projects){
  if(!['projectId','namespaceId','vaultId','transferId'].every(key=>researchId(entry?.[key]))||typeof entry.root!=='string'||!path.isAbsolute(entry.root)||path.resolve(entry.root)!==entry.root||typeof entry.destination!=='string'||!path.isAbsolute(entry.destination)||path.resolve(entry.destination)!==entry.destination||!inside(value.destination,entry.destination)||ids.has(entry.projectId)||destinations.has(entry.destination))throw new AppError('STORAGE_MOVE_STATE');
  ids.add(entry.projectId);destinations.add(entry.destination);
 }
 workspaceProjectPlacements(value.source,value.destination,value.projects,{version:value.projectPlacement??1});
 return value;
}
export async function saveWorkspaceProjectMove(target,value){const raw=serialize(value);if(Buffer.byteLength(raw)>limit-128)throw new AppError('LIMIT');await target.writeFile(path.join(target.root,WORKSPACE_BUNDLE_MOVE),raw);}
