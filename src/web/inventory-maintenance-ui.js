import {localizedText,onLanguageChange} from './i18n/index.js';
import {updateText,updateProperty,updateAttribute} from './progress-dom.js';
import {language as appLanguage} from './i18n/index.js';
const text=localizedText('activity'),active=job=>['queued','running'].includes(job?.state);

// Each mounted owner reads only its own current maintenance job. Leaving the
// view aborts status reads and stops polling without cancelling durable work.
export function inventoryMaintenanceUI({state,api,esc,owner,actions,access=operation=>operation()}){
 let current=null,timer=null;
 const host=entry=>entry===current&&entry.context===state.storage?.contextId?document.querySelector('[data-inventory-maintenance="'+actions+'"]'):null;
 const visible=entry=>!!host(entry)&&document.visibilityState!=='hidden';
 function stop(){clearTimeout(timer);timer=null;if(current?.operation==='status')current.controller?.abort();}
 function selected(){
  const value=owner(),context=state.storage?.contextId,key=value?JSON.stringify([context,value.prefix,value.id]):null;
  if(current?.key!==key){stop();current=value?{...value,key,context,job:null,loaded:false,pending:false,error:'',node:null}:null;}return current;
 }
 const button=(operation,label)=>'<button type="button" class="button" data-action="'+actions+'-'+operation+'">'+esc(text(label))+'</button>';
 function view(){return selected()?'<section class="panel" data-inventory-maintenance="'+actions+'"><h2 data-title></h2><p data-help></p><p data-status role="status" aria-live="polite"></p><progress data-progress hidden></progress><p data-error role="alert" hidden></p><div class="inline-actions">'+button('start','inventoryStart')+button('cancel','inventoryCancel')+button('retry','inventoryRetry')+button('status','inventoryRefresh')+'</div></section>':'';}
 function paint(entry){
  const node=host(entry);if(!node)return;const job=entry.job,running=active(job),progress=job?.progress;
  updateText(node.querySelector('[data-title]'),text('inventoryTitle'));updateText(node.querySelector('[data-help]'),text('inventoryHelp'));
  const stage=job?.state==='completed'?'inventoryComplete':job?.state==='failed'&&job.error==='CONFLICT'?'inventoryStale':job?.state==='cancelled'?'inventoryPaused':running?'inventoryStage:'+progress.stage:job?.state==='failed'?'failed':entry.loaded?'inventoryIdle':'inventoryLoading';
  let label;try{label=text(stage);}catch{label=text(running?'running':stage);}
  if(running&&progress.total>0)label+=' '+text('countTotal',{count:progress.done.toLocaleString(appLanguage()),total:progress.total.toLocaleString(appLanguage())});
  updateText(node.querySelector('[data-status]'),label);const bar=node.querySelector('[data-progress]');updateProperty(bar,'hidden',!running||!progress.total);if(running&&progress.total){updateProperty(bar,'max',progress.total);updateProperty(bar,'value',progress.done);updateAttribute(bar,'aria-label',label);}
  const failure=entry.error||(job?.state==='failed'&&job.error!=='CONFLICT'?job.message:'')||'',error=node.querySelector('[data-error]');updateText(error,failure);updateProperty(error,'hidden',!failure);
  for(const operation of ['start','cancel','retry','status']){const control=node.querySelector('[data-action="'+actions+'-'+operation+'"]');updateProperty(control,'disabled',entry.pending||!entry.loaded&&operation!=='status');updateProperty(control,'hidden',operation==='start'?!!job&&job.state!=='completed':operation==='cancel'?!running:operation==='retry'?!['failed','cancelled'].includes(job?.state):false);updateText(control,text({start:job?'inventoryAgain':'inventoryStart',cancel:'inventoryCancel',retry:'inventoryRetry',status:'inventoryRefresh'}[operation]));}
 }
 function schedule(entry){clearTimeout(timer);if(visible(entry)&&active(entry.job)&&!entry.error)timer=setTimeout(()=>{if(visible(entry))void request(entry,'status');},1500);}
 async function request(entry,operation){
  if(entry.pending||entry!==current)return;entry.pending=true;entry.operation=operation;entry.error='';entry.controller=new AbortController();paint(entry);
  try{
   const perform=()=>api(entry.prefix+'/maintenance/inventory/'+operation,['cancel','retry'].includes(operation)?{id:entry.job.id}:{},{adopt:false,owner:null,view:location.hash,signal:entry.controller.signal});
   const result=await (operation==='status'?perform():access(perform));if(entry!==current)return;entry.job=result.job;entry.loaded=true;
  }catch(error){if(entry===current&&!entry.controller.signal.aborted)entry.error=error.message??text('connection');}
  finally{entry.pending=false;entry.controller=null;entry.operation=null;if(entry===current){paint(entry);schedule(entry);}}
 }
 function bind(){
  const entry=selected(),node=entry&&host(entry);if(!node||document.visibilityState==='hidden'){stop();return;}
  paint(entry);if(entry.node!==node){entry.node=node;void request(entry,'status');}else if(!entry.pending)schedule(entry);
 }
 document.addEventListener('visibilitychange',bind);onLanguageChange(()=>{if(current)paint(current);});
 return {view,bind,async action(node){const operation=node.dataset.action?.slice(actions.length+1);if(!node.dataset.action?.startsWith(actions+'-')||!['start','status','cancel','retry'].includes(operation))return false;const entry=selected();if(entry&&host(entry)&&(!['cancel','retry'].includes(operation)||entry.job))await request(entry,operation);return true;}};
}
