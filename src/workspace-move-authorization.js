import path from 'node:path';
import {seal,unseal} from './encryption.js';
import {digest,serialize} from './storage-format.js';
import {temporaryStreamName} from './storage-temporary.js';
import {WORKSPACE_MOVE_AUTHORIZATION} from './workspace-transfer-controls.js';
import {withNativeContentFile} from './native-content-file.js';
import {AppError} from './errors.js';
// A completed copy is not authorization to erase its source. Automatic cleanup
// requires the move command's immutable, encrypted intent and original identity.
const immutable=receipt=>Object.fromEntries(Object.entries(receipt).filter(([key])=>!['phase','retired','error'].includes(key)).sort(([a],[b])=>a.localeCompare(b,'en')));
const payload=receipt=>serialize({version:1,receipt:immutable(receipt)});
export async function authorizedWorkspaceMove(workspace,receipt){
 if(!workspace.vault?.key||!receipt?.sourceIdentity)return false;
 const file=path.join(workspace.root,WORKSPACE_MOVE_AUTHORIZATION);
 return withNativeContentFile(workspace,file,async(parent,name)=>{
  const saved=await parent.read(name,{limit:32768,missing:true});if(!saved)return false;
  let clear;try{clear=unseal(saved.bytes,workspace.vault.key,workspace.fileAAD(file));if(clear.toString('utf8')!==payload(receipt))throw new AppError('STORAGE_MOVE_STATE');return true;}finally{clear?.fill(0);}
 });
}
export async function authorizeWorkspaceMove(workspace,receipt){
 if(!workspace.vault?.key)return;
 if(await authorizedWorkspaceMove(workspace,receipt))return;
 if(!receipt.sourceIdentity)throw new AppError('STORAGE_MOVE_STATE');
 const file=path.join(workspace.root,WORKSPACE_MOVE_AUTHORIZATION),bytes=seal(payload(receipt),workspace.vault.key,workspace.fileAAD(file));
 return withNativeContentFile(workspace,file,async(parent,name)=>{const temporary=temporaryStreamName();let identity;
  try{await parent.write(temporary,[bytes],{bytes:bytes.length,sha256:digest(bytes)});identity=(await parent.stat(temporary)).identity;await parent.rename(temporary,parent,name,{identity});}
  finally{if(identity)await parent.remove(temporary,{identity}).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 });
}
