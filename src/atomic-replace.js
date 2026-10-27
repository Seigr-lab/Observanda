import {rename} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {persistRename} from './filesystem-persistence.js';
// Windows readers and antivirus can briefly deny replacement of an existing file.
// Retry the same atomic operation; never unlink the destination as a workaround.
export async function atomicReplace(source,destination,{replace=rename,platform=process.platform,wait=delay,persist=persistRename}={}){
 for(let attempt=0;;attempt++){
  try{await replace(source,destination);break;}
  catch(error){if(platform!=='win32'||!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=6)throw error;await wait(20*2**attempt);}
 }
 // Persistence can fail after replacement. Keep it outside the rename retry
 // loop so a successful replacement is never repeated or falsely rolled back.
 await persist(source,destination,{platform});
}
