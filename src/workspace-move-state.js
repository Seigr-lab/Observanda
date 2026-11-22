import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {researchId} from './web/research-reference.js';
const admissions=new AsyncLocalStorage();
// Only the server-owned command supplies this exact journal scope. Every
// admission still rereads the marker; a stale or foreign fence never matches.
export function ownedMoveScope(value,operation){
 if(!researchId(value?.id)||![value.source,value.destination].every(root=>typeof root==='string'&&path.isAbsolute(root)&&path.resolve(root)===root))throw new AppError('STORAGE_MOVE_STATE');
 return admissions.run({id:value.id,source:value.source,destination:value.destination},operation);
}
function admittedMove(root,marker){
 const scope=admissions.getStore();if(!scope||marker.id!==scope.id)return false;const relative=path.relative(scope.source,root);
 return relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)&&marker.destination===path.join(scope.destination,relative);
}
import {readFile} from 'node:fs/promises';
import {assertRegular} from './storage.js';
import {AppError} from './errors.js';
import {MOVE_RECEIPT,MOVE_SOURCE} from './storage-lifecycle-markers.js';
export {MOVE_RECEIPT,MOVE_SOURCE};
export async function moveSource(root){
 const file=path.join(root,MOVE_SOURCE),stat=await assertRegular(file,{missing:true});if(!stat)return null;
 if(stat.size>16*1024*1024)throw new AppError('STORAGE_MOVE_STATE');
 let value;try{value=JSON.parse(await readFile(file,'utf8'));}catch{throw new AppError('STORAGE_MOVE_STATE');}
 // Each moved owner, books included, carries its own marker. Independently
 // registered child projects are outside this fence.
 if(!value||typeof value.id!=='string'||!path.isAbsolute(value.destination??'')||value.books!==undefined)throw new AppError('STORAGE_MOVE_STATE');
 return value;
}
export async function assertNotMoving(root,moveId){const value=await moveSource(root);if(value&&value.id!==moveId&&!admittedMove(root,value))throw new AppError('STORAGE_MOVED',[value.destination]);}
