import {defaultDatasetResourcePolicy} from './dataset-resource-policy.js';
import {MAX_BYTES} from './workspace-limits.js';
import {datasetResourcePolicyControls,readDatasetResourcePolicy} from './dataset-resource-policy-ui.js';
import {isScalarRepresentation} from './measurement-model.js';
import {NUMBER_REPRESENTATIONS,numeralUsesRadix} from './numeral-context.js';
import {scalarSpellingInput,readScalarSpelling,scalarSpellingView,wireScalarFields} from './measurement-scalar-ui.js';
import {domainDescription} from './measurement-domain-ui.js';
import {datasetColumnPageOffset,loadDatasetColumnWindow,datasetColumnPager} from './dataset-column-picker.js';
import {t} from './i18n/index.js';
import {AGGREGATION_OPERATIONS,validAggregation} from './dataset-aggregation-model.js';
import {resultFormatControls,readResultFormat,wireResultFormats} from './measurement-output-ui.js';
import {analysisReferenceField,wireAnalysisFields,assertAnalysisFieldsReady} from './analysis-fields-ui.js';
export const aggregationText=(key,args)=>t('datasetAggregation',key,args);
// Material dataset requests serialize this command directly; owner context is carried outside the body.
export function assertAggregationRequestFits(command){
 const bytes=new TextEncoder().encode(JSON.stringify(command)).byteLength;
 if(bytes>MAX_BYTES)throw Error(aggregationText('requestTooLarge',{bytes,maximum:MAX_BYTES}));
}
const displayedValue=value=>typeof value==='string'?value:value?.format==='domain-value'?domainDescription(value.definition):value?.format==='scalar-preview'?value.text+(value.complete?'':aggregationText('incompleteValue')):value?.format==='dataset-cell'?aggregationText('retainedValue',{count:value.characters}):aggregationText('retainedUnknown');
export function datasetAggregationUI({state,api,call,frame,esc,field,guard,owner,inspect,watchJob,notify}){
 const text=aggregationText;let draft,title,source,identity,columns=[],columnPage=null,probabilityFields=[],dispose,generation=0,saving=false,busyState=null;
 const button=(key,action,data='')=>'<button type="button" class="button" data-action="material-aggregation-'+action+'" '+data+'>'+esc(text(key))+'</button>';
 const select=(key,value,items)=>field(esc(text(key)),'<select data-aggregate="'+key+'">'+items.map(([v,name])=>'<option value="'+esc(v)+'"'+(String(v)===String(value)?' selected':'')+'>'+esc(name)+'</option>').join('')+'</select>');
 const input=(key,value,max)=>field(esc(text(key)),'<input data-aggregate="'+key+'" maxlength="'+max+'" value="'+esc(value)+'">');
 const get=(root,key)=>root.querySelector('[data-aggregate="'+key+'"]').value;
 function clean(){generation++;dispose?.();dispose=null;busyState?.finish();}
 function busy(root){
  const controls=new Map([...root.querySelectorAll('button,input,select,textarea'),...document.querySelectorAll('[data-aggregation-actions] button')].map(control=>[control,control.disabled])),status=root.querySelector('[data-aggregation-status]');
  const state={finish(){for(const [control,disabled] of controls)if(control.isConnected)control.disabled=disabled;if(root.isConnected){root.setAttribute('aria-busy','false');if(status)status.textContent='';}if(busyState===state){busyState=null;saving=false;}}};
  busyState=state;saving=true;root.setAttribute('aria-busy','true');if(status)status.textContent=text('busy');for(const control of controls.keys())control.disabled=true;return state.finish;
 }
 async function load(offset=0){const request=++generation,data=await loadDatasetColumnWindow(call,draft.source,{offset,selected:[...draft.keys,...draft.values.map(v=>v.column)]});guard();if(request!==generation)return false;columnPage=data;columns=data.items;return true;}
 function capture({validate=false}={}){
  const root=document.querySelector('[data-aggregation-form]');if(!root)return;title=get(root,'title');draft.source=JSON.parse(root.querySelector('[data-ref-value]').value);
  const checked=[...root.querySelectorAll('[data-group-key]:checked')].map(el=>Number(el.dataset.groupKey));draft.keys=[...draft.keys.filter(i=>checked.includes(i)),...checked.filter(i=>!draft.keys.includes(i))];draft.keySemantics=draft.keys.map(i=>root.querySelector('[data-key-semantics="'+i+'"]').value);
  draft.values=[...root.querySelectorAll('[data-aggregate-value]')].map(el=>{const operation=get(el,'operation'),value={column:Number(get(el,'column')),name:get(el,'name'),operation,...readResultFormat(el)};if(operation==='quantile'){const representation=get(el,'probability-representation');value.method=get(el,'method');value.probability={spelling:readScalarSpelling(el.querySelector('[data-aggregate="probability"]'),{validate}),representation,radix:numeralUsesRadix(representation)?Number(get(el,'probability-radix')):10};}return value;});
  draft.missing=get(root,'missing');draft.note=get(root,'note');if(draft.version>=3)draft.resourcePolicy=readDatasetResourcePolicy(root,{validate});
 }
 function quantileControls(value,index){
  const probability=value.probability??{spelling:'0.5',representation:'decimal',radix:10};
  return '<div data-aggregate-quantile'+(value.operation==='quantile'?'':' hidden')+'>'+select('method',value.method??'linear-n-minus-one-v1',[['linear-n-minus-one-v1',text('linear-n-minus-one-v1')]])+field(esc(text('probability')),scalarSpellingInput(probability.spelling,{esc,field:probabilityFields[index]??'aggregation.values.'+index+'.probability.spelling',attributes:'data-aggregate="probability"',resourcePolicy:draft.resourcePolicy}))+select('probability-representation',probability.representation,NUMBER_REPRESENTATIONS.map(value=>[value,t('measurements',value==='radix'?'radixLabel':value)]))+'<div data-aggregate-probability-base'+(numeralUsesRadix(probability.representation)?'':' hidden')+'>'+field(esc(text('probability-radix')),'<input data-aggregate="probability-radix" type="number" min="2" max="36" step="1" value="'+esc(probability.radix)+'">')+'</div><p>'+esc(text('quantileRules'))+'</p></div>';
 }

 function keyControl({column,index}){
  const selected=draft.keys.includes(index),semantics=draft.keySemantics?.[draft.keys.indexOf(index)]??(column.representation==='domain'?'domain':'lexical');
  return '<div data-key-row><label class="checkbox"><input type="checkbox" data-group-key="'+index+'"'+(selected?' checked':'')+'>'+esc(column.name)+'</label><div data-key-options'+(selected?'':' hidden')+'>'+field(esc(text('keySemantics',{name:column.name})),'<select data-key-semantics="'+index+'">'+(draft.version>=2?['lexical','numeric','domain']:['lexical','numeric']).map(value=>'<option value="'+value+'"'+(semantics===value?' selected':'')+(value==='numeric'&&!isScalarRepresentation(column)||value==='domain'&&column.representation!=='domain'||value==='lexical'&&column.representation==='domain'?' disabled':'')+'>'+esc(text('key-'+value))+'</option>').join('')+'</select>')+'</div></div>';
 }
 function form(){
  clean();const reference=analysisReferenceField('aggregation.reference',draft.source,{esc,kind:'dataset'}).replace(/<legend>.*?<\/legend>/,'<legend>'+esc(text('source'))+'</legend>');
  const policy=draft.version>=3?'<details data-aggregation-resource-policy data-scalar-policy-for="aggregation"><summary>'+esc(text('resourcePolicy'))+'</summary><input type="checkbox" data-scalar-policy-enabled checked hidden>'+datasetResourcePolicyControls(draft.resourcePolicy,{esc,field,help:text('resourceHelp'),legacy:'',footer:''})+'</details>':'<p>'+esc(text('legacyPolicy'))+'</p>'+button('upgradePolicy','upgrade-policy');
  frame(text('open'),'<div data-aggregation-form data-scalar-policy-owner="aggregation" aria-busy="false"><p>'+esc(text('help'))+'</p>'+input('title',title,300)+reference+'<fieldset><legend>'+esc(text('keys'))+'</legend>'+datasetColumnPager(columnPage,{esc})+columns.map(keyControl).join('')+'<p>'+esc(text('keyHelp'))+'</p></fieldset><h3>'+esc(text('values'))+'</h3>'+(draft.version<4?'<p>'+esc(text('quantileUpgradeHelp'))+'</p>'+button('upgradeQuantile','upgrade-quantile'):'<p>'+esc(text('quantileVersion'))+'</p>')+draft.values.map((v,i)=>'<fieldset data-aggregate-value="'+i+'"><legend>'+esc(text('operation'))+' '+(i+1)+'</legend>'+select('column',v.column,columns.map(({column:c,index:i})=>[i,(i+1)+'. '+c.name+(c.unit?' ['+c.unit+']':'')]))+input('name',v.name,200)+select('operation',v.operation,AGGREGATION_OPERATIONS.filter(op=>op!=='quantile'||draft.version>=4).map(op=>[op,text(op)]))+(draft.version>=4?quantileControls(v,i):'')+resultFormatControls(v.output,{esc,field})+button('remove','remove','data-index="'+i+'"')+'</fieldset>').join('')+button('add','add')+select('missing',draft.missing,['skip','error'].map(v=>[v,text(v)]))+'<p>'+esc(text('rules'))+'</p>'+field(esc(text('note')),'<textarea data-aggregate="note" maxlength="10000">'+esc(draft.note)+'</textarea>')+policy+'<p data-aggregation-status role="status"></p><div data-aggregation-preview role="status"></div></div>','<div class="material-actions" data-aggregation-actions>'+button('preview','preview')+button('save','save')+button('cancel','cancel')+'</div>');
  const root=document.querySelector('[data-aggregation-form]');wireResultFormats(root);
  for(const metric of root.querySelectorAll('[data-aggregate-value]')){
   const operation=metric.querySelector('[data-aggregate="operation"]'),quantile=metric.querySelector('[data-aggregate-quantile]');if(quantile){operation.onchange=()=>{quantile.hidden=operation.value!=='quantile';};const representation=metric.querySelector('[data-aggregate="probability-representation"]');representation.onchange=()=>{metric.querySelector('[data-aggregate-probability-base]').hidden=!numeralUsesRadix(representation.value);};}
  }
  for(const control of root.querySelectorAll('[data-column-window]'))control.onclick=async()=>{if(saving)return;const request=generation;try{await dispose?.ready?.();guard();if(request!==generation||!root.isConnected)return;capture();const finish=busy(root);try{if(await load(datasetColumnPageOffset(control)))form();}finally{finish();}}catch(error){if(root.isConnected)notify(error.message,true);}};
  for(const el of root.querySelectorAll('[data-group-key]'))el.onchange=()=>el.closest('[data-key-row]').querySelector('[data-key-options]').hidden=!el.checked;
  const analysis=wireAnalysisFields(root,{state,api,call,esc,field,guard,recordId:owner(),onReference:async()=>{const request=generation;await dispose?.ready?.();guard();if(request!==generation||!root.isConnected)return;capture();if(draft.source){const finish=busy(root);try{if(await load())form();}finally{finish();}}}}),scalars=wireScalarFields(root,{call,reference:()=>({ref:source}),guard,esc,available:()=>!saving});
  dispose=()=>{analysis();scalars();};dispose.ready=()=>scalars.ready();
 }

 async function action(act,control){
  if(!act.startsWith('aggregation-'))return false;guard();if(saving)return true;const key=act.slice(12);
  if(key==='open'||key==='repeat'){
   clean();const request=generation;source=JSON.parse(control.dataset.ref);const doc=await call('read',{ref:source});guard();if(request!==generation)return true;draft=key==='repeat'?structuredClone(doc.content.aggregation):{version:3,source,keys:[],values:[],missing:'skip',note:'',resourcePolicy:defaultDatasetResourcePolicy()};probabilityFields=draft.values.map((_,index)=>key==='repeat'?'aggregation.values.'+index+'.probability.spelling':null);title=key==='repeat'?doc.title:text('open');identity={id:key==='repeat'?source.id:crypto.randomUUID(),expectedRevision:key==='repeat'?source.revision:null,jobId:crypto.randomUUID()};if(await load())form();return true;
  }
  if(key==='cancel'){clean();await inspect(source);return true;}
  const requestBeforeCapture=generation;await dispose?.ready?.();guard();if(requestBeforeCapture!==generation)return true;assertAnalysisFieldsReady(document.querySelector('[data-aggregation-form]'));capture({validate:key==='preview'||key==='save'});
  if(key==='upgrade-policy'&&draft.version<3){draft.version=3;draft.resourcePolicy=defaultDatasetResourcePolicy();form();return true;}
  if(key==='upgrade-quantile'){draft.version=4;draft.resourcePolicy??=defaultDatasetResourcePolicy();form();return true;}
  if(key==='add'){if(draft.values.length>=32)throw Error(text('invalid'));draft.values.push({column:columnPage?.offset??0,name:'',operation:'median'});probabilityFields.push(null);}
  if(key==='remove'){draft.values.splice(Number(control.dataset.index),1);probabilityFields.splice(Number(control.dataset.index),1);}
  if(key==='preview'||key==='save'){
   if(!validAggregation(draft,columnPage?.total??0)||!title.trim())throw Error(text('invalid'));const command={recordId:owner(),title,...identity,aggregation:draft},request=generation,root=document.querySelector('[data-aggregation-form]');assertAggregationRequestFits(command);const current=()=>request===generation&&root?.isConnected&&document.querySelector('[data-aggregation-form]')===root;const finish=busy(root);
   try{if(key==='preview'){const data=await call('dataset-preview',command);guard();if(!current())return true;root.querySelector('[data-aggregation-preview]').innerHTML='<p>'+esc(text('previewNote'))+'</p><div class="material-table"><table><thead><tr>'+data.columns.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+data.rows.map(r=>'<tr>'+r.cells.map((v,i)=>'<td>'+esc(r.valueKinds[i]==='absent'?'∅':displayedValue(v))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
   else{const data=await call('dataset',command);guard();if(!current())return true;clean();await watchJob(data.job);}}finally{finish();}return true;
  }
  form();return true;
 }
 return {action,clean,isBusy:()=>saving};
}
export function aggregationInspection(data,{esc,sourceButton}){
 const text=aggregationText,a=data.aggregation;
 const button=key=>'<button type="button" class="button" data-action="material-measurement-'+key+'">'+esc(text(key))+'</button>';
 let quantile='';
 if(a.operation==='quantile'){
  const scalar=(value,field)=>scalarSpellingView(value.spelling,{esc,field})+' '+esc(text('scalarContext',{representation:t('measurements',value.representation==='radix'?'radixLabel':value.representation),radix:value.radix}));
  quantile='<section data-aggregation-quantile><h4>'+esc(text('quantileMethod'))+'</h4><p>'+esc(text(a.method))+'</p><dl><dt>'+esc(text('probability'))+'</dt><dd>'+scalar(a.probability,'aggregation.values.'+a.metricIndex+'.probability.spelling')+'</dd></dl><p>'+esc(text('quantileRules'))+'</p>';
  if(a.quantile){quantile+='<dl><dt>'+esc(text('interpolationWeight'))+'</dt><dd>'+scalar(a.quantile.weight,'weight.spelling')+'</dd></dl><div class="material-fields">'+['lower','upper'].map(side=>{const bracket=a.quantile[side];return '<div data-quantile-bracket="'+side+'"><h4>'+esc(text(side==='lower'?'lowerBracket':'upperBracket'))+'</h4><p>'+esc(text('sortedPosition',{position:bracket.rank+1}))+'</p>'+sourceButton(bracket.source)+'</div>';}).join('')+'</div>';}
  else quantile+='<p>'+esc(text('quantileEmpty'))+'</p>';
  quantile+='</section>';
 }
 return '<section data-aggregation-sources><h3>'+esc(text('sources'))+'</h3><p>'+esc(text(a.operation))+' \u00b7 '+esc(a.source.revision.slice(0,12))+'</p><p>'+esc(text('provenance'))+'</p>'+(a.note?'<p>'+esc(a.note)+'</p>':'')+quantile+(a.counts?'<dl>'+['total','included','excluded','missing'].map(k=>'<dt>'+esc(text(k==='missing'?'missingValue':k))+'</dt><dd>'+a.counts[k]+'</dd>').join('')+'</dl>':'')+'<div class="material-table"><table><thead><tr><th>'+esc(text('reading'))+'</th><th>'+esc(text('status'))+'</th><th>'+esc(text('inspect'))+'</th></tr></thead><tbody>'+a.members.map(item=>'<tr><td>'+esc(item.presence==='value'?displayedValue(item.value):text(item.presence==='missing'?'missingValue':item.presence))+'</td><td>'+esc(text(item.status==='missing'?'missingValue':item.status))+(item.reason?' \u00b7 '+esc(item.reason):'')+'</td><td>'+sourceButton(item.source)+'</td></tr>').join('')+'</tbody></table></div>'+(a.previous!==null?button('previous'):'')+(a.next!==null?button('next'):'')+'</section>';
}
