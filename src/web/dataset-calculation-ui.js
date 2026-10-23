import {datasetColumnPageOffset,loadDatasetColumnWindow,datasetProjectionFields} from './dataset-column-picker.js';
import {t} from './i18n/index.js';
import {CALCULATION_OPERATIONS,CALCULATION_COMPARISONS,validCalculation} from './dataset-calculation-model.js';
import {CONSTANT_REPRESENTATIONS} from './calculation-operands.js';
import {resultFormatControls,readResultFormat,wireResultFormats} from './measurement-output-ui.js';
import {analysisReferenceField,wireAnalysisFields,assertAnalysisFieldsReady} from './analysis-fields-ui.js';
export const calculationText=(key,args)=>t('datasetCalculations',key,args);
export function datasetCalculationUI({state,api,call,frame,esc,field,guard,owner,inspect,watchJob,notify}){
 const text=calculationText;
 let draft=null,title='',identity=null,source=null,columns=[],joinColumns=[],sourcePage=null,joinPages=[],dispose=null,generation=0,saving=false;
 const button=(key,action,data='')=>`<button type="button" class="button" data-action="material-calculation-${action}" ${data}>${esc(text(key))}</button>`;
 const select=(key,value,choices)=>field(esc(text(key)),`<select data-calc="${key}">${choices.map(([v,label])=>`<option value="${esc(v)}"${String(v)===String(value)?' selected':''}>${esc(label)}</option>`).join('')}</select>`);
 const input=(key,value='',max=300)=>field(esc(text(key)),`<input data-calc="${key}" maxlength="${max}" value="${esc(value)}">`);
 const get=(root,key)=>root.querySelector('[data-calc="'+key+'"]').value;
 const reference=(key,value,label,kind=null)=>analysisReferenceField(key,value,{esc,kind}).replace(/<legend>.*?<\/legend>/,'<legend>'+esc(text(label))+'</legend>');
 const ref=(root,key)=>JSON.parse(root.querySelector('[data-analysis-ref="'+key+'"] [data-ref-value]').value);
 const labels=cols=>cols.map((c,i)=>[i,(i+1)+'. '+c.name+(c.unit?' ['+c.unit+']':'')]);
 const operand=(key,value,cols)=>{
  const representation=value?.constant!==undefined?(value.representation??'automatic'):'decimal';
  return `<fieldset data-operand="${key}"><legend>${esc(text(key))}</legend>${select('operand',value?.column??'constant',[...labels(cols),['constant',text('constant')]])}<div data-constant${value?.column!==undefined?' hidden':''}>${input('constantValue',value?.constant??'',8192)}${select('constantRepresentation',representation,['automatic',...CONSTANT_REPRESENTATIONS].map(v=>[v,text('constant-'+v)]))}<div data-constant-radix${['radix','radix-fraction'].includes(representation)?'':' hidden'}>${field(esc(text('constantRadix')),`<input data-calc="constantRadix" type="number" min="2" max="36" step="1" value="${value?.radix??10}">`)}</div>${input('constantUnit',value?.unit??'',100)}</div></fieldset>`;
 };
 const readOperand=(root,key)=>{
  const el=root.querySelector('[data-operand="'+key+'"]'),v=get(el,'operand');if(v!=='constant')return {column:Number(v)};
  const representation=get(el,'constantRepresentation');return {constant:get(el,'constantValue'),unit:get(el,'constantUnit'),...(representation==='automatic'?{}:{representation,radix:['radix','radix-fraction'].includes(representation)?Number(get(el,'constantRadix')):10})};
 };
 const blankCondition=()=>({left:{column:0},operator:'eq',right:{constant:'',unit:''}});
 const condition=(key,value,cols,optional=true)=>`<fieldset data-condition="${key}"><legend>${esc(text(key))}</legend>${optional?`<label><input data-condition-enabled type="checkbox"${value?' checked':''}> ${esc(text(key))}</label>`:''}<div data-condition-fields${optional&&!value?' hidden':''}>${operand('left',value?.left,cols)}${select('condition',value?.operator??'eq',CALCULATION_COMPARISONS.map(v=>[v,text(v)]))}${operand('right',value?.right,cols)}</div></fieldset>`;
 const readCondition=(root,key)=>{const el=root.querySelector('[data-condition="'+key+'"]');if(el.querySelector('[data-condition-enabled]')?.checked===false)return null;return {left:readOperand(el,'left'),right:readOperand(el,'right'),operator:get(el,'condition')};};
 function clean(){generation++;dispose?.();dispose=null;}
 async function load(){
  const request=++generation;
  const read=async(ref,view,selection,offset=0)=>{
   if(!ref)return {columns:[],projection:selection,page:null};
   if(draft.version===1)return {columns:(await call('calculation-schema',{ref,view})).columns};
   let page=await loadDatasetColumnWindow(call,ref,{view,offset,selected:selection??[]});
   const projection=selection??(page.total<=256?Array.from({length:page.total},(_,i)=>i):[]);
   if(selection===undefined&&projection.length>page.items.length)page=await loadDatasetColumnWindow(call,ref,{view,offset,selected:projection});
   return {columns:projection.map(i=>page.items.find(v=>v.index===i).column),projection,page};
  };
  const next=await read(draft.source,draft.view,draft.projection,sourcePage?.offset??0),joins=[];
  for(const [i,j] of draft.joins.entries())joins.push(await read(j.dataset,undefined,j.projection,joinPages[i]?.offset??0));
  guard();if(request!==generation)return false;columns=next.columns;joinColumns=joins.map(v=>v.columns);sourcePage=next.page;joinPages=joins.map(v=>v.page);
  if(draft.version===2){draft.projection=next.projection;draft.joins.forEach((j,i)=>{j.projection=joins[i].projection;});}return true;
 }
 function capture(){
  const root=document.querySelector('[data-calculation-form]');if(!root)return;
  title=get(root,'title');draft.source=ref(root,'calculation.reference');draft.view=get(root,'view');draft.calibration=ref(root,'calibration');draft.note=get(root,'note');draft.selectionReason=get(root,'selectionReason');draft.where=readCondition(root,'where');
  draft.joins=[...root.querySelectorAll('[data-calc-join]')].map((el,i)=>({...(draft.version===2?{projection:draft.joins[i].projection}:{}),dataset:ref(el,'join'+i+'.dataset'),unmatched:get(el,'unmatched'),where:readCondition(el,'joinWhere'),keys:[...el.querySelectorAll('[data-calc-key]')].map(k=>({left:Number(get(k,'leftKey')),right:Number(get(k,'rightKey')),semantics:get(k,'keySemantics')}))}));
  draft.steps=[...root.querySelectorAll('[data-calc-step]')].map(el=>{const operation=get(el,'operation');return {name:get(el,'name'),unit:get(el,'unit'),operation,...readResultFormat(el),left:readOperand(el,'left'),right:operation==='copy'?null:readOperand(el,'right'),condition:operation==='choose'?readCondition(el,'condition'):null};});
 }
 function form(){
  clean();let available=[...columns];
  const joins=draft.joins.map((j,i)=>{const right=joinColumns[i]??[],html=`<fieldset data-calc-join="${i}"><legend>${esc(text('join'))} ${i+1}</legend>${reference('join'+i+'.dataset',j.dataset,'join','dataset')}${draft.version===2?datasetProjectionFields(joinPages[i],j.projection??[],{esc,scope:String(i)}):''}${j.keys.map((k,n)=>`<div data-calc-key class="material-fields">${select('leftKey',k.left,labels(available))}${select('rightKey',k.right,labels(right))}${select('keySemantics',k.semantics??'lexical',['lexical','numeric'].map(v=>[v,text('key-'+v)]))}${button('removeKey','key-remove',`data-index="${i}" data-key="${n}"`)}</div>`).join('')}${button('addKey','key-add',`data-index="${i}"`)}${condition('joinWhere',j.where,right)}${select('unmatched',j.unmatched,['error','keep'].map(v=>[v,text(v)]))}${button('removeJoin','join-remove',`data-index="${i}"`)}</fieldset>`;available.push(...right);return html;}).join('');
  const selection=condition('where',draft.where,available);
  const steps=draft.steps.map((s,i)=>{const html=`<fieldset data-calc-step="${i}"><legend>${i+1}. ${esc(s.name||text('operation'))}</legend><div class="material-fields">${input('name',s.name,200)}${input('unit',s.unit,100)}${select('operation',s.operation,CALCULATION_OPERATIONS.map(v=>[v,text(v)]))}</div>${resultFormatControls(s.output,{esc,field})}${operand('left',s.left,available)}<div data-second${s.operation==='copy'?' hidden':''}>${operand('right',s.right,available)}</div><div data-choice${s.operation!=='choose'?' hidden':''}>${condition('condition',s.condition,available,false)}</div>${button('removeStep','step-remove',`data-index="${i}"`)}</fieldset>`;available.push({name:s.name,unit:s.unit});return html;}).join('');
  frame(text('open'),`<div data-calculation-form><p>${esc(text('help'))}</p>${input('title',title)}${reference('calculation.reference',draft.source,'source')}${draft.version===2?datasetProjectionFields(sourcePage,draft.projection??[],{esc,scope:'source'}):''}<div${draft.source?.kind!=='analysis'?' hidden':''}>${select('view',draft.view,['observations','distribution','transitions'].map(v=>[v,text(v)]))}</div><details${draft.joins.length?' open':''}><summary>${esc(text('joins'))}</summary><p>${esc(text('joinHelp'))}</p>${joins}${button('addJoin','join-add')}</details>${selection}${input('selectionReason',draft.selectionReason,1000)}<p>${esc(text('whereHelp'))}</p><h3>${esc(text('steps'))}</h3><p>${esc(text('exactHelp'))}</p>${steps}${button('addStep','step-add')}${reference('calibration',draft.calibration,'calibration')}${field(esc(text('note')),`<textarea data-calc="note" maxlength="10000">${esc(draft.note)}</textarea>`)}<div data-calculation-preview role="status"></div></div>`,button('preview','preview')+button('save','save')+button('cancel','cancel'));
  const root=document.querySelector('[data-calculation-form]');
  wireResultFormats(root);
  const refresh=async()=>{if(await load())form();};
  for(const control of root.querySelectorAll('[data-column-window]'))control.onclick=async()=>{if(saving)return;control.disabled=true;try{capture();const scope=control.dataset.columnWindow,page=scope==='source'?sourcePage:joinPages[Number(scope)];page.offset=datasetColumnPageOffset(control);await refresh();}catch(error){notify(error.message,true);}finally{if(control.isConnected)control.disabled=false;}};
  for(const control of root.querySelectorAll('[data-projection-column]'))control.onchange=async()=>{
   if(saving)return;control.disabled=true;const checked=control.checked;let changedTarget=null,previousProjection;
   try{capture();const scope=control.closest('[data-column-projection]').dataset.columnProjection,index=Number(control.dataset.projectionColumn),join=scope==='source'?null:Number(scope),target=join===null?draft:draft.joins[join];
    // Appending a column preserves existing positions. Removing a referenced
    // input requires removing dependent rules first, as with join removal.
    const dependent=draft.steps.length||draft.where||(join===null?draft.joins.length:draft.joins.length>join+1||!checked&&(target.where||target.keys.length));
    if(dependent)throw Error(text('removeLast'));
    if(checked&&columns.length+joinColumns.reduce((n,c)=>n+c.length,0)+draft.steps.length>=256)throw Error(text('invalid'));
    changedTarget=target;previousProjection=target.projection;target.projection=checked?[...target.projection,index]:target.projection.filter(i=>i!==index);await refresh();
   }catch(error){if(changedTarget)changedTarget.projection=previousProjection;if(control.isConnected)control.checked=!checked;notify(error.message,true);}finally{if(control.isConnected)control.disabled=false;}
  };

  dispose=wireAnalysisFields(root,{state,api,call,esc,field,guard,recordId:owner(),onReference:async()=>{capture();if(draft.source&&await load())form();}});
  root.querySelectorAll('[data-calc="operand"]').forEach(el=>el.onchange=()=>el.closest('[data-operand]').querySelector('[data-constant]').hidden=el.value!=='constant');
  root.querySelectorAll('[data-calc="constantRepresentation"]').forEach(el=>el.onchange=()=>el.closest('[data-operand]').querySelector('[data-constant-radix]').hidden=!['radix','radix-fraction'].includes(el.value));
  root.querySelectorAll('[data-condition-enabled]').forEach(el=>el.onchange=()=>el.closest('[data-condition]').querySelector('[data-condition-fields]').hidden=!el.checked);
  root.querySelectorAll('[data-calc="operation"]').forEach(el=>el.onchange=()=>{const step=el.closest('[data-calc-step]');step.querySelector('[data-second]').hidden=el.value==='copy';step.querySelector('[data-choice]').hidden=el.value!=='choose';});
  root.querySelector('[data-calc="view"]').onchange=()=>{capture();void load().then(ok=>{if(ok)form();}).catch(e=>notify(e.message,true));};
 }
 async function open(ref,repeat=false){
  clean();sourcePage=null;joinPages=[];source=ref;const doc=await call('read',{ref});guard();draft=repeat?structuredClone(doc.content.calculation):{version:2,projection:undefined,source:ref,view:'observations',joins:[],steps:[],where:null,selectionReason:'',calibration:null,note:''};
  title=repeat?doc.title:text('open');identity={id:repeat?ref.id:crypto.randomUUID(),expectedRevision:repeat?ref.revision:null,jobId:crypto.randomUUID()};if(await load())form();
 }
 async function action(act,control){
  if(!act.startsWith('calculation-'))return false;guard();if(saving)return true;const key=act.slice(12);
  if(key==='open'||key==='repeat'){await open(JSON.parse(control.dataset.ref),key==='repeat');return true;}
  if(key==='cancel'){clean();await inspect(source);return true;}
  assertAnalysisFieldsReady(document.querySelector('[data-calculation-form]'));capture();const i=Number(control.dataset.index);
  if(key==='join-add'){if(draft.steps.length)throw Error(text('removeLast'));if(draft.joins.length>=4)throw Error(text('invalid'));draft.joins.push({dataset:null,keys:[{left:0,right:0}],where:null,unmatched:'error'});joinColumns.push([]);}
  if(key==='join-remove'){if(draft.steps.length||i!==draft.joins.length-1||draft.where)throw Error(text('removeLast'));draft.joins.splice(i,1);joinColumns.splice(i,1);joinPages.splice(i,1);}
  if(key==='key-add'){if(draft.joins[i].keys.length>=8)throw Error(text('invalid'));draft.joins[i].keys.push({left:0,right:0});}
  if(key==='key-remove')draft.joins[i].keys.splice(Number(control.dataset.key),1);
  if(key==='step-add'){if(draft.steps.length>=64)throw Error(text('invalid'));draft.steps.push({name:'',unit:'',operation:'copy',left:{column:0},right:null,condition:null});}
  if(key==='step-remove'){if(i!==draft.steps.length-1)throw Error(text('removeLast'));draft.steps.splice(i,1);}
  if(key==='preview'||key==='save'){
   if(!validCalculation(draft)||!title.trim())throw Error(text('invalid'));const command={recordId:owner(),title,...identity,calculation:draft};saving=true;control.disabled=true;
   try{if(key==='preview'){const data=await call('dataset-preview',command);guard();document.querySelector('[data-calculation-preview]').innerHTML='<p>'+esc(text('previewNote'))+'</p><div class="material-table"><table><thead><tr>'+data.columns.map(c=>'<th>'+esc(c)+'</th>').join('')+'<th>'+esc(text('exclusion'))+'</th></tr></thead><tbody>'+data.rows.map(r=>'<tr>'+r.cells.map((v,i)=>'<td>'+esc(r.valueKinds[i]==='absent'?'∅':v)+'</td>').join('')+'<td>'+esc(r.excluded??'')+'</td></tr>').join('')+'</tbody></table></div>';}
   else{const data=await call('dataset',command);guard();clean();await watchJob(data.job);}}
   finally{saving=false;if(control.isConnected)control.disabled=false;}return true;
  }
  form();return true;
 }
 return {action,clean,isBusy:()=>saving};
}
