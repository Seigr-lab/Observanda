import {t} from './i18n/index.js';
import {activityState,activityTitle,activityWait} from './activity-ui.js';
import {activityOwner,activityResource} from './activity-owner.js';

const states=['uncertain','queued','running','failed','completed','cancelled','recovered'];
const priority=(a,b)=>states.indexOf(activityState(a))-states.indexOf(activityState(b))||b.updatedAt-a.updatedAt;

export async function openDiagnostics({api,esc,showDialog,activity,currentContext}){
 const msg=(key,values)=>esc(t('preferences',key,values));
 const label=key=>esc(t('activity',key));
 const button=(key,attribute)=>'<button type="button" class="button" '+attribute+'>'+msg(key)+'</button>';
 const scope=currentContext();
 showDialog('<h2 id="dialog-title">'+msg('diagnostics')+'</h2><div data-health-summary aria-live="polite" aria-busy="true">'+msg('diagnosticsChecking')+'</div>'+
  '<div class="dialog-actions">'+button('diagnosticsClose','data-action="close-dialog"')+'</div>');
 const dialog=document.querySelector('#dialog'),body=dialog.querySelector('[data-health-summary]');
 const requests=[api('/api/diagnostics/status',undefined,{adopt:false}),api('/api/health',undefined,{adopt:false}),activity.refresh()];
 const [log,probe,observed]=await Promise.allSettled(requests);
 if(!body.isConnected||!dialog.open||scope!==currentContext())return;
 if(log.reason?.code==='ACCESS_LOCKED'||observed.reason?.code==='ACCESS_LOCKED'){dialog.close();return;}
 const report=log.value,health=probe.value,snapshot=observed.value;
 const operations=snapshot?.contextId===scope?snapshot.operations:null;
 const selected=health?.selectedWorkspace;
 let storageKey='diagnosticsStorageUnknown';
 if(selected?.ready&&selected.storage==='readable')storageKey='diagnosticsStorageReady';
 else if(selected?.state==='locked')storageKey='diagnosticsStorageLocked';
 const lanes=report?.requests??{};
 const pending=Object.values(lanes).reduce((sum,lane)=>sum+lane.queued,0);
 const writers=report?.writers?.queued??0,disk=report?.disk?.pending??0;
 let content='<p>'+msg(health?.liveness?.ready?'diagnosticsServiceReady':'diagnosticsServiceUnknown')+'</p><p>'+msg(storageKey)+'</p>';
 if(health?.scratch?.ready===false)content+='<p>'+msg('diagnosticsBackgroundUnavailable')+'</p>';
 if(report)content+='<p>'+msg(pending||writers||disk?'diagnosticsWaiting':'diagnosticsNoWait',{requests:pending,writes:writers,storage:disk})+'</p>';
 content+='<h3>'+esc(t('activity','title'))+'</h3>';
 if(operations){
  const counts=new Map(),owners=new Map(),actionable=[];
  for(const entry of operations){
   const state=activityState(entry);counts.set(state,(counts.get(state)??0)+1);
   if(state==='running')owners.set(activityResource(entry.kind),entry);
   if(['uncertain','queued','failed'].includes(state)&&(actionable.length<8||priority(entry,actionable.at(-1))<0)){
    actionable.push(entry);actionable.sort(priority);if(actionable.length>8)actionable.pop();
   }
  }
  content+=operations.length?'<p>'+states.filter(state=>counts.has(state)).map(state=>label(state)+' ('+counts.get(state)+')').join(' · ')+'</p>':'<p>'+esc(t('activity','empty'))+'</p>';
  if(actionable.length)content+='<ul>'+actionable.map(entry=>{
   const state=activityState(entry),view=activityOwner(entry.kind,entry.view),blocker=owners.get(activityResource(entry.kind));
   let detail=esc(activityWait(entry,blocker));
   if(state==='uncertain')detail=msg('diagnosticsInspect');
   return '<li><strong>'+esc(activityTitle(entry.kind,view))+'</strong> · '+label(state)+(detail?' — '+detail:'')+
    (view?' <a href="'+esc(view)+'" data-health-owner>'+esc(t('activity','showProgress'))+'</a>':'')+'</li>';
  }).join('')+'</ul>';
  if(operations.length)content+=button('diagnosticsActivity','data-health-activity');
 }else content+='<p>'+msg('diagnosticsActivityUnknown')+'</p>';
 content+='<p>'+msg('diagnosticsSummary')+'</p><p data-report-status>'+msg(report?.status.available?'diagnosticsAvailable':'diagnosticsUnavailable')+'</p>';
 if(report)content+='<details><summary>'+msg('diagnosticsContents')+'</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere" data-diagnostic-content></pre></details>'+button('diagnosticsDownload','data-diagnostic-download hidden');
 body.innerHTML=content;body.removeAttribute('aria-busy');
 body.querySelector('[data-health-activity]')?.addEventListener('click',()=>{dialog.close();activity.open();});
 for(const link of body.querySelectorAll('[data-health-owner]'))link.addEventListener('click',()=>dialog.close());
 if(report){
  const details=body.querySelector('details'),download=body.querySelector('[data-diagnostic-download]');
  let support,pending=false;
  details.addEventListener('toggle',async()=>{
   if(!details.open||support||pending)return;
   pending=true;details.setAttribute('aria-busy','true');
   try{
    const current=await api('/api/diagnostics',undefined,{adopt:false});
    if(!body.isConnected||!dialog.open||scope!==currentContext())return;
    support=JSON.stringify(current,null,2);body.querySelector('[data-diagnostic-content]').textContent=support;download.hidden=false;
    body.querySelector('[data-report-status]').textContent=t('preferences',current.status.available?'diagnosticsAvailable':'diagnosticsUnavailable');
   }catch(error){
    if(!body.isConnected||!dialog.open||scope!==currentContext())return;
    if(error.code==='ACCESS_LOCKED'){dialog.close();return;}
    body.querySelector('[data-report-status]').textContent=t('preferences','diagnosticsUnavailable');details.open=false;
   }finally{pending=false;details.removeAttribute('aria-busy');}
  });
  download.addEventListener('click',()=>{
   if(!support||scope!==currentContext())return;
   const url=URL.createObjectURL(new Blob([support+'\n'],{type:'application/json'})),link=document.createElement('a');
   link.href=url;link.download='observanda-diagnostics.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
 }
}
