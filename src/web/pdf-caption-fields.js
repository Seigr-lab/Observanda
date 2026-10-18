import {t} from './i18n/index.js';
import {pdfCaptionDefaults,pdfStructureDefaults} from './pdf-structure-model.js';
const checks=['numberFigures','numberTables','listFigures','listTables'],texts=['figureLabel','tableLabel','figuresTitle','tablesTitle'];
export function pdfCaptionFields(header,{esc}){
 const settings=header.structure?.caption??pdfCaptionDefaults(),tr=key=>t('pdfEditor',key);
 return '<details><summary>'+esc(tr('captions'))+'</summary>'+checks.map(key=>'<label class="field"><input type="checkbox" data-pdf-caption="'+key+'"'+(settings[key]?' checked':'')+'>'+esc(tr(key))+'</label>').join('')+texts.map(key=>'<label class="field">'+esc(tr(key))+'<input data-pdf-caption="'+key+'" maxlength="160" value="'+esc(settings[key])+'"></label>').join('')+'</details>';
}
export function changePdfCaption(header,element){const key=element.dataset.pdfCaption;if(!checks.includes(key)&&!texts.includes(key))return false;header.structure??=pdfStructureDefaults();header.structure.caption??=pdfCaptionDefaults();header.structure.caption[key]=checks.includes(key)?element.checked:element.value;return true;}
