import {t} from './i18n/index.js';

const text=(key,values)=>t('retainedSources',key,values);
const identity=value=>JSON.stringify([value.kind,value.id,value.revision]);
const reference=({kind,id,revision})=>({kind,id,revision});
const finished=new Set(['checked','unavailable','stale']);

// Dependency checks annotate a visible, bounded evidence page. They never own
// its list, selection, inspection controls or downloads.
export function evidenceDependencyReview({call,esc}){
 let current=null,epoch=0;
 const available=run=>run===current&&run.host.isConnected&&run.active();
 function stop(){epoch++;const run=current;current=null;run?.controller?.abort();run?.observer?.disconnect();}
 function valid(run){if(available(run))return true;if(run===current)stop();return false;}
 function rowText(value){
  if(value.dependencyStatus==='checked')return value.changedCount?text('reviewChanged',{count:value.changedCount}):text('reviewChecked');
  return text({checking:'reviewChecking',unavailable:'reviewUnavailable',stale:'reviewStale',failed:'reviewFailed',cancelled:'reviewCancelled'}[value.dependencyStatus]??'reviewUnchecked');
 }
 const row=(item,index)=>'<p class="material-review" data-evidence-dependency-item="'+index+'" data-dependency-status="'+esc(item.dependencyStatus??'unchecked')+'">'+esc(rowText(item))+'</p>';
 const controls=()=>'<section data-evidence-dependency-review aria-label="'+esc(text('reviewTitle'))+'"><p data-dependency-progress role="status">'+esc(text('reviewUnchecked'))+'</p><progress data-dependency-meter hidden aria-label="'+esc(text('reviewTitle'))+'"></progress><div class="inline-actions"><button type="button" class="button" data-action="material-dependencies-cancel" hidden>'+esc(text('reviewCancel'))+'</button><button type="button" class="button" data-action="material-dependencies-retry" hidden>'+esc(text('reviewRetry'))+'</button><button type="button" class="button" data-action="material-dependencies-refresh" hidden>'+esc(text('reviewRefresh'))+'</button></div></section>';
 function paint(run,message){
  if(!valid(run))return;
  for(const [index,item] of run.items.entries()){
   const node=run.host.querySelector('[data-evidence-dependency-item="'+index+'"]');if(!node)continue;
   const value=rowText(item);if(node.textContent!==value)node.textContent=value;node.dataset.dependencyStatus=item.dependencyStatus;
  }
  const completed=run.items.filter(item=>item.dependencyStatus==='checked').length;
  const status=run.host.querySelector('[data-dependency-progress]');status.textContent=message??text(run.running?'reviewItems':'reviewFinished',{completed,total:run.items.length});
  const meter=run.host.querySelector('[data-dependency-meter]');meter.hidden=!run.running;
  run.host.querySelector('[data-action="material-dependencies-cancel"]').hidden=!run.running;
  run.host.querySelector('[data-action="material-dependencies-retry"]').hidden=run.running||!run.items.some(item=>!['checked','stale'].includes(item.dependencyStatus));
  run.host.querySelector('[data-action="material-dependencies-refresh"]').hidden=run.running||!run.items.some(item=>item.dependencyStatus==='stale');
 }
 function progress(run,value,offset){
  if(!valid(run)||!run.running)return;
  const meter=run.host.querySelector('[data-dependency-meter]');
  if(value.stage==='checking-evidence-references'&&Number.isSafeInteger(value.completed)&&value.completed>=0){meter.removeAttribute('value');paint(run,text('reviewReferences',{count:value.completed}));}
  else if(value.stage==='reviewing-evidence-dependencies'&&Number.isSafeInteger(value.completed)&&value.completed>=0){meter.max=run.items.length;meter.value=Math.min(run.items.length,offset+value.completed);paint(run,text('reviewItems',{completed:offset+value.completed,total:run.items.length}));}
 }
 async function review(run){
  if(!valid(run)||run.running)return;
  const generation=++epoch,controller=new AbortController();run.controller=controller;run.running=true;
  const pending=run.items.filter(item=>!finished.has(item.dependencyStatus)||item.dependencyStatus==='unavailable');
  for(const item of pending)item.dependencyStatus='unchecked';
  const meter=run.host.querySelector('[data-dependency-meter]');meter.max=run.items.length;meter.value=run.items.length-pending.length;
  paint(run);
  try{
   for(let offset=0;offset<pending.length;offset+=50){
    if(!valid(run)||generation!==epoch)return;controller.signal.throwIfAborted();
    const batch=pending.slice(offset,offset+50);for(const item of batch)item.dependencyStatus='checking';paint(run);
    const result=await call('dependency-review',{recordId:run.recordId,refs:batch.map(reference)},{adopt:false,signal:controller.signal,onProgress:value=>{if(generation===epoch)progress(run,value,run.items.length-pending.length+offset);}});
    if(!valid(run)||generation!==epoch)return;controller.signal.throwIfAborted();
    const expected=new Map(batch.map(item=>[identity(item),item])),seen=new Set();
    if(!Array.isArray(result?.items)||result.items.length!==batch.length)throw Error(text('invalid'));
    for(const value of result.items){
     const key=identity(value);
     if(!expected.has(key)||seen.has(key)||!finished.has(value.dependencyStatus)||!Array.isArray(value.changed)||(value.dependencyStatus==='checked'? !Number.isSafeInteger(value.changedCount)||value.changedCount<value.changed.length : value.changedCount!==null||value.changed.length!==0))throw Error(text('invalid'));
     seen.add(key);
    }
    for(const value of result.items)Object.assign(expected.get(identity(value)),{dependencyStatus:value.dependencyStatus,changedCount:value.changedCount,changed:value.changed});
    paint(run);
   }
  }catch(error){
   if(!valid(run)||generation!==epoch)return;
   for(const item of pending)if(['checking','unchecked'].includes(item.dependencyStatus))item.dependencyStatus=controller.signal.aborted?'cancelled':'failed';
  }finally{if(valid(run)&&generation===epoch){run.running=false;run.controller=null;paint(run);}}
 }
 function start({host,items,recordId,active}){
  stop();if(!host||!items.length)return;
  const run=current={host,recordId,active,items:items.map(item=>({...reference(item),dependencyStatus:item.dependencyStatus??'unchecked',changedCount:item.changedCount,changed:item.changed})),running:false,controller:null,observer:null};
  run.observer=new MutationObserver(()=>{if(!available(run))stop();});run.observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
  void review(run);
 }
 function action(name){
  const run=current;if(!run||!valid(run))return false;
  if(name==='dependencies-cancel'){
   if(!run.running)return false;
   epoch++;run.controller?.abort();run.controller=null;run.running=false;
   for(const item of run.items)if(['checking','unchecked'].includes(item.dependencyStatus))item.dependencyStatus='cancelled';
   paint(run,text('reviewCancelled'));return true;
  }
  if(name==='dependencies-retry'){void review(run);return true;}return false;
 }
 return {row,controls,start,stop,action,check:()=>{if(current)valid(current);}};
}
