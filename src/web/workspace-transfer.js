import {t} from './i18n/index.js';

// A dropped response does not roll back a verified copy or its activation.
// Reconcile only the reviewed destination in the original UI context. Never
// infer success from a folder's existence or issue a second copy here.
export async function transferWorkspace({api,state,destination,route,data}){
 const context=state.storage?.contextId,source=state.storage?.root,moveId=state.storage?.move?.id,current=()=>state.storage?.contextId===context;
 // Activity reports the activated destination and the app opens it by itself,
 // sometimes before this response arrives. That context is this operation's
 // own result, not another workspace opened meanwhile.
 const followed=()=>!current()&&!!state.storage?.contextId&&state.storage.root===destination,owned=()=>current()||followed();
 try{return await api(route,data);}
 catch(error){
  if(!owned()||error.code&&!['WORKSPACE_CHANGED','STALE'].includes(error.code))throw error;
  let storage;
  try{storage=await api('/api/storage',undefined,{adopt:false});}catch{/* Preserve the original operation's failure. */}
  const moving=route==='/api/storage/move',finishing=route==='/api/storage/move/finish';
  const confirmed=!moving&&!finishing||storage?.move?.destination===destination&&['verified','cleanup','complete'].includes(storage.move.phase)&&(finishing?storage.move.id===moveId:storage.move.source===source);
  if(owned()&&confirmed&&storage?.available&&storage.root===destination&&storage.contextId&&(finishing||storage.contextId!==context))return storage;
  if(error.code||!owned())throw error;
  throw Object.assign(new Error(t('access','copyUnconfirmed')),{cause:error});
 }
}
