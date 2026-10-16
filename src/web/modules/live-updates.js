import {validModuleRevision} from './revision.js';
import {researchContext} from '../project-context.js';
import {enabledModule} from '../feature-modules.js';
// One lightweight refresh owner for operational views. Drafts retain their own base revision.
export function operationsUpdates({state,api,onChange,isEditing}){
 let context=null,inFlight=false,last=0,lastPage=null,revision=null,lastNotify=0,stopped=false,controller=null;
 const relevant=()=>state.book&&!state.access?.locked&&(enabledModule(state.dashboardSettings,'resources')||enabledModule(state.dashboardSettings,'planning'))&&(['workspace','projects','project'].includes(state.page)||state.page==='module'&&['resources','planning'].includes(state.moduleId));
 async function refresh(){
  if(stopped||inFlight||document.hidden||!relevant())return;
  const key=researchContext(state),owner=state.book.id;inFlight=true;controller=new AbortController();
  try{
   const version=await api('/api/modules/version',state.projectOwner?{workspaceId:owner}:undefined,{signal:controller.signal});
   if(stopped||key!==(researchContext(state))||state.access?.locked)return;
   if(version?.workspaceId!==owner||!validModuleRevision(version.revision))return;
   const known=state.moduleRevision?.workspaceId===owner?state.moduleRevision.revision:revision;
   const current=typeof version.revision==='number'?Math.max(version.revision,typeof known==='number'?known:0):version.revision;
   const changed=revision!==current;revision=current;
   state.moduleRevision={workspaceId:owner,revision:current};
   if((changed||Date.now()-lastNotify>=60000)&&!isEditing()){lastNotify=Date.now();onChange();}
  }catch{/* Existing views and drafts remain usable during a temporary disconnection. */}
  finally{inFlight=false;last=Date.now();}
 }
 const timer=setInterval(()=>{if(Date.now()-last>15000)refresh();},5000);
 const focused=()=>refresh();window.addEventListener('focus',focused);
 return {bind(){
  const key=researchContext(state);
  if(key!==context){controller?.abort();context=key;revision=null;last=0;}
  const page=state.page+':'+state.project;
  if(page!==lastPage){lastPage=page;if(relevant())refresh();}
 },refresh,stop(){stopped=true;controller?.abort();clearInterval(timer);window.removeEventListener('focus',focused);}};
}
