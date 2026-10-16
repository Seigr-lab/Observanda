import {locationTools} from './location-tools.js';
import {t} from '../i18n/index.js';
// Project navigation needs counts, never the original inventories or agendas.
export function locationToolCounts({state,api,esc}){
 let signature=null,controller=null,results=new Map(),failed=false;
 const active=()=>['project','projects'].includes(state.page)&&state.book&&!state.access?.locked&&!state.storageUnavailable;
 const stop=()=>{controller?.abort();controller=null;signature=null;results.clear();failed=false;};
 function paint(){
  if(!active())return;
  for(const node of document.querySelectorAll('[data-location-tool-count]')){
   const count=results.get(node.dataset.locationToolCount);
   node.textContent=count===undefined?'':t('locationTools',count===1?'oneItem':'items',{count});
  }
  const error=document.querySelector('[data-location-tool-error]');
  if(error)error.innerHTML=failed?`<span role="alert">${esc(t('locationTools','failed'))}</span> <button type="button" class="button subtle" data-action="location-counts-retry">${esc(t('locationTools','retry'))}</button>`:'';
 }
 async function load(modules,projectId){
  controller?.abort();const request=new AbortController();controller=request;failed=false;
  const workspaceId=state.book.id;
  await Promise.all(modules.map(async module=>{
   try{
    const result=await api('/api/modules/items',{workspaceId,moduleId:module.id,types:module.locationTool.types,projectId,limit:1},{adopt:false,signal:request.signal});
    if(request.signal.aborted||controller!==request)return;
    if(result?.workspaceId!==workspaceId||!Number.isSafeInteger(result.total)||result.total<0||result.offset!==0||!Array.isArray(result.items)||result.items.length!==Math.min(1,result.total))throw Error('Invalid count');
    results.set(module.id,result.total);
   }catch(error){if(!request.signal.aborted&&controller===request)failed=true;}
   if(controller===request)paint();
  }));
 }
 function bind(){
  if(!active()){stop();return;}
  const projectId=state.page==='project'?state.project:null,modules=locationTools(state.dashboardSettings,state.book,projectId);
  const key=JSON.stringify([state.storage?.contextId,state.book.id,state.etag,state.moduleRevision,projectId,modules.map(m=>m.id)]);
  if(key!==signature){stop();signature=key;void load(modules,projectId);}
  paint();
 }
 return {bind,stop,retry(){signature=null;bind();}};
}
