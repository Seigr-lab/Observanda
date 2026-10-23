import {t} from './i18n/index.js';
import {researchId} from './research-reference.js';
import {validFigureCopySource} from './record-figure-copy-model.js';
import {figureIssues} from './figure-model.js';
import {sameJSONData} from './json-data-equality.js';

export function recordFigureCopyPicker({state,api,esc,context,selectionOnly=false}){
 const text=(key,args)=>t('recordValues',key,args),dialog=document.createElement('dialog');dialog.className='record-reference-picker';dialog.setAttribute('aria-labelledby','figure-copy-title');document.body.append(dialog);
 let owner=null,page=null,source=null,topOffset=0,controller=null,pending=null,busy=false,error='',resolve=null,trigger=null;
 const active=()=>owner&&owner.context===context()&&owner.workspaceId===state.book?.id&&!state.access?.locked&&dialog.open;
 function close(value=null){controller?.abort();controller=null;owner=null;page=null;source=null;topOffset=0;pending=null;busy=false;error='';dialog.close();dialog.innerHTML='';const complete=resolve;resolve=null;if(trigger?.isConnected)trigger.focus();complete?.(value);}
 const button=(key,action,disabled=false)=>'<button type="button" class="button" data-figure-copy="'+action+'"'+(disabled?' disabled':'')+'>'+esc(text(key))+'</button>';
 function paint(){
  if(!active())return;
  dialog.innerHTML='<h2 id="figure-copy-title">'+esc(text('copyPlotTitle'))+'</h2><p>'+esc(text('copyPlotHelp'))+'</p>'+(page?.figureId?button('copyPlotBack','back',busy):'')+'<p role="status">'+esc(busy?text('copyPlotLoading'):page?.total?text(page.figureId?'copyPanelRange':'resultFigureRange',{first:page.offset+1,last:Math.min(page.offset+4,page.total),total:page.total}):text('resultNoFigures'))+'</p>'+
   '<div class="result-figure-choices">'+(page?.items??[]).map((item,index)=>'<button type="button" class="button" data-figure-copy="choose" data-index="'+index+'"'+(busy?' disabled':'')+'>'+esc(item.title||text('figure'))+'</button>').join('')+'</div><div class="inline-actions">'+button('resultPreviousFigures','previous',busy||!page?.offset)+button('resultNextFigures','next',busy||page?.nextOffset==null)+'</div>'+
   '<label>'+esc(text(page?.figureId?'copyPanelPosition':'copyPlotPosition'))+'<input type="number" data-copy-position min="1"'+(page?.total?' max="'+page.total+'"':'')+' value="'+(page?.offset+1||1)+'" required'+(busy||!page?.total?' disabled':'')+'></label>'+button('copyPlotGo','go',busy||!page?.total)+
   '<p role="alert">'+esc(error)+'</p><div class="dialog-actions">'+(error&&pending?button('copyPlotRetry','retry',busy):'')+button('close','close')+'</div>';
 }
 function pageValid(result,command){
  const level=command.figureId??null;
  return result?.workspaceId===owner.workspaceId&&result.recordId===owner.recordId&&result.figureId===level&&validFigureCopySource(result.source)&&result.source.id===owner.recordId&&result.source.workspaceId===owner.workspaceId&&(!command.source||sameJSONData(result.source,command.source))&&Number.isSafeInteger(result.total)&&result.total>=0&&(!page||page.figureId!==level||page.total===result.total)&&result.offset===Math.min(command.offset,Math.max(0,result.total-1))&&result.nextOffset===(result.offset+4<result.total?result.offset+4:null)&&Array.isArray(result.items)&&result.items.length===Math.min(4,result.total-result.offset)&&new Set(result.items.map(item=>item?.figureId+':'+item?.plotId)).size===result.items.length&&result.items.every(item=>researchId(item?.figureId)&&typeof item.title==='string'&&(item.type==='panels'&&level===null&&item.plotId===null||item.type==='plot'&&researchId(item.plotId)&&(level===null?item.plotId===item.figureId:item.figureId===level)));
 }
 async function request(task){
  controller?.abort();const operation=new AbortController();controller=operation;pending=task;busy=true;error='';paint();
  try{
   const result=await api('/api/research/records/values/figure-copy-'+task.kind,task.command,{adopt:false,signal:operation.signal});
   if(controller!==operation||!active())return;
   if(task.kind==='choices'){
    if(!pageValid(result,task.command))throw Error(text('copyPlotInvalid'));page=result;source=result.source;pending=null;if(page.figureId===null)topOffset=page.offset;
   }else{
    if(Object.entries(task.command).some(([key,value])=>!sameJSONData(result?.[key],value))||result.figure?.id!==task.command.plotId||result.figure.kind==='panels'||figureIssues(result.figure,{draft:true}).length||!Number.isSafeInteger(result.statementCount)||result.statementCount<0)throw Error(text('copyPlotInvalid'));
    close(result);return;
   }
  }catch(failure){if(controller===operation&&active()&&!operation.signal.aborted)error=failure.message||text('copyPlotFailed');}
  finally{if(controller===operation){controller=null;busy=false;paint();}}
 }
 function load(offset,figureId=page?.figureId??null){return request({kind:'choices',command:{workspaceId:owner.workspaceId,recordId:owner.recordId,source,offset,...(figureId?{figureId}:{})}});}
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('click',event=>{
  const control=event.target.closest('[data-figure-copy]');if(!control)return;event.stopPropagation();event.preventDefault();if(control.disabled)return;
  const action=control.dataset.figureCopy;if(action==='close'){close();return;}if(!active()||busy)return;
  if(action==='retry'&&pending){void request(pending);return;}
  if(action==='back'){void load(topOffset,null);return;}
  if(action==='previous'||action==='next'){void load(action==='next'?page.nextOffset:Math.max(0,page.offset-4));return;}
  if(action==='go'){const input=dialog.querySelector('[data-copy-position]');if(input.reportValidity())void load(Number(input.value)-1);return;}
  if(action==='choose'){const chosen=page?.items[Number(control.dataset.index)];if(!chosen)return;if(chosen.type==='panels'){void load(0,chosen.figureId);return;}
   const command={workspaceId:owner.workspaceId,recordId:owner.recordId,source:page.source,figureId:chosen.figureId,plotId:chosen.plotId};
   if(selectionOnly)close(command);else void request({kind:'source',command});
  }
 });
 return {open(base){close();trigger=document.activeElement;owner={context:context(),workspaceId:base.workspaceId,recordId:base.recordId};dialog.showModal();const result=new Promise(done=>resolve=done);void load(0);return result;},close,busy:()=>Boolean(owner),destroy(){close();dialog.remove();}};
}
