import {t} from './i18n/index.js';
import {measurementUnitControls,readMeasurementUnit,wireMeasurementUnits} from './measurement-unit-ui.js';
import {materialSourcePicker} from './material-source-picker.js';
import {QUANTITY_ORIGINS,TIME_KINDS,blankClock,blankQuantity} from './measurement-model.js';
export const measurementText=(key,args)=>t('measurements',key,args);
export function provenanceFields(column,{esc,field,extra=false}){
 const q=column.quantity??blankQuantity(),time=column.time,c=time.clock??blankClock(),m=measurementText;
 const input=(key,value,label=key)=>field(esc(m(label)),`<input data-provenance="${key}" maxlength="${key==='frequency'?200:key==='decoderVersion'?300:500}" value="${esc(value??'')}">`);
 const select=(key,value,values,label=key)=>field(esc(m(label)),`<select data-provenance="${key}">${values.map(v=>`<option value="${v}"${v===value?' selected':''}>${esc(m(v==='source'?'sourceOrder':v))}</option>`).join('')}</select>`);
 const reference=(key,value)=>`<div data-provenance-reference="${key}"><strong>${esc(m(key))}</strong><input type="hidden" data-provenance="ref-${key}" value="${esc(JSON.stringify(value))}"><p data-ref-label>${esc(value?.label??value?.revision??m('noReference'))}</p><button type="button" class="button" data-provenance-choose>${esc(m('choose'))}</button> <button type="button" class="button" data-provenance-clear>${esc(m('remove'))}</button><div data-ref-picker hidden></div></div>`;
 return `<details><summary>${esc(m('quantity'))}</summary><p>${esc(m('rawHelp'))}</p>${select('origin',q.origin,QUANTITY_ORIGINS)}${measurementUnitControls(q.unitDefinition,{esc,field})}${reference('conversion',q.conversion)}${reference('calibration',q.calibration)}</details>
 <details><summary>${esc(m('time'))}</summary><p>${esc(m('clockHelp'))}</p>${select('time-kind',time.kind,TIME_KINDS)}${['reference','resolution','uncertainty'].map(k=>input('time-'+k,time[k])).join('')}${input('width',c.width??'')}${input('frequency',c.frequency)}${select('ordering',c.ordering,['unknown','source','monotonic','unordered'])}${select('wrap',c.wrap,['unknown','none','modulo','observed'])}${select('reset',c.reset,['unknown','none','observed'])}${input('epoch',c.epoch)}${reference('model',c.model)}${reference('referenceData',c.referenceData)}</details>
 ${extra?`<details><summary>${esc(m('references'))}</summary>${reference('decoder',column.references.decoder)}${input('decoderVersion',column.decoderVersion)}${reference('schema',column.references.schema)}</details>`:''}`;
}
export function readProvenance(root,original){
 const get=k=>root.querySelector('[data-provenance="'+k+'"]').value,ref=k=>JSON.parse(get('ref-'+k));
 const unitDefinition=readMeasurementUnit(root),quantity={origin:get('origin'),conversion:ref('conversion'),calibration:ref('calibration'),...(unitDefinition?{unitDefinition}:{})},clock={width:get('width')===''?null:Number(get('width')),frequency:get('frequency'),ordering:get('ordering'),wrap:get('wrap'),reset:get('reset'),epoch:get('epoch'),model:ref('model'),referenceData:ref('referenceData')};
 const time={kind:get('time-kind'),reference:get('time-reference'),resolution:get('time-resolution'),uncertainty:get('time-uncertainty')};
 if(original.time.clock!==undefined||JSON.stringify(clock)!==JSON.stringify(blankClock()))time.clock=clock;
 return {...(original.quantity!==undefined||JSON.stringify(quantity)!==JSON.stringify(blankQuantity())?{quantity}:{}),time};
}
export function wireProvenance(root,{call,esc,field,recordId,guard}){
 const pickers=new Set(),controller=new AbortController(),disposeUnits=wireMeasurementUnits(root,{esc,field});
 root.addEventListener('click',async event=>{
  const button=event.target.closest('[data-provenance-choose],[data-provenance-clear]');if(!button)return;
  const region=button.closest('[data-provenance-reference]'),input=region.querySelector('input'),label=region.querySelector('[data-ref-label]'),container=region.querySelector('[data-ref-picker]');
  if(button.hasAttribute('data-provenance-clear')){input.value='null';label.textContent=measurementText('noReference');input.dispatchEvent(new Event('input',{bubbles:true}));return;}
  button.disabled=true;container.hidden=false;container.innerHTML='<div data-picker><input type="hidden" data-value value=""></div><button type="button" class="button" data-use>'+esc(measurementText('use'))+'</button><button type="button" class="button" data-cancel>'+esc(measurementText('cancel'))+'</button>';
  const picker=materialSourcePicker({root:container.querySelector('[data-picker]'),call,esc,field,recordId,guard,label:measurementText(region.dataset.provenanceReference),id:'measurement-ref-'+crypto.randomUUID(),optional:true});pickers.add(picker);
  const close=()=>{picker.dispose();pickers.delete(picker);container.replaceChildren();container.hidden=true;button.disabled=false;};
  container.querySelector('[data-cancel]').onclick=close;
  container.querySelector('[data-use]').onclick=()=>{try{const value=picker.values()[0]??null;if(value){const title=container.querySelector('[data-choices] select').selectedOptions[0].textContent;value.label=title.slice(0,-13).slice(0,300);}input.value=JSON.stringify(value);label.textContent=value?value.label+' · '+value.revision.slice(0,12):measurementText('noReference');input.dispatchEvent(new Event('input',{bubbles:true}));close();}catch(error){label.textContent=error.message;}};
  await picker.ready;
 },{signal:controller.signal});
 return ()=>{controller.abort();disposeUnits();for(const p of pickers)p.dispose();};
}
