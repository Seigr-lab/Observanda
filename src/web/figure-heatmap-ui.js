import {t} from './i18n/index.js';
import {defaultHeatmap} from './figure-heatmap.js';
import {decimalPlotProjection} from './measurement-projection.js';
export const heatmapText=k=>t('figureHeatmap',k);
export function heatmapControls(h,{esc}){
 const input=(key,label,value,type='text',extra='')=>`<label>${esc(label)}<input data-heatmap-field="${key}" aria-label="${esc(label)}" type="${type}" value="${esc(value??'')}" ${extra}></label>`;
 return `<details class="figure-heatmap-settings" open><summary>${esc(heatmapText('settings'))}</summary><p>${esc(heatmapText('help'))}</p>${input('valueLabel',heatmapText('valueLabel'),h.valueLabel)}<label><input data-heatmap-field="showValues" type="checkbox"${h.showValues?' checked':''}>${esc(heatmapText('showValues'))}</label>${input('missingColor',heatmapText('missingColor'),h.missingColor,'color')}<div data-heatmap-bands>${h.thresholds.map((b,i)=>`<fieldset data-heatmap-band="${i}">${i===h.thresholds.length-1?'<p>'+esc(heatmapText('above'))+'</p>':input('max',heatmapText('max'),b.max,'number','step="any"')}${input('label',heatmapText('label'),b.label)}${input('color',heatmapText('color'),b.color,'color')}${i<h.thresholds.length-1?`<button type="button" class="button" data-action="figure-heatmap-remove" data-heatmap-remove="${i}">${esc(heatmapText('remove'))}</button>`:''}</fieldset>`).join('')}</div><button type="button" class="button" data-action="figure-heatmap-add" data-heatmap-add>${esc(heatmapText('add'))}</button></details>`;
}
export function readHeatmap(root){const get=k=>root.querySelector('[data-heatmap-field="'+k+'"]');return {valueLabel:get('valueLabel').value,showValues:get('showValues').checked,missingColor:get('missingColor').value,thresholds:[...root.querySelectorAll('[data-heatmap-band]')].map(el=>({max:el.querySelector('[data-heatmap-field="max"]')?decimalPlotProjection(el.querySelector('[data-heatmap-field="max"]').value):null,label:el.querySelector('[data-heatmap-field="label"]').value,color:el.querySelector('[data-heatmap-field="color"]').value}))};}
export function heatmapAction(el,h){if(el.hasAttribute('data-heatmap-add')){if(h.thresholds.length>=32)return false;const prior=h.thresholds.at(-2)?.max??0;h.thresholds.splice(-1,0,{max:prior+1,color:'#ffffbf',label:''});return true;}if(el.hasAttribute('data-heatmap-remove')){h.thresholds.splice(Number(el.dataset.heatmapRemove),1);return true;}return false;}
export function mountHeatmap(root,{esc,notify,initial=defaultHeatmap()}){
 let value=initial;const paint=()=>root.innerHTML=heatmapControls(value,{esc});paint();
 root.addEventListener('click',event=>{const el=event.target.closest('[data-heatmap-add],[data-heatmap-remove]');if(!el)return;event.preventDefault();try{value=readHeatmap(root);if(heatmapAction(el,value))paint();}catch(e){notify(e.message,true);}});
 return {read:()=>readHeatmap(root)};
}
