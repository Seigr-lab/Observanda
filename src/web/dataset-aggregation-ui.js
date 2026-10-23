import {isScalarRepresentation} from './measurement-model.js';
import {domainDescription} from './measurement-domain-ui.js';
import {datasetColumnPageOffset,loadDatasetColumnWindow,datasetColumnPager} from './dataset-column-picker.js';
import {t} from './i18n/index.js';
import {AGGREGATION_OPERATIONS,validAggregation} from './dataset-aggregation-model.js';
import {resultFormatControls,readResultFormat,wireResultFormats} from './measurement-output-ui.js';
import {analysisReferenceField,wireAnalysisFields,assertAnalysisFieldsReady} from './analysis-fields-ui.js';
export const aggregationText=(key,args)=>t('datasetAggregation',key,args);
export function datasetAggregationUI({state,api,call,frame,esc,field,guard,owner,inspect,watchJob,notify}){
 const text=aggregationText;let draft,title,source,identity,columns=[],columnPage=null,dispose,generation=0,saving=false;
 const button=(key,action,data='')=>'<button type="button" class="button" data-action="material-aggregation-'+action+'" '+data+'>'+esc(text(key))+'</button>';
 const select=(key,value,items)=>field(esc(text(key)),'<select data-aggregate="'+key+'">'+items.map(([v,name])=>'<option value="'+esc(v)+'"'+(String(v)===String(value)?' selected':'')+'>'+esc(name)+'</option>').join('')+'</select>');
 const input=(key,value,max)=>field(esc(text(key)),'<input data-aggregate="'+key+'" maxlength="'+max+'" value="'+esc(value)+'">');
 const get=(root,key)=>root.querySelector('[data-aggregate="'+key+'"]').value;
 function clean(){generation++;dispose?.();dispose=null;}
 async function load(offset=0){const request=++generation,data=await loadDatasetColumnWindow(call,draft.source,{offset,selected:[...draft.keys,...draft.values.map(v=>v.column)]});guard();if(request!==generation)return false;columnPage=data;columns=data.items;return true;}
 function capture(){const root=document.querySelector('[data-aggregation-form]');if(!root)return;title=get(root,'title');draft.source=JSON.parse(root.querySelector('[data-ref-value]').value);const checked=[...root.querySelectorAll('[data-group-key]:checked')].map(el=>Number(el.dataset.groupKey));draft.keys=[...draft.keys.filter(i=>checked.includes(i)),...checked.filter(i=>!draft.keys.includes(i))];draft.keySemantics=draft.keys.map(i=>root.querySelector('[data-key-semantics="'+i+'"]').value);draft.values=[...root.querySelectorAll('[data-aggregate-value]')].map(el=>({column:Number(get(el,'column')),name:get(el,'name'),operation:get(el,'operation'),...readResultFormat(el)}));draft.missing=get(root,'missing');draft.note=get(root,'note');}
 function keyControl({column,index}){
  const selected=draft.keys.includes(index),semantics=draft.keySemantics?.[draft.keys.indexOf(index)]??(column.representation==='domain'?'domain':'lexical');
  return '<div data-key-row><label class="checkbox"><input type="checkbox" data-group-key="'+index+'"'+(selected?' checked':'')+'>'+esc(column.name)+'</label><div data-key-options'+(selected?'':' hidden')+'>'+field(esc(text('keySemantics',{name:column.name})),'<select data-key-semantics="'+index+'">'+(draft.version===2?['lexical','numeric','domain']:['lexical','numeric']).map(value=>'<option value="'+value+'"'+(semantics===value?' selected':'')+(value==='numeric'&&!isScalarRepresentation(column)||value==='domain'&&column.representation!=='domain'||value==='lexical'&&column.representation==='domain'?' disabled':'')+'>'+esc(text('key-'+value))+'</option>').join('')+'</select>')+'</div></div>';
 }
 function form(){
  clean();const reference=analysisReferenceField('aggregation.reference',draft.source,{esc,kind:'dataset'}).replace(/<legend>.*?<\/legend>/,'<legend>'+esc(text('source'))+'</legend>');
  frame(text('open'),'<div data-aggregation-form><p>'+esc(text('help'))+'</p>'+input('title',title,300)+reference+'<fieldset><legend>'+esc(text('keys'))+'</legend>'+datasetColumnPager(columnPage,{esc})+columns.map(keyControl).join('')+'<p>'+esc(text('keyHelp'))+'</p></fieldset><h3>'+esc(text('values'))+'</h3>'+draft.values.map((v,i)=>'<fieldset data-aggregate-value="'+i+'"><legend>'+esc(text('operation'))+' '+(i+1)+'</legend>'+select('column',v.column,columns.map(({column:c,index:i})=>[i,(i+1)+'. '+c.name+(c.unit?' ['+c.unit+']':'')]))+input('name',v.name,200)+select('operation',v.operation,AGGREGATION_OPERATIONS.map(op=>[op,text(op)]))+button('remove','remove','data-index="'+i+'"')+'</fieldset>').join('')+button('add','add')+select('missing',draft.missing,['skip','error'].map(v=>[v,text(v)]))+'<p>'+esc(text('rules'))+'</p>'+field(esc(text('note')),'<textarea data-aggregate="note" maxlength="10000">'+esc(draft.note)+'</textarea>')+'<div data-aggregation-preview role="status"></div></div>',button('preview','preview')+button('save','save')+button('cancel','cancel'));
  const root=document.querySelector('[data-aggregation-form]');
  for(const [index,value] of draft.values.entries())root.querySelector('[data-aggregate-value="'+index+'"] [data-aggregate="operation"]').closest('.field').insertAdjacentHTML('afterend',resultFormatControls(value.output,{esc,field}));
  wireResultFormats(root);
  for(const control of root.querySelectorAll('[data-column-window]'))control.onclick=async()=>{if(saving)return;control.disabled=true;try{capture();if(await load(datasetColumnPageOffset(control)))form();}catch(error){notify(error.message,true);}finally{if(control.isConnected)control.disabled=false;}};
  document.querySelectorAll('[data-group-key]').forEach(el=>el.onchange=()=>el.closest('[data-key-row]').querySelector('[data-key-options]').hidden=!el.checked);
  dispose=wireAnalysisFields(document.querySelector('[data-aggregation-form]'),{state,api,call,esc,field,guard,recordId:owner(),onReference:async()=>{capture();if(draft.source&&await load())form();}});
 }
 async function action(act,control){
  if(!act.startsWith('aggregation-'))return false;guard();if(saving)return true;const key=act.slice(12);
  if(key==='open'||key==='repeat'){
   clean();source=JSON.parse(control.dataset.ref);const doc=await call('read',{ref:source});guard();draft=key==='repeat'?structuredClone(doc.content.aggregation):{version:2,source,keys:[],values:[],missing:'skip',note:''};title=key==='repeat'?doc.title:text('open');identity={id:key==='repeat'?source.id:crypto.randomUUID(),expectedRevision:key==='repeat'?source.revision:null,jobId:crypto.randomUUID()};if(await load())form();return true;
  }
  if(key==='cancel'){clean();await inspect(source);return true;}
  assertAnalysisFieldsReady(document.querySelector('[data-aggregation-form]'));capture();
  if(key==='add'){if(draft.values.length>=32)throw Error(text('invalid'));draft.values.push({column:columnPage?.offset??0,name:'',operation:'median'});}
  if(key==='remove')draft.values.splice(Number(control.dataset.index),1);
  if(key==='preview'||key==='save'){
   if(!validAggregation(draft,columnPage?.total??0)||!title.trim())throw Error(text('invalid'));const command={recordId:owner(),title,...identity,aggregation:draft};saving=true;control.disabled=true;
   try{if(key==='preview'){const data=await call('dataset-preview',command);guard();document.querySelector('[data-aggregation-preview]').innerHTML='<p>'+esc(text('previewNote'))+'</p><div class="material-table"><table><thead><tr>'+data.columns.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+data.rows.map(r=>'<tr>'+r.cells.map((v,i)=>'<td>'+esc(r.valueKinds[i]==='absent'?'∅':v?.format==='domain-value'?domainDescription(v.definition):v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
   else{const data=await call('dataset',command);guard();clean();await watchJob(data.job);}}finally{saving=false;if(control.isConnected)control.disabled=false;}return true;
  }
  form();return true;
 }
 return {action,clean,isBusy:()=>saving};
}
export function aggregationInspection(data,{esc,sourceButton}){
 const text=aggregationText,a=data.aggregation;
 const button=key=>'<button type="button" class="button" data-action="material-measurement-'+key+'">'+esc(text(key))+'</button>';
 return '<section data-aggregation-sources><h3>'+esc(text('sources'))+'</h3><p>'+esc(text(a.operation))+' · '+esc(a.source.revision.slice(0,12))+'</p><p>'+esc(text('provenance'))+'</p>'+(a.note?'<p>'+esc(a.note)+'</p>':'')+(a.counts?'<dl>'+['total','included','excluded','missing'].map(k=>'<dt>'+esc(text(k==='missing'?'missingValue':k))+'</dt><dd>'+a.counts[k]+'</dd>').join('')+'</dl>':'')+'<div class="material-table"><table><thead><tr><th>'+esc(text('reading'))+'</th><th>'+esc(text('status'))+'</th><th>'+esc(text('inspect'))+'</th></tr></thead><tbody>'+a.members.map(item=>'<tr><td>'+esc(item.presence==='value'?(item.value?.format==='domain-value'?domainDescription(item.value.definition):item.value):text(item.presence==='missing'?'missingValue':item.presence))+'</td><td>'+esc(text(item.status==='missing'?'missingValue':item.status))+(item.reason?' · '+esc(item.reason):'')+'</td><td>'+sourceButton(item.source)+'</td></tr>').join('')+'</tbody></table></div>'+(a.previous!==null?button('previous','previous'):'')+(a.next!==null?button('next','next'):'')+'</section>';
}
