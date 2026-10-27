import './i18n/catalogues/datasetPreparation.js';
import {t} from './i18n/index.js';
export const preparationText=(key,p)=>t('datasetPreparation',key,p);
export function datasetPreparationUI({esc,field,button}){
 const text=key=>esc(preparationText(key));
 const sourceField=()=>'<div class="material-nested-only" hidden>'+field(text('source'),'<select data-map-source><option value="row">'+text('row')+'</option><option value="context">'+text('context')+'</option></select>')+'</div>';
 const packedControls=()=>'<div data-lookup-position hidden><p data-lookup-position-help>'+text('positionHelp')+'</p><label><input type="checkbox" data-lookup-packed> '+text('packed')+'</label><div data-lookup-packing hidden><p>'+text('packedFields')+'</p>'+['offset','width','count'].map(key=>field(text('packed'+key[0].toUpperCase()+key.slice(1)),'<input type="number" min="'+(key==='width'?1:0)+'" step="1" max="9007199254740991" data-packed="'+key+'" value="'+(key==='offset'?'0':'')+'">')).join('')+'<details><summary>'+text('packedDetails')+'</summary><p>'+text('packedHelp')+'</p></details></div></div>';
 const joinRow=()=>'<fieldset class="material-lookup"><legend>'+text('lookup')+'</legend>'+field(text('lookupName'),'<input data-lookup="name" maxlength="40" placeholder="control">')+field(text('joinMode'),'<select data-lookup="mode"><option value="key">'+text('keyMode')+'</option><option value="position">'+text('positionMode')+'</option></select>')+field(text('lookupRows'),'<input data-lookup="rowsPath" maxlength="2048" placeholder="/visits/*/controls">')+'<div data-lookup-keys>'+field(text('leftKey'),'<input data-lookup="leftPath" maxlength="2048" placeholder="/controlId">')+field(text('rightKey'),'<input data-lookup="rightPath" maxlength="2048" placeholder="/id">')+field(text('unmatched'),'<select data-lookup="unmatched"><option value="error">'+text('reject')+'</option><option value="keep">'+text('keep')+'</option></select>')+'</div>'+packedControls()+button(text('removeLookup'),'lookup-remove')+'</fieldset>';
 const controls=()=>'<div class="material-nested-only" hidden><p>'+text('help')+'</p><div id="material-lookups"></div>'+button(text('addLookup'),'lookup-add')+'</div>';
 function refresh(){
  const nested=document.getElementById('material-format')?.value==='json-nested';
  document.querySelectorAll('.material-nested-only').forEach(el=>el.hidden=!nested);
  for(const row of document.querySelectorAll('.material-lookup')){const positional=row.querySelector('[data-lookup="mode"]').value==='position',packed=positional&&row.querySelector('[data-lookup-packed]').checked;row.querySelector('[data-lookup-keys]').hidden=positional;row.querySelector('[data-lookup-position]').hidden=!positional;row.querySelector('[data-lookup-position-help]').hidden=packed;row.querySelector('[data-lookup-packing]').hidden=!packed;for(const input of row.querySelectorAll('[data-packed]')){input.disabled=!packed;input.required=packed;}}
  const names=[...document.querySelectorAll('[data-lookup="name"]')].map(el=>el.value).filter(Boolean);
  for(const select of document.querySelectorAll('[data-map-source]')){
   const value=select.value;select.innerHTML=[['row',preparationText('row')],['context',preparationText('context')],...names.map(n=>[n,n])].map(([v,label])=>'<option value="'+esc(v)+'">'+esc(label)+'</option>').join('');
   // Retain a selected lookup while its name is being edited; validation will
   // require a real lookup before saving rather than silently changing source.
   if(value&&!['row','context',...names].includes(value))select.insertAdjacentHTML('beforeend','<option value="'+esc(value)+'">'+esc(value)+'</option>');
   select.value=value||'row';
  }
 }
 function read(){return [...document.querySelectorAll('.material-lookup')].map(row=>{const value=Object.fromEntries([...row.querySelectorAll('[data-lookup]')].map(el=>[el.dataset.lookup,el.value]));return value.mode==='position'?{name:value.name,mode:'position',rowsPath:value.rowsPath,...(row.querySelector('[data-lookup-packed]').checked?{packed:Object.fromEntries([...row.querySelectorAll('[data-packed]')].map(el=>[el.dataset.packed,el.value===''?null:Number(el.value)]))}:{})}:value;});}
 const summary=mapping=>(mapping?.joins??[]).filter(j=>j.packed).map(j=>'<p>'+esc(preparationText('packedSummary',{name:j.name,path:j.rowsPath,...j.packed}))+'</p>').join('');
 return {sourceField,controls,joinRow,refresh,read,summary};
}
