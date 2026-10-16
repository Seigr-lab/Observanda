import {moduleReferenceClient,referenceKey,validModuleReference} from './reference-client.js';
import {moduleReferencePicker} from './reference-picker.js';
import {FEATURE_MODULES,enabledModule,moduleForEntity} from '../feature-modules.js';
import {t} from '../i18n/index.js';
import {fieldLabel} from '../data-registry.js';
const tr=(key,values)=>t('moduleReferenceTargets',key,values);
const locked=code=>['ACCESS_LOCKED','ACCESS_DENIED','DEVICE_UNKNOWN'].includes(code);

export function moduleReferenceLinks(services,{moduleId,current,changed,draw}){
 const {state,esc}=services;
 const active=()=>state.page==='module'&&state.moduleId===moduleId;
 const identity=()=>JSON.stringify([state.modulePath,current()?.id]);
 const client=moduleReferenceClient({...services,identity,active});
 let request=null,stamp=null,error=null,root=null;const labels=new Map();
 const types=()=>[...new Set(FEATURE_MODULES.filter(module=>enabledModule(state.dashboardSettings,module.id)).flatMap(module=>module.entityTypes??[]))];
 const typeLabel=type=>{if(['record','notebook','project'].includes(type))return tr(type);const module=moduleForEntity({type,data:{}},[]);return module?.entityTypes.length>1?module.label+' / '+fieldLabel(type):module?.label??fieldLabel(type);};
 const picker=moduleReferencePicker({...services,client,current,typeLabel,onChoose:async(item,{draft,stillCurrent})=>{
  if(!stillCurrent()||current()!==draft)return;
  const reference={...item.reference},key=referenceKey(reference);
  if(!draft.data.links.some(value=>referenceKey(value)===key))draft.data.links.push(reference);
  labels.set(key,{...item,status:'available'});stamp=null;changed();draw();
 }});
 function content(reference){
  const item=labels.get(referenceKey(reference));
  const title=item?.status==='available'?item.title:item?.status==='unavailable'?tr(locked(item.code)?'locked':'unavailable'):tr(error?'failed':'loading');
  const unavailable=item?.status==='unavailable'&&!locked(item.code);
  return '<button type="button" class="text-button" data-action="module-reference-open" data-reference-workspace="'+esc(reference.workspaceId)+'" data-reference-type="'+esc(reference.type)+'" data-reference-id="'+esc(reference.id)+'" '+(unavailable?'disabled':'')+'>'+esc(title)+'</button><small>'+esc(typeLabel(reference.type))+'</small>';
 }
 function link(reference){return '<span class="module-link" data-module-reference-key="'+esc(referenceKey(reference))+'" data-reference-workspace="'+esc(reference.workspaceId)+'" data-reference-type="'+esc(reference.type)+'" data-reference-id="'+esc(reference.id)+'">'+content(reference)+'</span>';}
 function buttons(){return '<button type="button" class="button" data-action="module-reference-research">'+esc(tr('research'))+'</button><button type="button" class="button" data-action="module-reference-modules">'+esc(tr('modules'))+'</button><span data-module-reference-notice></span>';}
 function paint(){
  if(!root?.isConnected||!active())return;
  for(const node of root.querySelectorAll('[data-module-reference-key]'))node.innerHTML=content({workspaceId:node.dataset.referenceWorkspace,type:node.dataset.referenceType,id:node.dataset.referenceId});
  const node=root.querySelector('[data-module-reference-notice]');if(node)node.innerHTML=error?'<p role="alert">'+esc(error.message==='MODULE_REFERENCE_RESPONSE'?tr('invalid'):error.message??tr('failed'))+'</p><button type="button" class="button" data-action="module-reference-labels-retry">'+esc(tr('retryLabels'))+'</button>':'';
 }
 function stop(){picker.stop();client.cancel();request?.abort();request=null;stamp=null;root=null;error=null;labels.clear();}
 async function bind(){
  picker.sync();if(!active()){stop();return;}
  root=document.querySelector('.module-workbench');if(!root)return;
  const references=[...new Map([...root.querySelectorAll('[data-module-reference-key]')].map(node=>{
   const reference={workspaceId:node.dataset.referenceWorkspace,type:node.dataset.referenceType,id:node.dataset.referenceId};return [referenceKey(reference),reference];
  })).values()],key=JSON.stringify([state.storage?.contextId,state.book?.id,state.etag,identity(),references]);
  const visible=new Set(references.map(referenceKey));for(const key of labels.keys())if(!visible.has(key))labels.delete(key);
  if(stamp===key){paint();return;}stamp=key;error=null;request?.abort();const pending=request=new AbortController();
  try{
   for(let offset=0;offset<references.length;offset+=25){
    const response=await client.labels(references.slice(offset,offset+25),{signal:pending.signal});
    if(request!==pending||stamp!==key||!active())return;
    for(const item of response.items)labels.set(referenceKey(item.reference),item);
   }
  }catch(failure){if(request!==pending||stamp!==key||!active()||failure.name==='AbortError')return;error=failure;labels.clear();}
  finally{if(request===pending){request=null;paint();}}
 }
 async function action(node){
  const command=node.dataset.action;
  if(command==='module-reference-open'){
   const target={workspaceId:node.dataset.referenceWorkspace,type:node.dataset.referenceType,id:node.dataset.referenceId};if(validModuleReference(target))await services.openReference(target);return true;
  }
  if(command==='module-reference-labels-retry'){stamp=null;await bind();return true;}
  if(command==='module-reference-research'){picker.open({title:tr('research'),types:['record','notebook','project'],kind:'record'});return true;}
  if(command==='module-reference-modules'){picker.open({title:tr('modules'),types:types()});return true;}
  return false;
 }
 return {link,buttons,bind,stop,action};
}
