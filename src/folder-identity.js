// A folder's identity (volume and file id) as exact decimal strings. It is read
// from the folder itself, never from a native admitted-directory stat: those
// report their own identity format, so a journal recorded through one view
// and checked through the other would never match. Bigint values keep 64-bit
// file ids exact, which plain numbers round.
import {lstat} from 'node:fs/promises';
import {AppError} from './errors.js';
export async function folderIdentity(root){
 const stat=await lstat(root,{bigint:true});
 if(stat.isSymbolicLink()||!stat.isDirectory())throw new AppError('UNSAFE');
 return {dev:String(stat.dev),ino:String(stat.ino)};
}
