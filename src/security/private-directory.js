// A folder only the current user can open: an access list on Windows and
// owner-only permissions elsewhere. Device secrets and the records kept beside
// them, such as access trust and agent keys, live in folders made here.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chmod} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createPersistentDirectory as mkdir} from '../filesystem-persistence.js';
import {assertRegular} from '../storage.js';
import {AppError} from '../errors.js';

const execute=promisify(execFile);
export async function preparePrivateDirectory(directory){
 await mkdir(directory,{recursive:true,mode:0o700});const info=await assertRegular(directory,{directory:true});
 if(process.platform==='win32'){
  try{await execute(path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./private-directory.ps1',import.meta.url)),'-Directory',directory],{windowsHide:true,timeout:15000,maxBuffer:8192});}catch{throw new AppError('DEVICE_UNAVAILABLE');}
 }else{if(info.uid!==process.getuid())throw new AppError('UNSAFE');await chmod(directory,0o700);}
}
