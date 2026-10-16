import {taskPrerequisiteClient} from './task-prerequisite-client.js';
import {moduleReferenceClient} from './reference-client.js';
import {moduleReferencePicker} from './reference-picker.js';
import {taskConstraintDraft,taskDependencyReference,taskReferenceKey,sameTaskReference,taskPrerequisiteEffect} from '../task-prerequisite-model.js';
import {t,language} from '../i18n/index.js';
const tr=(key,values)=>t('taskPrerequisites',key,values);
const text=(node,value)=>{if(!node)return;if(node.textContent!==value)node.textContent=value;node.hidden=!value;};
export function taskPrerequisitesUI(services,context){
 const {state,esc}=services,current=()=>context.current;
 const active=()=>state.page==='module'&&state.moduleId==='planning'&&current()?.type==='task';
 const identity=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.projectOwner,state.modulePath,current()?.id]);
 const signature=()=>active()?JSON.stringify([identity(),current().expectedRevision,taskConstraintDraft(current().data)]):null;
 const client=taskPrerequisiteClient({...services,current}),referenceClient=moduleReferenceClient({...services,current,active,identity:()=>signature()});
 let stamp=null,root=null,offset=0,page=null,request=null,error=null,loading=false,rowStamp=null;const labels=new Map();
 const picker=moduleReferencePicker({...services,client:referenceClient,current,typeLabel:()=>tr('task'),onChoose:async(item,{draft,stillCurrent})=>{
  if(!stillCurrent()||current()!==draft)return;
  const reference=item.reference;if(reference.workspaceId===state.book.id&&reference.id===draft.id)return;
  if(!draft.data.dependencies.some(value=>sameTaskReference(taskDependencyReference(value,state.book.id),reference)))draft.data.dependencies.push(reference.workspaceId===state.book.id?reference.id:{...reference});
  context.change();context.draw();
 }});
 function sync(){
  const next=signature();if(next===stamp)return false;
  const oldIdentity=stamp&&JSON.parse(stamp)[0];request?.abort();request=null;client.cancel();referenceClient.sync();stamp=next;page=null;error=null;loading=false;
  if(!next||oldIdentity!==identity()){offset=0;labels.clear();}else offset=Math.min(offset,Math.max(0,Math.floor((current().data.dependencies.length-1)/25)*25));
  return true;
 }
 const references=()=>current().data.dependencies.slice(offset,offset+25).map(value=>taskDependencyReference(value,state.book.id));
 const button=(label,command,attrs='',style='')=>context.button(label,command,attrs,style);
 function row(reference){const key=taskReferenceKey(reference);return '<div class="task-prerequisite-row" data-task-prerequisite="'+esc(key)+'"><div class="task-prerequisite-heading"><div><button type="button" class="text-button" data-action="module-reference-open" data-reference-workspace="'+esc(reference.workspaceId)+'" data-reference-type="task" data-reference-id="'+esc(reference.id)+'" data-prerequisite-title></button><small data-prerequisite-owner></small></div>'+button(tr('remove'),'remove-prerequisite','data-key="'+esc(key)+'"','subtle')+'</div><p data-prerequisite-state></p><p data-prerequisite-observation></p></div>';}
 function view(){
  sync();return '<section class="module-block" data-task-prerequisites><h2>'+esc(tr('heading'))+'</h2><div class="inline-actions">'+context.itemField('dependencies',tr('add'))+button(tr('other'),'other-prerequisite')+button(tr('check'),'check-prerequisites','data-prerequisite-check')+'</div><p data-prerequisite-notice></p><p data-prerequisite-error role="alert"></p><p data-prerequisite-page-status role="status"></p><div data-prerequisite-rows></div><nav data-prerequisite-pages class="inline-actions" aria-label="'+esc(tr('pages'))+'">'+button(tr('previous'),'previous-prerequisites','data-prerequisite-previous')+button(tr('next'),'next-prerequisites','data-prerequisite-next')+'</nav></section>';
 }
 function paint(){
  if(!root?.isConnected||!active())return;
  const selected=references(),keys=JSON.stringify([selected,language()]),rows=root.querySelector('[data-prerequisite-rows]');
  if(rowStamp!==keys||rows.children.length!==selected.length){rows.innerHTML=selected.map(row).join('');rowStamp=keys;}
  for(let index=0;index<selected.length;index++){
   const reference=selected[index],node=rows.children[index],item=page?.items.find(value=>sameTaskReference(value.reference,reference)),cached=labels.get(taskReferenceKey(reference));
   const available=item?.status==='available',unavailable=item?.status==='unavailable',observed=item?.observedRevision??current().base?.prerequisiteObservations?.find(value=>sameTaskReference(value.reference,reference))?.revision;
   const title=node.querySelector('[data-prerequisite-title]');text(title,available?item.title:unavailable?tr('task'):cached?.title??tr('notChecked'));title.disabled=unavailable&&!['ACCESS_LOCKED','ACCESS_DENIED','DEVICE_UNKNOWN'].includes(item.code);
   const owner=available?item.owner:!unavailable?cached?.owner:null;
   text(node.querySelector('[data-prerequisite-owner]'),owner?[owner.workspaceTitle,owner.projectTitle,owner.notebookTitle].filter(Boolean).join(' / '):'');
   text(node.querySelector('[data-prerequisite-state]'),available?tr('current',{status:tr(item.taskStatus)}):tr(unavailable?'unavailable':loading?'loading':'notChecked'));
   text(node.querySelector('[data-prerequisite-observation]'),observed?tr('observed',{revision:observed})+(available&&item.changed?' / '+tr('changed'):''):'');
  }
  const d=current(),effect=taskPrerequisiteEffect(d.base,d.data,{workspaceId:state.book.id});
  text(root.querySelector('[data-prerequisite-notice]'),d.data.status==='done'?(d.data.checklist.some(item=>!item.done)?tr('checklist'):effect.completionRequired&&effect.foreignReferences.length?tr('completionPending'):''):'');
  text(root.querySelector('[data-prerequisite-error]'),error?error.message==='TASK_READINESS_RESPONSE'?tr('invalid'):error.message??tr('failed'):'');
  const total=d.data.dependencies.length;
  text(root.querySelector('[data-prerequisite-page-status]'),total>25?tr('range',{first:offset+1,last:Math.min(offset+25,total),total}):total?'':tr('empty'));
  root.querySelector('[data-prerequisite-pages]').hidden=total<=25;
  text(root.querySelector('[data-prerequisite-check]'),tr(total>25?'checkShown':'check'));
  root.querySelector('[data-prerequisite-check]').disabled=loading||!total;
  root.querySelector('[data-prerequisite-previous]').disabled=loading||offset===0;
  root.querySelector('[data-prerequisite-next]').disabled=loading||offset+25>=total;
 }
 async function load(unlock=false){
  sync();if(!active()||!root?.isConnected)return;request?.abort();const pending=request=new AbortController(),key=stamp;loading=true;error=null;paint();
  try{const result=await client.readiness({offset,unlock,signal:pending.signal});if(request!==pending||key!==signature())return;page=result;for(const item of result.items){const key=taskReferenceKey(item.reference);if(item.status==='available')labels.set(key,item);else labels.delete(key);}}
  catch(failure){if(request===pending&&key===signature()&&failure.name!=='AbortError')error=failure;}
  finally{if(request===pending&&key===signature()){request=null;loading=false;paint();}}
 }
 function bind(){picker.sync();const changed=sync();if(!active()){stop();return;}const next=document.querySelector('[data-task-prerequisites]');if(root!==next){root=next;rowStamp=null;}paint();if(root&&(changed||!page)&&!request)void load();}
 async function action(name,node){
  if(name==='other-prerequisite'){picker.open({title:tr('choose'),types:['task']});return true;}
  if(name==='check-prerequisites'){await load(true);return true;}
  if(name==='previous-prerequisites'||name==='next-prerequisites'){offset=Math.max(0,offset+(name==='next-prerequisites'?25:-25));page=null;rowStamp=null;await load();return true;}
  if(name==='remove-prerequisite'){const d=current();d.data.dependencies=d.data.dependencies.filter(value=>taskReferenceKey(taskDependencyReference(value,state.book.id))!==node.dataset.key);context.change();context.draw();return true;}
  return false;
 }
 function stop(){request?.abort();request=null;client.cancel();referenceClient.cancel();picker.stop();stamp=null;root=null;page=null;error=null;loading=false;rowStamp=null;labels.clear();}
 return {view,bind,changed:bind,action,stop,commandRequest:client.commandRequest};
}
