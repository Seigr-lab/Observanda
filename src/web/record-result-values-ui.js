import {researchId} from './research-reference.js';
import {resultValueId} from './record-result-value.js';
import {RESULT_KINDS,validResultStatement,resultStatementsView} from './result-statements.js';
import {retainedTableUI} from './retained-table-ui.js';
import {analysisReferenceField,wireAnalysisFields,assertAnalysisFieldsReady,atext as a} from './analysis-fields-ui.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('recordValues',key,args);
export function recordResultControls(record,esc,reference){
 return '<div class="record-result-values"><button type="button" class="button" data-action="record-value-add-result">'+esc(a('addResult'))+'</button>'+resultStatementsView(record.results,esc,{reference,edit:s=>'<button type="button" class="button" data-action="record-value-edit" data-value-field="result:'+s.id+'">'+esc(a('editResult'))+'</button>'})+'</div>';
}
export function recordResultView({state,api,esc,field},lifecycle){
 let current=null,dispose=null,table=null,unbind=null,loading=false,choices=null,retained=null,choiceGeneration=0,topOffset=0;
 const valid=s=>s===current&&s.context===lifecycle.context()&&s.dialog?.open&&!state.access?.locked&&state.book?.id===s.base.workspaceId;
 const guard=s=>{if(!valid(s))throw Error(text('changedWorkspace'));};
 const call=(name,data,options)=>api('/api/research/materials/'+name,data,{...options,adopt:false});
 const feedback=(s,error)=>{if(valid(s))s.dialog.querySelector('[data-result-error]').textContent=error.message;};
 function stop(){choiceGeneration++;dispose?.();dispose=null;table?.stop();table=null;unbind?.();unbind=null;loading=false;choices=null;}
 function markup(){
  const s=current,item=s.value.value??retained,removed=s.value.value===null;
  const control=(key,area=false)=>field(esc(a(key==='text'?'statement':key==='title'?'resultTitle':key)),area?'<textarea data-result-value="'+key+'" required maxlength="10000" rows="4">'+esc(item[key])+'</textarea>':'<input data-result-value="'+key+'" required maxlength="300" value="'+esc(item[key])+'">');
  const select=(key,values)=>field(esc(a(key)),'<select data-result-value="'+key+'">'+values.map(v=>'<option value="'+v+'"'+(v===item[key]?' selected':'')+'>'+esc(a(v))+'</option>').join('')+'</select>');
  const figure=item.kind==='figure'?'<fieldset><legend>'+esc(a('figureTarget'))+'</legend><p data-result-target>'+esc(s.target?.id===item.figureId?s.target.title:item.figureId||a('none'))+'</p><button type="button" class="button" data-result-choose-figure>'+esc(text('resultChooseFigure'))+'</button><div data-result-choices></div></fieldset>':'';
  return '<div data-selected-result><p>'+esc(a('resultHelp'))+'</p><fieldset data-result-fields'+(removed?' disabled':'')+'>'+control('title')+select('kind',RESULT_KINDS)+figure+control('text',true)+select('basis',['authored','retained'])+(item.basis==='retained'?analysisReferenceField('resultSource',item.source,{esc,kind:item.kind==='table'?'dataset':'analysis'}):'')+'<div data-result-table></div>'+control('limitations',true)+'</fieldset>'+(s.base.definition.existing?'<label><input type="checkbox" data-result-remove'+(removed?' checked':'')+'> '+esc(text('removeResult'))+'</label><p>'+esc(text('removeResultHelp'))+'</p>':'')+'<p role="alert" data-result-error></p></div>';
 }
 function redraw(){const dialog=current.dialog;stop();dialog.querySelector('[data-writing-fields]').innerHTML=markup();bind(dialog);lifecycle.refresh();}
 async function loadTable(s){
  const item=s.value.value;if(item?.kind!=='table'||item.basis!=='retained')return;
  loading=true;lifecycle.refresh();const active=table;
  try{await active.load(item.source,item.table,item.tableSelection);if(valid(s)&&table===active)lifecycle.refresh();}catch(error){feedback(s,error);}finally{if(valid(s)&&table===active){loading=false;lifecycle.refresh();}}
 }
 async function figurePage(s,offset,figureId=null){
  const generation=++choiceGeneration;loading=true;lifecycle.refresh();
  try{
   const page=await api('/api/research/records/values/figures',{workspaceId:s.base.workspaceId,recordId:s.base.recordId,offset,...(figureId?{figureId}:{})},{adopt:false});guard(s);if(generation!==choiceGeneration)return;
   if(page?.workspaceId!==s.base.workspaceId||page.recordId!==s.base.recordId||page.figureId!==figureId||! /^[a-f0-9]{64}$/.test(page.storageRevision??'')||choices&&choices.storageRevision!==page.storageRevision||!Number.isSafeInteger(page.total)||page.total<0||page.offset!==Math.min(offset,Math.max(0,page.total-1))||page.nextOffset!==(page.offset+4<page.total?page.offset+4:null)||!Array.isArray(page.items)||page.items.length!==Math.min(4,page.total-page.offset)||new Set(page.items.map(item=>item?.id)).size!==page.items.length||!page.items.every(item=>researchId(item?.id)&&typeof item.title==='string'&&typeof item.hasPanels==='boolean'&&(!figureId||!item.hasPanels)))throw Error(text('copyPlotInvalid'));
   choices=page;if(!figureId)topOffset=page.offset;s.dialog.querySelector('[data-result-error]').textContent='';
   s.dialog.querySelector('[data-result-choices]').innerHTML=(figureId?'<button type="button" class="button" data-result-figure-back>'+esc(text('copyPlotBack'))+'</button>':'')+'<p role="status">'+esc(page.total?text(figureId?'copyPanelRange':'resultFigureRange',{first:page.offset+1,last:Math.min(page.offset+4,page.total),total:page.total}):text('resultNoFigures'))+'</p><div class="result-figure-choices">'+page.items.map(f=>'<div class="inline-actions"><button type="button" class="button" data-result-use-figure="'+f.id+'">'+esc(f.title||text('figure'))+'</button>'+(f.hasPanels?'<button type="button" class="button" data-result-figure-panels="'+f.id+'">'+esc(text('resultChoosePanel'))+'</button>':'')+'</div>').join('')+'</div><div class="inline-actions"><button type="button" class="button" data-result-figure-page="'+Math.max(0,page.offset-4)+'"'+(page.offset===0?' disabled':'')+'>'+esc(text('resultPreviousFigures'))+'</button><button type="button" class="button" data-result-figure-page="'+page.nextOffset+'"'+(page.nextOffset===null?' disabled':'')+'>'+esc(text('resultNextFigures'))+'</button><button type="button" class="button" data-result-figure-cancel>'+esc(a('cancel'))+'</button></div>';
  }catch(error){if(generation!==choiceGeneration||!valid(s))return;throw error;}finally{if(valid(s)&&generation===choiceGeneration){loading=false;lifecycle.refresh();}}
 }
 function bind(dialog){
  const s=current;if(!s)return;s.dialog=dialog;const root=dialog.querySelector('[data-selected-result]');
  table=retainedTableUI({root:root.querySelector('[data-result-table]'),call,esc,field,guard:()=>guard(s),notify:message=>feedback(s,Error(message)),onTable:value=>{guard(s);s.value.value.table=value;delete s.value.value.tableSelection;s.changed();}});
  dispose=wireAnalysisFields(root,{state,api,call,esc,field,guard:()=>guard(s),recordId:s.base.recordId,onReference:async(region,value)=>{guard(s);s.value.value.source=value;delete s.value.value.table;delete s.value.value.tableSelection;s.changed();await loadTable(s);}});
  if(s.value.value?.kind==='table'&&s.value.value.basis==='retained')root.querySelector('[data-analysis-ref] legend').textContent=t('retainedTables','source');
  const click=event=>{const button=event.target.closest('[data-result-choose-figure],[data-result-figure-page],[data-result-use-figure],[data-result-figure-cancel],[data-result-figure-panels],[data-result-figure-back]');if(!button||!root.contains(button))return;event.preventDefault();event.stopPropagation();if(loading||button.disabled||button.closest('[inert]'))return;
   if(button.hasAttribute('data-result-figure-cancel')){root.querySelector('[data-result-choices]').replaceChildren();choices=null;return;}
   if(button.hasAttribute('data-result-use-figure')){const chosen=choices?.items.find(f=>f.id===button.dataset.resultUseFigure);if(chosen){s.value.value.figureId=chosen.id;s.target=chosen;s.changed();redraw();}return;}
   const child=button.dataset.resultFigurePanels,back=button.hasAttribute('data-result-figure-back');if(child&&!choices?.items.some(item=>item.id===child&&item.hasPanels))return;
   void figurePage(s,back?topOffset:Number(button.dataset.resultFigurePage??0),back||button.hasAttribute('data-result-choose-figure')?null:child??choices?.figureId??null).catch(error=>feedback(s,error));
  };
  dialog.addEventListener('click',click);unbind=()=>dialog.removeEventListener('click',click);void loadTable(s);
 }
 return {
  initialize(base,value,input,changed){if(value.value===null){value.value={id:resultValueId(base.field),kind:'conclusion',title:'',text:'',basis:'authored',source:null,limitations:''};changed();}},
  fields(base,value,changed){current={base,value,changed,context:lifecycle.context(),dialog:null,target:base.definition.figureTarget};retained=value.value??base.definition.original??{id:resultValueId(base.field),kind:'conclusion',title:'',text:'',basis:'authored',source:null,limitations:''};return markup();},
  bind,busy:()=>loading,
  input(element){
   const s=current;if(!s||!element.closest('[data-selected-result]'))return false;
   if(element.hasAttribute('data-result-remove')){if(element.checked){retained=s.value.value;s.value.value=null;}else s.value.value=structuredClone(retained);redraw();return true;}
   const item=s.value.value;if(!item)return false;
   if(element.hasAttribute('data-ref-value')){item.source=JSON.parse(element.value);return true;}
   if(element.closest('[data-result-table]')){item.tableSelection=table.selected();return true;}
   const key=element.dataset.resultValue;if(!key)return false;
   const old=item[key];item[key]=element.value;
   if(key==='kind'){
    if((old==='table')!==(item.kind==='table')){item.source=null;delete item.table;delete item.tableSelection;}
    if(item.kind==='figure')item.figureId='';else delete item.figureId;redraw();
   }else if(key==='basis'){if(item.basis==='authored'){item.source=null;delete item.table;delete item.tableSelection;}redraw();}
   return true;
  },
  async validate(){
   const s=current;if(!s.value.value)return true;const item=s.value.value;
   try{assertAnalysisFieldsReady(s.dialog);if(item.kind==='table'&&item.basis==='retained'){item.table=await table.read();guard(s);delete item.tableSelection;s.changed();}if(!validResultStatement(item))throw Error(text('resultInvalid'));return true;}catch(error){feedback(s,error);return false;}
  },
  preview:base=>base.value.value?resultStatementsView({version:1,statements:[base.value.value]},esc):'<p>'+esc(text('resultAbsent'))+'</p>',
  release(){stop();current=null;retained=null;}
 };
}
