// An import reads its source project tree until it completes or is cancelled. Until then the tree stays where it
// is: its own workspace refuses to rename, move or delete any project or lab book inside it while the import holds
// it. The hold is a small marker in the source project's folder, written by the importing workspace. It names the
// import's record, so a hold whose import no longer exists (its workspace was deleted) does not block the tree;
// an import that resumes checks its source folder's identity again in any case.
import path from 'node:path';
import {readFile,unlink} from 'node:fs/promises';
import {assertRegular,atomicWrite,serialize} from './storage.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export const IMPORT_SOURCE_HOLD='.observanda/import-source.json';
const file=root=>path.join(root,IMPORT_SOURCE_HOLD);
const busy=()=>new AppError('STORAGE_PROJECT_BUSY');
async function read(root){
 const stat=await assertRegular(file(root),{missing:true});if(!stat)return null;if(stat.size>8192)throw busy();
 let value;try{value=JSON.parse(await readFile(file(root),'utf8'));}catch{throw busy();}
 if(value?.version!==1||!researchId(value.id)||typeof value.record!=='string'||!path.isAbsolute(value.record)||Object.keys(value).sort().join()!=='id,record,version')throw busy();return value;
}
const active=async hold=>!!await assertRegular(hold.record,{missing:true}).catch(error=>{if(['ENOENT','ENOTDIR'].includes(error.code))return null;throw error;});
// One import holds a source at a time; resuming the same import keeps its hold.
export async function holdImportSource(root,id,record){
 if(!researchId(id)||typeof record!=='string'||!path.isAbsolute(record))throw new AppError('INVALID');const current=await read(root);
 if(current?.id===id&&current.record===record)return;if(current&&await active(current))throw busy();
 await atomicWrite(file(root),serialize({version:1,id,record}));
}
export async function releaseImportSource(root,id){
 let current;try{current=await read(root);}catch(error){if(error.code==='STORAGE_PROJECT_BUSY')return;throw error;}
 if(current?.id===id)await unlink(file(root)).catch(error=>{if(error.code!=='ENOENT')throw error;});
}
// A held project, or any project or lab book inside the held tree, is busy for renames, moves and deletions.
export async function assertNoImportHold(root,workspaceRoot){
 for(let current=path.resolve(root);current!==path.resolve(workspaceRoot)&&path.dirname(current)!==current;current=path.dirname(current)){const hold=await read(current);if(hold&&await active(hold))throw busy();}
}
