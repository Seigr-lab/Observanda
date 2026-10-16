import {t} from './i18n/index.js';
export function recordFigureActions({state,api,esc,current,refresh,reveal,render,report}){
 const text=(key,args)=>t('recordValues',key,args),pending=new Map();let saving=false,context=null;
 const owner=reading=>JSON.stringify([state.storage?.contextId,reading.workspaceId,reading.recordId]);
 function checkContext(){const next=state.access?.locked?null:JSON.stringify([state.storage?.contextId,state.book?.id]);if(next!==context){pending.clear();context=next;}}
 const waiting=()=>{checkContext();return current()&&pending.has(owner(current()));};
 const button=(label,action,id='')=>'<button type="button" class="button record-figure-edit" data-action="stored-figure-'+action+'" data-figure="'+esc(id)+'"'+(saving||waiting()&&action!=='retry'?' disabled':'')+'>'+esc(text(label))+'</button>';
 const controls=figure=>button('duplicateFigure','duplicate',figure.id)+button('removeFigure','remove',figure.id);
 const add=()=>'<div class="inline-actions">'+['plot','panels'].map(kind=>'<button type="button" class="button record-figure-edit" data-action="record-value-add-figure" data-kind="'+kind+'"'+(saving||waiting()?' disabled':'')+'>'+esc(text(kind==='plot'?'addFigure':'addFigurePanels'))+'</button>').join('')+(waiting()?'<p role="status">'+esc(text('figurePending'))+'</p>'+button('retryFigure','retry'):'')+'</div>';
 async function execute(reading,command){
  const key=owner(reading),storageContext=state.storage?.contextId,owned=()=>state.page==='record-reader'&&state.storage?.contextId===storageContext&&state.book?.id===command.workspaceId&&state.selected===command.recordId&&!state.access?.locked;
  pending.set(key,command);saving=true;render();
  try{const result=await api('/api/research/records/figures',command,{adopt:false});pending.delete(key);if(owned()){await refresh();if(owned()&&command.action==='duplicate')await reveal(result.position);}}
  catch(error){if(['INVALID','MISSING','FORMAT','WORKSPACE_CHANGED','RECORD_CHANGED','INTAKE_COMPLETION','FIGURE_IN_USE','FIGURE_RESULTS','FIGURE_RESULT_COPY','ANALYSIS_INVALID','MATERIAL_MISSING'].includes(error.code))pending.delete(key);throw error;}
  finally{saving=false;render();}
 }
 async function action(control){
  if(!control.dataset.action?.startsWith('stored-figure-'))return false;
  checkContext();const reading=current();if(!reading||saving)return true;
  const action=control.dataset.action.slice('stored-figure-'.length),key=owner(reading);if(waiting()&&action!=='retry')return true;
  try{
   if(action==='retry'){const command=pending.get(key);if(command)await execute(reading,command);}
   else if(['duplicate','remove'].includes(action)){
    const id=control.dataset.figure;if(![...reading.header.figures,...reading.inline?.figures??[]].some(figure=>figure.id===id))return true;
    saving=true;render();let base;
    try{base=await api('/api/research/records/values/read',{workspaceId:reading.workspaceId,recordId:reading.recordId,field:'figure:'+id},{adopt:false});}
    finally{saving=false;render();}
    if(current()!==reading||!base.value.value)return true;
    if(action==='duplicate'||confirm(text('confirmRemoveFigure',{title:base.value.value.title})))await execute(reading,{workspaceId:reading.workspaceId,recordId:reading.recordId,id:crypto.randomUUID(),figureId:id,action,expectedRevision:base.revision});
   }
  }catch(error){report(error);}return true;
 }
 return {add,controls,action,checkContext};
}
