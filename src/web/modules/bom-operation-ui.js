import {bomConnectionsUI} from './bom-connections-ui.js';
import {bomOperationClient} from './bom-operation-client.js';
import {addressedBOM} from './bom-model.js';
import {t} from '../i18n/index.js';
const tr=(key,args)=>t('bomStock',key,args);
const sourceError=code=>{if(['ACCESS_LOCKED','ACCESS_DENIED','DEVICE_UNKNOWN'].includes(code))return tr('sourceAccess');try{return t('errors',code);}catch{return tr('operationFailed');}};
const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
export function bomOperationUI(services,c){
 const {state,esc}=services,connections=bomConnectionsUI(services,c);let timer=null,request=null,stamp=null,error=null,loading=false;
 const active=()=>state.page==='module'&&state.moduleId==='resources'&&c.current?.type==='bom';
 const viewIdentity=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.projectOwner,state.modulePath,c.current?.id]),identity=()=>viewIdentity()+':'+c.current?.expectedRevision;let lifetime=0;
 const client=bomOperationClient({...services,current:()=>c.current,changed:()=>paint()}),summary=()=>client.get(c.current?.id);
 function view(){return '<section class="module-block" data-bom-operation hidden><h2>'+esc(tr('pendingHeading'))+'</h2><p data-bom-operation-phase role="status"></p><p data-bom-operation-count></p><p data-bom-operation-error role="alert"></p><div data-bom-operation-usage></div><div class="inline-actions">'+c.button(tr('resume'),'bom-operation-resume','data-bom-resume')+c.button(tr('abort'),'bom-operation-abort','data-bom-abort')+c.button(tr('operationRetry'),'bom-operation-status','data-bom-status')+'</div>'+connections.view()+'</section>';}
 function paint(){
  if(!active())return;const root=document.querySelector('[data-bom-operation]');if(!root)return;const value=summary();root.hidden=!value&&!error;if(root.hidden)return;
  root.querySelector('[data-bom-connections]').hidden=!value?.error||value.terminal;connections.paint();
  text(root.querySelector('[data-bom-operation-phase]'),value?tr(value.phase):'');text(root.querySelector('[data-bom-operation-count]'),value&&!value.terminal?tr('remaining',{remaining:value.remaining,total:value.participants}):'');
  text(root.querySelector('[data-bom-operation-error]'),error?(error.message==='BOM_OPERATION_RESPONSE'?tr('operationInvalid'):error.message??tr('statusFailed')):value?.error?sourceError(value.error.code):'');
  const usage=root.querySelector('[data-bom-operation-usage]'),signature=JSON.stringify(value?.usage??[]);if(usage.dataset.signature!==signature){usage.dataset.signature=signature;usage.innerHTML=(value?.usage??[]).map(item=>{const line=c.current.data.lines.find(line=>line.id===item.lineId);return '<p>'+esc((line?.references||line?.value||'')+': '+tr('used',{quantity:item.used,unit:line?.unit??''})+' / '+tr('scrapped',{quantity:item.scrapped,unit:line?.unit??''}))+'</p>';}).join('');}
  root.querySelector('[data-bom-resume]').hidden=!value?.canResume;root.querySelector('[data-bom-abort]').hidden=!value?.canAbort;root.querySelector('[data-bom-status]').hidden=!error;for(const button of root.querySelectorAll('[data-bom-resume],[data-bom-abort],[data-bom-status]'))button.disabled=loading;
  const plan=document.querySelector('[data-bom-plan]');if(plan){plan.disabled=c.current.data.status!=='draft'||!!value&&!value.terminal;const save=plan.closest('form')?.querySelector('[type="submit"]');if(save)save.disabled=plan.disabled;}
  const region=document.querySelector('[data-bom-stock-actions]');if(region)region.hidden=!!value&&!value.terminal;
 }
 async function load(){
  if(!active()||c.current.expectedRevision===null)return;request?.abort();const pending=request=new AbortController(),key=identity();loading=true;error=null;paint();
  try{const before=summary(),result=await client.status({signal:pending.signal});if(before&&!before.terminal&&result.operation?.terminal&&request===pending&&key===identity()&&!c.operation&&JSON.stringify(c.current.data)===JSON.stringify(c.current.base))await c.refresh();}catch(failure){if(request===pending&&key===identity()&&failure.name!=='AbortError')error=failure;}
  finally{if(request===pending&&key===identity()){request=null;loading=false;paint();clearTimeout(timer);if(summary()&&!summary().terminal)timer=setTimeout(()=>{if(active()&&key===identity())void load();},2000);}}
 }
 function bind(){connections.bind();if(!active()){stop();return;}const key=identity();if(stamp!==key){request?.abort();client.cancel();clearTimeout(timer);stamp=key;error=null;if(c.current.expectedRevision!==null&&(addressedBOM(c.current.data)||c.current.data.externalStock))void load();}paint();}
 async function action(name,node){if(await connections.action(name,node))return true;if(!name.startsWith('bom-operation-'))return false;if(name==='bom-operation-status'){await load();return true;}const value=summary();if(!value)return true;const command=name==='bom-operation-resume'?'bom.resume':name==='bom-operation-abort'?'bom.abort':null;if(!command)return false;
  const key=viewIdentity(),ticket=lifetime,result=await c.command(command,{id:value.id});if(!result.operationPending)client.clear(value.bomId);if(!active()||key!==viewIdentity()||ticket!==lifetime)return true;if(!result.operationPending)await c.refresh();if(active()&&key===viewIdentity()&&ticket===lifetime)c.draw();return true;
 }
 async function commandRequest(run,options){clearTimeout(timer);request?.abort();request=null;client.cancel();loading=false;try{return await client.commandRequest(run,options);}finally{if(active()&&summary()&&!summary().terminal){const key=identity();timer=setTimeout(()=>{if(active()&&key===identity())void load();},2000);}}}
 function stop(){lifetime++;connections.stop();clearTimeout(timer);request?.abort();request=null;client.cancel();stamp=null;loading=false;error=null;}
 return {view,bind,paint,action,stop,summary,settled(){client.clear(c.current?.id);},commandRequest,pendingCommand:client.pendingCommand};
}
