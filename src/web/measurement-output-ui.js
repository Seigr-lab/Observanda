import {t} from './i18n/index.js';
import {NUMBER_REPRESENTATIONS,numeralUsesRadix} from './numeral-context.js';

// Shared by each retained calculation step and each aggregation metric.
export function resultFormatControls(value,{esc,field}){
 const text=key=>t('measurementOutput',key),representation=value?.representation??'default';
 return '<div data-result-format>'+field(esc(text('format')),'<select data-result-representation>'+['default',...NUMBER_REPRESENTATIONS].map(v=>'<option value="'+v+'"'+(v===representation?' selected':'')+'>'+esc(text(v))+'</option>').join('')+'</select>')+
  '<div data-result-base'+(numeralUsesRadix(representation)?'':' hidden')+'>'+field(esc(text('resultRadix')),'<input data-result-radix type="number" min="2" max="36" step="1" value="'+esc(value?.radix??10)+'">')+'</div><p class="hint">'+esc(text('exact'))+'</p></div>';
}
export function readResultFormat(root){
 const representation=root.querySelector('[data-result-representation]').value;
 return representation==='default'?{}:{output:{version:1,representation,radix:numeralUsesRadix(representation)?Number(root.querySelector('[data-result-radix]').value):10}};
}
export function wireResultFormats(root){
 for(const select of root.querySelectorAll('[data-result-representation]'))select.onchange=()=>{
  select.closest('[data-result-format]').querySelector('[data-result-base]').hidden=!numeralUsesRadix(select.value);
 };
}
