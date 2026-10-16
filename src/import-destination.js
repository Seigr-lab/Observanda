// Pin the destination before writing owner data so cancellation cannot select
// a folder later reused for unrelated work.
import {mkdir,readdir,realpath} from 'node:fs/promises';
import {assertRegular,serialize} from './storage.js';
import {AppError} from './errors.js';
const identity=stat=>({dev:String(stat.dev),ino:String(stat.ino)});
export async function prepareImportDestination(value,save){
 if(value.source===value.destination){value.destinationIdentity??=value.sourceIdentity;await save();return;}
 let stat=await assertRegular(value.destination,{directory:true,missing:true});
 if(!value.destinationIdentity){
  if(stat&&(await readdir(value.destination)).length)throw new AppError('CONFLICT');
  if(!stat){await mkdir(value.destination,{mode:0o700});stat=await assertRegular(value.destination,{directory:true});}
  value.destinationIdentity=identity(stat);await save();
 }
 if(!stat||await realpath(value.destination)!==value.destination||serialize(identity(stat))!==serialize(value.destinationIdentity))throw new AppError('CONFLICT');
}
