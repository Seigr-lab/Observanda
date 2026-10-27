import {recordValuesView} from './record-values-ui.js';
import {recordWritingView} from './record-writing-ui.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('recordDraftReview',key,args);
const groups=['details','writing','custom','contributors','relations','media','figures','preparations','events','assessments','results','tags'];
export async function editRecordCheckpoint(options,{plan,signal,host=null,onChange=()=>{},onSave=null}){
 const {api,esc,state}=options,dialog=host??document.createElement('dialog');dialog.className='record-writing record-draft-edit';dialog.setAttribute('aria-labelledby','checkpoint-edit-title');if(!host)document.body.append(dialog);
 const prior=document.activeElement,identity=JSON.stringify([state.storage?.contextId,state.book?.id]);
 let group='details',page=null,base=null,value=null,view=null,dirty=false,busy=false,error='',status='',timer=null,pending=null,queue=Promise.resolve(),last='',finished=false,epoch=0,resolve,conflict=false;
 const result=new Promise(done=>resolve=done),target=()=>({id:plan.id,workspaceId:plan.workspaceId,expectedRevision:plan.revision});
 const current=()=>!finished&&!state.access?.locked&&JSON.stringify([state.storage?.contextId,state.book?.id])===identity;
 const request=(operation,data={},opts={})=>{if(!current())throw Error(text('changedContext'));return api('/api/research/drafts/review/'+operation,{...target(),...data},{adopt:false,signal:opts.signal??signal});};
 const lifecycle={context:()=>current()?plan.id+':'+epoch:null,refresh:()=>paint(),close:async()=>{await close();return finished;}};
 const viewOptions={...options,figureChoiceRevision:'editRevision',api:(route,data,opts)=>route==='/api/research/records/values/choices'?request('editChoices',{field:data.field,editRevision:base.editRevision,schemaRevision:data.schemaRevision,offset:data.offset,query:data.query},opts):route==='/api/research/records/values/figures'?request('editFigures',{offset:data.offset,editRevision:base.editRevision,...(data.figureId?{figureId:data.figureId}:{})},opts):route==='/api/research/records/values/attempt-context'?request('editAttempts',{field:data.field,prior:data.prior,preparationId:data.preparationId,offset:data.offset,...(data.criterionId!==undefined?{criterionId:data.criterionId}:{}),...(data.criterionOffset!==undefined?{criterionOffset:data.criterionOffset}:{})}):api(route,data,opts)};
 function paint(){
  if(finished)return;dialog.querySelector('[data-checkpoint-error]').textContent=error;dialog.querySelector('[data-checkpoint-status]').textContent=status;
  for(const el of dialog.querySelectorAll('[data-checkpoint-action],[data-checkpoint-group],[data-checkpoint-field]'))el.disabled=busy||!!view?.busy?.();
  const region=dialog.querySelector('[data-writing-fields]');if(region)region.inert=busy;
  const select=dialog.querySelector('[data-checkpoint-select]');if(select)select.disabled=busy||!page?.items.length||!!view?.busy?.();
  dialog.querySelector('[data-checkpoint-action="retry"]').hidden=!error;
  dialog.querySelector('[data-checkpoint-action="discard"]').hidden=!error||!dirty;
  dialog.querySelector('[data-checkpoint-conflict]').hidden=!conflict;
 }
 function fields(){
  view?.release?.();epoch++;const root=dialog.querySelector('[data-writing-fields]');root.replaceChildren();view=null;
  if(!base)return;
  if(base.field.startsWith('tag:'))view={heading:()=>text('group_tags'),fields:()=>options.field(esc(text('tag')), '<input data-checkpoint-tag value="'+esc(value.value??'')+'"><label><input type="checkbox" data-checkpoint-remove-tag'+(value.value===null?' checked':'')+'> '+esc(text('removeTag'))+'</label>'),input:el=>{if(el.hasAttribute('data-checkpoint-tag')){value.value=el.value;return true;}if(el.hasAttribute('data-checkpoint-remove-tag')){value.value=el.checked?null:dialog.querySelector('[data-checkpoint-tag]').value;return true;}return false;}};
  else view=base.field==='body'||base.field.startsWith('section:')?recordWritingView(viewOptions,lifecycle):recordValuesView(viewOptions,lifecycle);
  dialog.querySelector('[data-checkpoint-value-title]').textContent=view.heading(base);root.innerHTML=view.fields(base,value,changed);view.bind?.(dialog);paint();
 }
 function navigation(){
  const root=dialog.querySelector('[data-checkpoint-fields]');
  root.innerHTML=options.field(esc(text('selectedField')),'<select data-checkpoint-select>'+page.items.map(item=>'<option value="'+esc(item.field)+'"'+(item.field===base?.field?' selected':'')+'>'+esc(item.localized?item.field==='body'?text('summary'):t('recordValues',item.field):item.label||text('unnamed',{position:(item.position??0)+1}))+'</option>').join('')+'</select>');
  dialog.querySelector('[data-checkpoint-range]').textContent=page.total?text('fieldRange',{first:page.offset+1,last:Math.min(page.offset+page.items.length,page.total),total:page.total}):text('noFields');
  dialog.querySelector('[data-checkpoint-action="previous"]').hidden=page.offset===0;dialog.querySelector('[data-checkpoint-action="next"]').hidden=page.next===null;paint();
 }
 async function flush(){
  clearTimeout(timer);timer=null;
  const task=queue.then(async()=>{
   if(!dirty||!base||!current())return;
   while(pending||last!==JSON.stringify(value)){
    pending??={field:base.field,value:structuredClone(value),valueRevision:base.revision,editRevision:base.editRevision,operationId:crypto.randomUUID()};
    status=text('checkpointing');paint();const command=pending;
    try{const saved=await request('editWrite',command);if(!current())return;base.revision=saved.revision;base.editRevision=saved.editRevision;last=JSON.stringify(command.value);pending=null;error='';status=text('checkpointed');}
    catch(failure){if(current()){error=failure.message;status='';conflict=failure.code==='DRAFT_CHANGED';if(['INVALID','FORMAT'].includes(failure.code))pending=null;paint();}throw failure;}
   }
   dirty=false;status=text('checkpointed');paint();
  });queue=task.catch(()=>{});return task;
 }
 function changed(){dirty=true;error='';status=text('checkpointing');onChange({field:base.field,value});clearTimeout(timer);timer=setTimeout(()=>void flush().catch(()=>{}),800);paint();}
 async function select(field){await flush();base=await request('editRead',{field});value=structuredClone(base.value);last=JSON.stringify(value);dirty=false;pending=null;conflict=false;error=status='';fields();navigation();dialog.querySelector(view.focus??'[data-writing-fields] input')?.focus();}
 async function load(offset){await flush();page=await request('editFields',{group,offset});if(!page.items.some(item=>item.field===base?.field)){if(page.items.length)await select(page.items[0].field);else{base=value=null;fields();dialog.querySelector('[data-checkpoint-value-title]').textContent='';}}navigation();}
 function finish(){if(finished)return;finished=true;clearTimeout(timer);view?.release?.();if(host)dialog.replaceChildren();else{dialog.close();dialog.remove();}signal?.removeEventListener('abort',abort);window.removeEventListener('beforeunload',unload);document.removeEventListener('visibilitychange',visibility);if(prior?.isConnected)prior.focus({preventScroll:true});resolve();}
 async function close(){if(busy||view?.busy?.())return;busy=true;paint();try{await flush();finish();}catch{busy=false;paint();}}
 const abort=()=>finish(),unload=event=>{if(dirty||pending){event.preventDefault();event.returnValue='';}},visibility=()=>{if(document.hidden&&dirty)void flush().catch(()=>{});};
 dialog.innerHTML='<h2 id="checkpoint-edit-title">'+esc(host?t('configurationEditor','newRecord'):text('editTitle'))+'</h2><p>'+esc(host?t('configurationEditor','newRecordHelp'):text('editHelp'))+'</p>'+options.field(esc(text('fieldGroup')),'<select data-checkpoint-group>'+groups.map(id=>'<option value="'+id+'">'+esc(text('group_'+id))+'</option>').join('')+'</select>')+'<div data-checkpoint-fields class="inline-actions"></div><p role="status" data-checkpoint-range></p><div class="inline-actions"><button class="button" data-checkpoint-action="previous">'+esc(text('previousFields'))+'</button><button class="button" data-checkpoint-action="next">'+esc(text('nextFields'))+'</button></div><h3 data-checkpoint-value-title></h3><div data-writing-fields></div><p role="alert" data-checkpoint-error></p><p data-checkpoint-conflict hidden>'+esc(text('conflictingCorrection'))+'</p><p role="status" data-checkpoint-status></p><div class="dialog-actions"><button class="button" data-checkpoint-action="retry">'+esc(text('retryEdit'))+'</button><button class="button" data-checkpoint-action="discard">'+esc(text('discardCorrection'))+'</button><button class="button primary" data-checkpoint-action="close" data-writing="save">'+esc(text('backToReview'))+'</button></div>';
 if(!host)dialog.oncancel=event=>{event.preventDefault();void close();};
 async function perform(action){if(busy||view?.busy?.())return;busy=true;paint();try{await action();}catch(failure){error=failure.message;}finally{busy=false;paint();}}
 dialog.addEventListener('input',event=>{if(event.target.closest('[data-writing-fields]')){event.stopPropagation();if(!busy&&view?.input?.(event.target,base,value))changed();}});
 dialog.addEventListener('change',event=>{if(event.target.hasAttribute('data-checkpoint-select')){void perform(()=>select(event.target.value));return;}if(!event.target.hasAttribute('data-checkpoint-group'))return;const next=event.target.value;void perform(async()=>{await flush();group=next;await load(0);}).then(()=>{event.target.value=group;});});
 dialog.addEventListener('click',event=>{
  const selected=event.target.closest('[data-checkpoint-field]');if(selected){void perform(()=>select(selected.dataset.checkpointField));return;}
  const action=event.target.closest('[data-checkpoint-action]')?.dataset.checkpointAction;if(!action)return;
  if(action==='close'){void close();return;}
  if(action==='discard'){
   const button=event.target.closest('button');if(button.dataset.confirm!=='true'){button.dataset.confirm='true';button.textContent=text('confirmDiscardCorrection');return;}
   clearTimeout(timer);pending=null;dirty=false;if(host){void perform(()=>select(base.field));return;}finish();return;
  }
  void perform(()=>action==='retry'?flush():load(action==='next'?page.next:Math.max(0,page.offset-8)));
 });
 dialog.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();if(host&&onSave)void onSave();else void perform(flush);}});
 signal?.addEventListener('abort',abort,{once:true});window.addEventListener('beforeunload',unload);document.addEventListener('visibilitychange',visibility);
 if(host)dialog.querySelector('[data-checkpoint-action="close"]').remove();
 if(signal?.aborted){finish();return host?null:result;}if(!host)dialog.showModal();await perform(()=>load(0));return host?{flush,destroy:finish,setBusy(value){busy=value;paint();},busy:()=>busy||Boolean(view?.busy?.()),select,hasPendingChanges:()=>dirty||Boolean(pending)}:result;
}
