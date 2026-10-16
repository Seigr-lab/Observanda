import {t} from './i18n/index.js';
import {INTERVAL_FIELDS} from './figure-intervals.js';
export const intervalText=k=>t('figureIntervals',k);
export function intervalHeaders(esc){return INTERVAL_FIELDS.map(k=>'<th>'+esc(intervalText(k))+'</th>').join('');}
export function intervalCells(p,i,figure,esc){return INTERVAL_FIELDS.map(k=>`<td><input aria-label="${esc(intervalText(k)+' '+(i+1))}" data-figure-row="${i}" data-figure-column="${k}" type="${k[0]==='x'&&figure.x.kind==='date'?'text':'number'}" step="any" value="${esc(p[k]??'')}"${k[0]==='x'&&figure.x.kind==='category'?' disabled':''}></td>`).join('');}
export function intervalMappingControls(columns,{esc,attribute='data-interval-column',values={}}){
 return `<details><summary>${esc(intervalText('settings'))}</summary><p>${esc(intervalText('help'))}</p><div class="material-fields">${['error',...INTERVAL_FIELDS].map(k=>`<label>${esc(intervalText(k))}<select aria-label="${esc(intervalText(k))}" ${attribute}="${k}"><option value="">${esc(intervalText('none'))}</option>${columns.map((c,i)=>`<option value="${c.index??i}"${values[k]===(c.index??i)?' selected':''}>${esc(c.name??c.label)}</option>`).join('')}</select></label>`).join('')}</div></details>`;
}
export const readIntervalMapping=root=>Object.fromEntries([...root.querySelectorAll('[data-interval-column]')].map(el=>[el.dataset.intervalColumn,el.value===''?null:Number(el.value)]));
