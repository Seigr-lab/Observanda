import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readAccess,isEncryptedAccess} from './access.js';
import {clearVault} from './encryption.js';
import {resolveLocation} from './locations.js';
import {Workspace} from './storage.js';
import {withNativeDestination} from './native-destination.js';
import {WorkspaceCopyRecovery} from './workspace-copy-recovery.js';
import {PortableBackupHistory} from './portable-backup-history.js';
import {inspectRestoreDestination,restorePortable} from './portable-restore.js';
import {AppError} from './errors.js';

const contains=(root,location)=>{
 const relative=path.relative(root,location);
 return !relative||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);
};
export async function portableRestoreRequest(operation,data,{client,context,deviceStore,preferencesFile,authenticate,signal}){
 if(!['review','apply'].includes(operation)||!data||Object.keys(data).some(key=>!['source','destination','username','password','recovery',...(operation==='apply'?['token']:[])].includes(key))||
  ['username','password','recovery'].some(key=>data[key]!==undefined&&(typeof data[key]!=='string'||data[key].length>1024)))throw new AppError('INVALID');
 const source=await resolveLocation(data.source),destination=await resolveLocation(data.destination);
 if(contains(source,destination)||contains(destination,source)||context.root&&(contains(context.root,destination)||contains(destination,context.root)))throw new AppError('STORAGE_PATH');
 const plan=client.portableRestore;
 if(operation==='apply'&&(!plan||plan.token!==data.token||plan.contextId!==context.id||plan.source!==source||plan.destination!==destination||plan.expires<=Date.now()))throw new AppError('STALE');
 return withNativeDestination(source,async scope=>{
  await scope.admit();
  const access=await readAccess(source,{deviceStore});
  if(isEncryptedAccess(access.value)&&!data.password&&!data.recovery)throw new AppError('STORAGE_PORTABLE_ACCESS');
  const vault=await authenticate(source,access,data.username??'',data.password??'',data.recovery??'');
  try{
   const backup=new Workspace(source,vault),owner=new WorkspaceCopyRecovery(backup,source);
   const receipt=await owner.portableCompletion({detachedPortable:true});
   if(!receipt.inventory)throw new AppError('STORAGE_INCOMPLETE');
   if(operation==='review'){
    const state=await inspectRestoreDestination(backup,destination,receipt);
    const token=randomUUID();client.portableRestore={token,source,destination,id:receipt.id,contextId:context.id,expires:Date.now()+30*60*1000};
    return {token,source,destination,receipt,state};
   }
   const restored=await restorePortable(backup,destination,{expectedId:plan.id,signal,deviceStore});
   const location=preferencesFile??deviceStore.file;
   await new PortableBackupHistory(location,new Workspace(destination,vault)).restored(source,restored);
   if(context.workspace&&context.vault?.key&&context.vault.id===vault?.id){
    const history=new PortableBackupHistory(location,context.workspace);
    if((await history.read()).backup?.id===restored.id)await history.restored(source,restored);
   }
   return restored;
  }finally{await clearVault(vault);}
 });
}
