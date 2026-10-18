import {t} from './i18n/index.js';
import {pdfPressDefaults,validPdfPress} from './pdf-press-model.js';
const tr=(key,parameters)=>t('pdfEditor',key,parameters);
function size(header){const layout=header.layout,extra=header.press?2*(header.press.bleedMm+(header.press.cropMarks?5:0)):0,format=value=>Number(value.toFixed(2));return tr('pressSize',{trimWidth:format(layout.widthMm),trimHeight:format(layout.heightMm),sheetWidth:format(layout.widthMm+extra),sheetHeight:format(layout.heightMm+extra)});}
export function pdfPressFields(header,{esc}){
 const enabled=header.press!==undefined,settings=header.press??pdfPressDefaults();
 return '<details data-pdf-press-fields><summary>'+esc(tr('pressGeometry'))+'</summary><label class="field"><input type="checkbox" data-pdf-press="enabled"'+(enabled?' checked':'')+'>'+esc(tr('pressEnabled'))+'</label><p>'+esc(tr('pressHint'))+'</p><fieldset data-pdf-press-controls'+(enabled?'':' disabled')+'><label class="field">'+esc(tr('pressBleedMm'))+'<input type="number" min="0" max="20" step="0.1" data-pdf-press="bleedMm" value="'+esc(settings.bleedMm)+'"></label><label class="field"><input type="checkbox" data-pdf-press="cropMarks"'+(settings.cropMarks?' checked':'')+'>'+esc(tr('pressCropMarks'))+'</label></fieldset><p data-pdf-press-size>'+esc(size(header))+'</p><p>'+esc(tr('pressMixedHint'))+'</p></details>';
}
export function refreshPdfPress(header,root){const summary=root?.querySelector('[data-pdf-press-size]');if(summary)summary.textContent=size(header);}
export function changePdfPress(header,element){
 const key=element.dataset.pdfPress;if(!['enabled','bleedMm','cropMarks'].includes(key))return false;
 if(key==='enabled'){if(element.checked)header.press??=pdfPressDefaults();else delete header.press;}
 else{if(!header.press)return false;const next={...header.press,[key]:key==='cropMarks'?element.checked:element.value.trim()===''?NaN:Number(element.value)};if(!validPdfPress(next)){element.setAttribute?.('aria-invalid','true');return true;}element.removeAttribute?.('aria-invalid');header.press=next;}
 const root=element.closest?.('[data-pdf-press-fields]'),controls=root?.querySelector('[data-pdf-press-controls]');if(controls)controls.disabled=!header.press;refreshPdfPress(header,root);
 // Enabling after a reset restores explicit defaults in the existing controls.
 if(key==='enabled'&&header.press&&root){root.querySelector('[data-pdf-press="bleedMm"]').value=String(header.press.bleedMm);root.querySelector('[data-pdf-press="cropMarks"]').checked=header.press.cropMarks;}
 return true;
}
