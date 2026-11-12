// Readiness at run start for printed and issued result sheets. The sheet's
// language belongs to its request; it never changes the process language.
import {readFile} from 'node:fs/promises';
import {translator,validLanguage} from './web/i18n/runtime.js';
import {retainedQualityText} from './web/modules/resource-quality-presentation.js';
const cache=new Map();
const catalogue=async locale=>JSON.parse(await readFile(new URL('./web/locales/'+locale+'/resourceQuality.json',import.meta.url),'utf8'));
async function qualityTranslator(locale){
 if(!cache.has(locale))cache.set(locale,(async()=>{const fallback=await catalogue('en');return translator(locale,locale==='en'?fallback:await catalogue(locale),fallback);})().catch(error=>{cache.delete(locale);throw error;}));
 return cache.get(locale);
}
export async function runQualitySection(runQuality,{language='en',esc}){
 if(!runQuality)return '';
 const locale=validLanguage(language)?language:'en',tr=await qualityTranslator(locale);
 const items=runQuality.items.map(item=>`<li>${esc(retainedQualityText(item.readiness,tr))}${item.kind==='movement'?`<br>${esc(tr('stockUse')+': '+item.delta+' '+item.unit+' · '+retainedQualityText(item.stockUse,tr))}${item.status==='hold'?`<br>${esc(tr('heldAtRun'))}`:''}`:''}</li>`).join('');
 return `<section lang="${locale}" data-run-quality><h2>${esc(tr('runRecorded'))}</h2><ul>${items}</ul></section>`;
}
