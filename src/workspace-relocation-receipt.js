// A workspace move without a copy receipt (a folder moved on its volume, or a
// copy whose original was then deleted) records its completion durably in the
// moved workspace. The storage status reports it, so a finished move whose
// response was lost is confirmed again, also after a restart.
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {assertRegular,atomicWrite,serialize} from './storage.js';
import {WORKSPACE_RELOCATION_RECEIPT} from './workspace-transfer-controls.js';
import {AppError} from './errors.js';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const absolute=value=>typeof value==='string'&&path.isAbsolute(value)&&path.resolve(value)===value;
export async function recordWorkspaceRelocation(root,{id,source}){
 if(!uuid(id)||!absolute(root)||!absolute(source)||root===source)throw new AppError('INVALID');
 await atomicWrite(path.join(root,WORKSPACE_RELOCATION_RECEIPT),serialize({version:1,id,source,destination:root,phase:'complete'}));
}
export async function workspaceRelocationStatus(root){
 const file=path.join(root,WORKSPACE_RELOCATION_RECEIPT),stat=await assertRegular(file,{missing:true});if(!stat)return null;
 if(stat.size>4096)throw new AppError('STORAGE_MOVE_STATE');
 let value;try{value=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw new AppError('STORAGE_MOVE_STATE');}
 if(!value||Object.keys(value).sort().join()!=='destination,id,phase,source,version'||value.version!==1||!uuid(value.id)||value.phase!=='complete'||!absolute(value.source)||value.destination!==root)throw new AppError('STORAGE_MOVE_STATE');
 return {id:value.id,source:value.source,destination:value.destination,phase:'complete',error:null};
}
