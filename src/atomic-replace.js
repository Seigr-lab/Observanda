import {rename} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
// Windows readers and antivirus can briefly deny replacement of an existing file.
// Retry the same atomic operation; never unlink the destination as a workaround.
export async function atomicReplace(source,destination,{replace=rename,platform=process.platform,wait=delay}={}){
 for(let attempt=0;;attempt++){
  try{await replace(source,destination);return;}
  catch(error){if(platform!=='win32'||!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=6)throw error;await wait(20*2**attempt);}
 }
}
