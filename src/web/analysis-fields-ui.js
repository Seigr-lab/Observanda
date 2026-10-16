import {analysisText as atext} from './analysis-messages.js';
import {materialSourcePicker} from './material-source-picker.js';
import {researchTargetPicker} from './research-target-picker.js';
import {ANALYSIS_ROLES} from './analysis-model.js';
export {atext};
export function analysisChangesView(status,esc){return (status?.items??[]).map(item=>'<aside class="material-review" role="status"><p>'+esc(atext('changed'))+'</p><details><summary>'+esc(atext('changedSources',{count:item.changed}))+'</summary><ul>'+item.sample.map(r=>'<li>'+esc(r.label??r.id)+' · <code>'+esc(r.revision.slice(0,12))+'</code></li>').join('')+'</ul></details></aside>').join('');}
export function assertAnalysisFieldsReady(root){if(root.querySelector('[data-ref-choose]:disabled'))throw Error(atext('finishReference'));}
export function analysisReferenceField(key,value,{esc,records=false,kind=null}){return `<fieldset data-analysis-ref="${key}" data-records="${records}" data-kind="${kind??''}"><legend>${esc(atext(key.split('.').at(-1)))}</legend><input type="hidden" name="analysis-ref-${key}" data-ref-value value="${esc(JSON.stringify(value))}"><p data-ref-label>${esc(value?.label??value?.revision??atext('none'))}</p><button type="button" class="button" data-ref-choose>${esc(atext('choose'))}</button> <button type="button" class="text-button" data-ref-remove>${esc(atext('remove'))}</button><div data-ref-host></div></fieldset>`;}
export function analysisMethodFields(method,{esc,field}){
 const area=(key,v)=>field(esc(atext(key)),`<textarea data-method="${key}" maxlength="${key==='limitations'?10000:2000}">${esc(v)}</textarea>`);
 return `<input type="hidden" name="analysis-edits" data-analysis-edits value="0"><details open><summary>${esc(atext('method'))}</summary>${ANALYSIS_ROLES.map(k=>analysisReferenceField(k,method.references[k],{esc})).join('')}${area('unavailable',method.unavailable)}${area('uncertainty',method.uncertainty)}${area('limitations',method.limitations)}<h3>${esc(atext('parameters'))}</h3><div data-parameters>${method.parameters.map(p=>analysisParameterFields(p,{esc,field})).join('')}</div><button type="button" class="button" data-analysis-add-parameter>${esc(atext('addParameter'))}</button></details>`;
}
export function analysisParameterFields(p,{esc,field}){return `<fieldset data-parameter>${['name','value','unit','reason'].map(k=>field(esc(atext(k)),`<input data-parameter-key="${k}" maxlength="${k==='value'?8192:k==='reason'?2000:k==='name'?200:100}" value="${esc(p[k])}">`)).join('')}${analysisReferenceField('reference',p.reference,{esc})}<button type="button" class="text-button" data-analysis-remove-parameter>${esc(atext('remove'))}</button></fieldset>`;}
export function readAnalysisMethod(root){return {version:1,references:Object.fromEntries(ANALYSIS_ROLES.map(k=>[k,JSON.parse(root.querySelector('[data-analysis-ref="'+k+'"] [data-ref-value]').value)])),...Object.fromEntries(['unavailable','uncertainty','limitations'].map(k=>[k,root.querySelector('[data-method="'+k+'"]').value])),parameters:[...root.querySelectorAll('[data-parameter]')].map(el=>({...Object.fromEntries([...el.querySelectorAll('[data-parameter-key]')].map(i=>[i.dataset.parameterKey,i.value])),reference:JSON.parse(el.querySelector('[data-ref-value]').value)}))};}
export function wireAnalysisFields(root,{state,api,call,esc,field,guard,recordId,onReference=()=>{},chooseReference=null}){
 const controller=new AbortController(),pickers=new Set();let disposed=false;
 const active=()=>!disposed&&root.isConnected;
 root.addEventListener('click',event=>{
  const b=event.target.closest('[data-ref-choose],[data-ref-remove],[data-analysis-add-parameter],[data-analysis-remove-parameter]');if(!b)return;event.preventDefault();event.stopPropagation();
  void (async()=>{guard();
   if(b.hasAttribute('data-analysis-add-parameter')){if(root.querySelectorAll('[data-parameter]').length>=64)throw Error(atext('invalid'));root.querySelector('[data-parameters]').insertAdjacentHTML('beforeend',analysisParameterFields({name:'',value:'',unit:'',reason:'',reference:null},{esc,field}));const marker=root.querySelector('[data-analysis-edits]');marker.value=String(Number(marker.value)+1);marker.dispatchEvent(new Event('input',{bubbles:true}));return;}
   if(b.hasAttribute('data-analysis-remove-parameter')){b.closest('[data-parameter]').remove();const marker=root.querySelector('[data-analysis-edits]');marker.value=String(Number(marker.value)+1);marker.dispatchEvent(new Event('input',{bubbles:true}));return;}
   const region=b.closest('[data-analysis-ref]'),input=region.querySelector('[data-ref-value]'),host=region.querySelector('[data-ref-host]'),label=region.querySelector('[data-ref-label]');
   const set=async value=>{input.value=JSON.stringify(value);label.textContent=value?value.label??value.revision:atext('none');input.dispatchEvent(new Event('input',{bubbles:true}));await onReference(region,value);};
   if(b.hasAttribute('data-ref-remove')){await set(null);return;}b.disabled=true;
   let picker;const close=()=>{picker?.dispose?.();picker?.stop?.();pickers.delete(picker);host.replaceChildren();b.disabled=false;};
   if(chooseReference){
    try{const value=await chooseReference({title:atext(region.dataset.analysisRef.split('.').at(-1)),kind:region.dataset.kind||null,recordsOnly:region.dataset.records==='true',selected:JSON.parse(input.value)});
    if(active()&&value!==undefined){guard();await set(value);}}finally{close();}
   }else if(region.dataset.records==='true'){
    picker=researchTargetPicker({state,api,esc,field,active,excludeId:()=>null});pickers.add(picker);
    picker.open({root:host,title:atext(region.dataset.analysisRef),recordsOnly:true,onCancel:close,onChoose:async(item,{signal,stillCurrent})=>{const retained=await call('pin',{id:item.id,expectedRevision:item.revision},{signal,adopt:false});if(!stillCurrent()||!active())return;guard();await set({kind:'record',id:retained.id,revision:retained.revision,label:item.title});close();}});
   }else{
    host.innerHTML='<div data-picker><input type="hidden" data-value value=""></div><button type="button" class="button" data-use>'+esc(atext('use'))+'</button><button type="button" class="button" data-cancel>'+esc(atext('cancel'))+'</button>';
    picker=materialSourcePicker({root:host.querySelector('[data-picker]'),call,esc,field,guard,recordId,label:atext(region.dataset.analysisRef.split('.').at(-1)),id:'analysis-ref-'+crypto.randomUUID(),kind:region.dataset.kind||null,optional:true});pickers.add(picker);
    host.querySelector('[data-cancel]').onclick=close;host.querySelector('[data-use]').onclick=()=>{void(async()=>{guard();const value=picker.values()[0]??null;if(value)value.label=host.querySelector('[data-choices] select').selectedOptions[0].textContent.slice(0,-13).slice(0,300);await set(value);close();})().catch(showError);};await picker.ready;
   }
  })().catch(showError);
 },{signal:controller.signal});
 function showError(error){if(!active()||error.name==='AbortError')return;let p=root.querySelector('[data-analysis-field-error]');if(!p){p=document.createElement('p');p.dataset.analysisFieldError='';p.setAttribute('role','alert');root.append(p);}p.textContent=error.message;}
 return ()=>{disposed=true;controller.abort();for(const picker of pickers){picker.dispose?.();picker.stop?.();}};
}
