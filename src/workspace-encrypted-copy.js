// Recovery credentials are bound before any successor bytes are written. The
// source-authenticated transfer control is not part of the successor's payload.
import {WorkspaceCopyRecovery} from './workspace-copy-recovery.js';
import {createWorkspaceAccess,takeCreatedVault,verifyAccess,readAccess} from './access.js';
import {serialize} from './storage.js';
import {clearVault} from './encryption.js';
import {AppError} from './errors.js';
export async function workspaceEncryptedCopyAccess(source,plan,{username='',password='',deviceStore}={}){
 const retained=await new WorkspaceCopyRecovery(source,plan.destination).read();
 if(!retained){const access=await createWorkspaceAccess(username,password,deviceStore);return {access,vault:takeCreatedVault(access)};}
 if(![2,3,4].includes(retained.version)||retained.plan.encrypted!==true||retained.id!==plan.inventorySalt)throw new AppError('CONFLICT');
 const access=retained.encryptionAccess,vault=await verifyAccess({value:access},username,password,{deviceStore});
 try{
  const existing=await readAccess(plan.destination);
  if(existing.etag!=='none'&&serialize(existing.value)!==serialize(access))throw new AppError('CONFLICT');
  return {access,vault};
 }catch(error){clearVault(vault);throw error;}
}
