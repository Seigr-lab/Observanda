import {readAccess,verifyAccess,isEncryptedAccess} from './access.js';
import {clearVault} from './encryption.js';
import {AppError} from './errors.js';

// Prove that the user can unlock the portable copy without this computer's
// device key. Credentials are used only for this check, never retained in plans.
export async function verifyPortableAccess(root,{username='',password='',recovery=''}={}){
 const access=await readAccess(root);
 if(!isEncryptedAccess(access.value))return;
 if(!password&&!recovery)throw new AppError('STORAGE_PORTABLE_ACCESS');
 const vault=await verifyAccess(access,username,password,{recovery});
 clearVault(vault);
}
