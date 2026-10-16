import {researchId} from '../research-reference.js';
const aborted=()=>new DOMException('Stock source view changed','AbortError');
const invalid=()=>{throw Error('BOM_CONNECTION_RESPONSE');};
export function bomSourceAccess({state,api,access=run=>run()}){
 return run=>access(run,error=>{const sourceWorkspaceId=error.sourceWorkspaceId??error.owner?.sourceWorkspaceId,workspaceId=state.book.id;
  return sourceWorkspaceId?{unlock:(credentials,options)=>api('/api/modules/bom/connections/unlock',{workspaceId,sourceWorkspaceId,...credentials},{...options,adopt:false})}:{};
 });
}
export function bomConnectionsClient({state,api,identity=()=>state.modulePath,active=()=>state.page==='module'&&state.moduleId==='resources'}){
 let generation=0;const reads=new Set();
 const context=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.projectOwner,identity()]);
 function capture(){if(!active()||state.access?.locked||state.storageUnavailable)throw aborted();const stamp=context(),epoch=generation,workspaceId=state.book.id;return {workspaceId,current:()=>active()&&!state.access?.locked&&!state.storageUnavailable&&generation===epoch&&stamp===context()};}
 async function list(){const selected=capture(),controller=new AbortController();reads.add(controller);try{const value=await api('/api/modules/bom/connections/list',{workspaceId:selected.workspaceId},{adopt:false,signal:controller.signal});if(!selected.current()||controller.signal.aborted)throw aborted();if(value?.workspaceId!==selected.workspaceId||!Array.isArray(value.workspaces)||value.workspaces.some(item=>typeof item.path!=='string'||!item.path||typeof item.title!=='string')||!Array.isArray(value.connections)||value.connections.some(item=>!researchId(item.sourceWorkspaceId)))invalid();return value;}catch(error){if(!selected.current()||controller.signal.aborted)throw aborted();throw error;}finally{reads.delete(controller);}}
 async function open({path,username='',password='',recovery=''}){const selected=capture();let value;try{value=await api('/api/modules/bom/connections/open',{workspaceId:selected.workspaceId,path,username,password,recovery},{adopt:false});}catch(error){if(!selected.current())throw aborted();throw error;}
  if(value?.workspaceId!==selected.workspaceId||!researchId(value.sourceWorkspaceId)||typeof value.connectionId!=='string'||!/^[a-f0-9]{48}$/.test(value.connectionId)||typeof value.title!=='string')invalid();
  if(!selected.current()){await api('/api/modules/bom/connections/close',{workspaceId:selected.workspaceId,sourceWorkspaceId:value.sourceWorkspaceId,connectionId:value.connectionId},{adopt:false});throw aborted();}return value;
 }
 async function close(sourceWorkspaceId){if(!researchId(sourceWorkspaceId))throw TypeError('Invalid source workspace');const selected=capture();try{const result=await api('/api/modules/bom/connections/close',{workspaceId:selected.workspaceId,sourceWorkspaceId},{adopt:false});if(!selected.current())throw aborted();if(result?.workspaceId!==selected.workspaceId)invalid();return result;}catch(error){if(!selected.current())throw aborted();throw error;}}
 function cancel(){generation++;for(const request of reads)request.abort();reads.clear();}
 return {list,open,close,cancel};
}
