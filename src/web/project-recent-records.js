import {recordCollectionRoute,recordCollectionCommand,validRecordOwner,collectionAccessError} from './record-collection-client.js';
import {t} from './i18n/index.js';
export function projectRecentRecords({state,api,access,esc,table}){
 let key=null,controller=null,result=null,error=null,pending=false,generation=0;
 const context=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.projectOwner?.projectId,state.project,state.etag]);
 const active=()=>state.page==='project'&&state.projectOwner&&!state.projectOwner.labBookId&&!state.access?.locked;
 function stop(){controller?.abort();controller=null;generation++;key=null;result=null;error=null;pending=false;}
 function sync(){if(key!==context())stop();}
 function paint(){const host=document.getElementById('project-recent-records');if(active()&&host)host.innerHTML=view();}
 async function load(unlock=false){
  if(!active())return;sync();key=context();const requested=key,epoch=++generation,route=recordCollectionRoute(state),command=recordCollectionCommand(state,{mode:'recent',limit:10,projectId:state.project});
  controller?.abort();controller=new AbortController();const signal=controller.signal;pending=true;error=null;paint();
  try{
   const run=()=>api(route,command,{adopt:false,signal}),data=await (unlock?access(run):run());
   if(epoch!==generation||!active()||requested!==context())return;
   if(data.workspaceId!==state.book.id||!Array.isArray(data.records)||data.records.length>10||data.records.some(row=>!validRecordOwner(row.owner)))throw Error(t('recordLists','invalidPage'));
   result=data;
  }catch(e){if(epoch!==generation||!active()||requested!==context())return;if(e.name!=='AbortError')error=e;}
  finally{if(epoch===generation){pending=false;paint();}}
 }
 function view(){sync();if(error)return '<p role="alert">'+esc(error.message)+'</p><button class="button" data-action="project-recent-collection-retry">'+esc(t('recordLists',collectionAccessError(error)?'unlock':'refresh'))+'</button>';if(!result)return '<p role="status">'+esc(t('recordLists','loading'))+'</p>';return table(result.records);}
 function bind(){if(!active()){stop();return;}sync();if(!pending&&!result&&!error)void load();}
 async function action(node){if(node.dataset.action!=='project-recent-collection-retry')return false;await load(collectionAccessError(error));return true;}
 return {view,bind,action,stop};
}
