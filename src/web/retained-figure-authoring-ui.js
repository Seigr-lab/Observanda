import {retainedFigureEditor} from './retained-figure-editor.js';
import {recordFigureCopyPicker} from './record-figure-copy-picker.js';
import {materialSourcePicker} from './material-source-picker.js';
import {researchOwner} from './project-context.js';
import {escapeFigureText as esc} from './retained-figure-text.js';
import {t} from './i18n/index.js';
const text=key=>t('retainedFigureEditor',key);
const field=(label,control)=>'<label class="field">'+label+control+'</label>';
// The selected-value lifecycle owns the checkpoint and replay receipt. This view
// holds only a selected member, a bounded text range and a material source page.
export function retainedFigureAuthoringUI({root,state,api,base,value,lifecycle,changed}){
 const token=lifecycle.context(),owner=researchOwner(state);let disposed=false,editor=null,picker=null,copyPicker=null,active=null,pickerBusy=false,errorShown=false;
 root.innerHTML='<div data-authored-editor></div><button type="button" class="button" data-authored-copy>'+esc(text('copySavedPlot'))+'</button><details data-authored-import><summary>'+esc(text('importTitle'))+'</summary><p>'+esc(text('importHelp'))+'</p><div data-authored-source><input type="hidden" data-value value=""></div>'+field(esc(text('importMode')),'<select data-authored-mode><option value="replace">'+esc(text('importReplace'))+'</option><option value="append">'+esc(text('importAppend'))+'</option><option value="panel">'+esc(text('importPanel'))+'</option></select>')+'<button type="button" class="button" data-authored-apply>'+esc(text('importApply'))+'</button></details><p data-authored-status role="status"></p>';
 const guard=()=>{if(disposed||lifecycle.context()!==token||!root.isConnected)throw new DOMException('Figure editor closed','AbortError');};
 const report=error=>{if(!disposed&&error.name!=='AbortError'){errorShown=true;root.querySelector('[data-authored-status]').textContent=error.message;}};
 const callChange=(action,body,options,withinQueue)=>withinQueue?withinQueue(action,body,options):lifecycle.draftChange(action,body,{...options,checkpoint:false});
 async function mutate(operation,options,withinQueue){
  guard();if(value.value.document.format!=='figure-authoring')await callChange('start',{create:null},{signal:options.signal},withinQueue);
  guard();return callChange('change',{operation},options,withinQueue);
 }
 function mount(){
  editor?.release();guard();editor=retainedFigureEditor({root:root.querySelector('[data-authored-editor]'),figure:value.value,context:lifecycle.context,busyChanged:lifecycle.refresh,notifyPending:pending=>{if(pending)changed();},adopt:()=>{},
   authoring:{revision:()=>lifecycle.draftState().revision,figure:()=>value.value,read:lifecycle.draftRead,change:mutate,finish:(options,withinQueue)=>callChange('finish',{},options,withinQueue)}});
  return editor.ready;
 }
 const disclosure=root.querySelector('[data-authored-import]');
 disclosure.addEventListener('toggle',()=>{if(!disclosure.open||picker||disposed)return;
  picker=materialSourcePicker({root:root.querySelector('[data-authored-source]'),call:async(name,body,options)=>{guard();const result=await api('/api/research/materials/'+name,body,{...options,owner,adopt:false});guard();return name==='list'?{...result,items:result.items.filter(item=>item.hasFigure)}:result;},esc,field,label:text('importSource'),id:'authored-figure-source-'+base.recordId,recordId:base.recordId,kind:'analysis',guard,onBusy:busy=>{pickerBusy=busy;lifecycle.refresh();}});
 });
 const click=event=>{const node=event.target.closest('[data-authored-apply],[data-authored-copy]');if(!node||active||disposed)return;event.preventDefault();event.stopPropagation();
  active=(async()=>{guard();let source,mode;if(node.hasAttribute('data-authored-copy')){copyPicker??=recordFigureCopyPicker({state,api,esc,context:lifecycle.context,selectionOnly:true});const selected=await copyPicker.open(base);guard();if(!selected)return;source={ref:selected.source,figureId:selected.figureId,plotId:selected.plotId};mode=editor.selection().kind==='panels'?'panel':'replace';}else{await picker?.ready;source=picker?.values()[0];if(!source)throw Error(text('importRequired'));mode=root.querySelector('[data-authored-mode]').value;}
   await editor.checkpoint();guard();const body={source,mode,plotId:editor.selection().plotId??value.value.id};
   if(value.value.document.format!=='figure-authoring')await lifecycle.draftChange('start',{create:null});
   await lifecycle.draftChange('import',body);guard();await mount();errorShown=false;root.querySelector('[data-authored-status]').textContent=text('imported');
  })();node.disabled=true;lifecycle.refresh();active.catch(report).finally(()=>{active=null;if(!disposed){node.disabled=false;lifecycle.refresh();}});
 };
 root.addEventListener('click',click);const ready=mount();
 return {ready,isBusy:()=>!!active||pickerBusy||editor.isBusy(),async checkpoint(options){await editor.checkpoint(options);guard();if(errorShown){errorShown=false;root.querySelector('[data-authored-status]').textContent='';}},
  async validate(){try{await editor.checkpoint();guard();if(value.value.document.format==='figure-authoring'){await lifecycle.draftChange('finish',{});guard();await mount();}return true;}catch(error){report(error);return false;}},
  release(){disposed=true;editor?.release();picker?.dispose();copyPicker?.destroy();root.removeEventListener('click',click);}
 };
}
