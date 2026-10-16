import {t} from './i18n/index.js';

// A dropped response does not roll back a verified copy or its activation.
// Reconcile only the reviewed destination in the original UI context. Never
// infer success from a folder's existence or issue a second copy here.
export async function transferWorkspace({api,state,destination,route,data}){
 const context=state.storage?.contextId,current=()=>state.storage?.contextId===context;
 try{return await api(route,data);}
 catch(error){
  if(!current()||error.code&&!['WORKSPACE_CHANGED','STALE'].includes(error.code))throw error;
  let storage;
  try{storage=await api('/api/storage');}catch{/* Preserve the original operation's failure. */}
  const moving=route==='/api/storage/move',finishing=route==='/api/storage/move/finish';
  const confirmed=!moving&&!finishing||storage?.move?.destination===destination&&['verified','cleanup','complete'].includes(storage.move.phase)&&(finishing?storage.move.id===state.storage.move?.id:storage.move.source===state.storage.root);
  if(current()&&confirmed&&storage?.available&&storage.root===destination&&storage.contextId&&(finishing||storage.contextId!==context))return storage;
  if(error.code||!current())throw error;
  throw Object.assign(new Error(t('access','copyUnconfirmed')),{cause:error});
 }
}
