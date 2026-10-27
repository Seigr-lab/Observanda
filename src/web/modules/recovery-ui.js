import '../i18n/catalogues/moduleRecovery.js';
import {t} from '../i18n/index.js';
const tr=(key,args)=>t('moduleRecovery',key,args);
export function moduleRecoveryView(recovery,{esc,button}){
 if(!recovery.available.length&&!recovery.loading&&!recovery.listError&&!recovery.page?.previousCursor&&!recovery.page?.nextCursor)return '';
 const disabled=recovery.loading?'disabled':'';
 return `<section class="module-recovery" aria-label="${esc(tr('heading'))}" aria-busy="${recovery.loading}"><h2>${esc(tr('heading'))}</h2>
  ${recovery.loading?'<p role="status">'+esc(tr('loading'))+'</p>':''}
  ${recovery.listError?'<p role="alert">'+esc(recovery.listError.message??tr('failed'))+'</p>'+button(tr('retry'),'recovery-retry'):''}
  ${recovery.available.map(r=>`<div class="module-inline" data-recovery-item="${r.id}"><span>${esc(r.titles.join(', '))}${r.count>r.titles.length?' '+esc(tr('more',{count:r.count-r.titles.length})):''} · ${esc(new Date(r.updatedAt).toLocaleString())}</span>${button(tr('restore'),'recover',`data-id="${r.id}" ${disabled}`)}${button(tr('discard'),'remove-recovery',`data-id="${r.id}" ${disabled}`,'subtle')}</div>`).join('')}
  <nav class="module-actions" aria-label="${esc(tr('pages'))}">${button(tr('previous'),'recovery-previous',recovery.page?.previousCursor?disabled:'disabled')}${button(tr('next'),'recovery-next',recovery.page?.nextCursor?disabled:'disabled')}${button(tr('refresh'),'recovery-refresh',disabled)}</nav>
 </section>`;
}
