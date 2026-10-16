import {t} from './i18n/index.js';
export const observationText=k=>t('figureObservations',k);
export function observationControls(a,f,esc){
 const field=(k,control)=>`<label>${esc(observationText(k))}${control.replace(/^<(input|select)/,tag=>tag+' aria-label="'+esc(observationText(k))+'"')}</label>`;
 if(a.kind==='region')return ['xLower','xUpper','yLower','yUpper'].map(k=>field(k,`<input data-annotation-field="${k}" type="${k[0]==='x'&&f.x.kind==='date'?'text':'number'}" step="any" value="${esc(a[k]??'')}">`)).join('');
 const series=f.series.find(s=>s.id===a.seriesId);
 return field('series',`<select data-annotation-field="seriesId">${f.series.map(s=>`<option value="${s.id}"${s.id===a.seriesId?' selected':''}>${esc(s.name)}</option>`).join('')}</select>`)+field('pointIndex',`<select data-annotation-field="pointIndex">${(series?.points??[]).map((p,i)=>`<option value="${i}"${i===a.pointIndex?' selected':''}>${esc((i+1)+': '+p.x+' → '+p.y)}</option>`).join('')}</select>`)+['dx','dy'].map(k=>field(k,`<input data-annotation-field="${k}" type="number" step="any" value="${a[k]}">`)).join('');
}
