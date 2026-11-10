// The conversion offer in an ordinary book's Lab book settings. The conversion
// view itself is a feature chunk: it loads the first time someone uses it.
import {t} from './i18n/index.js';

// Only an ordinary book of a project that has its own store can be converted.
export const conversionProject=state=>state.projectOwner&&!state.projectOwner.labBookId?state.projectOwner.projectId:null;

export function bookConversionEntry(services){
 const {state,esc}=services;let view;
 const loaded=async()=>view??=(await import('./book-conversion-ui.js')).bookConversionUI(services);
 function offer(book){
  const projectId=conversionProject(state);
  if(!book?.id||!projectId||book.projectId!==projectId)return '';
  return `<section class="panel book-conversion-offer"><h3>${esc(t('labBookDirectory','conversionTitle'))}</h3><p>${esc(t('labBookDirectory','conversionOffer'))}</p><button type="button" class="button" data-action="book-convert-open" data-id="${esc(book.id)}">${esc(t('labBookDirectory','conversionReview'))}</button></section>`;
 }
 async function action(control){return control.dataset.action?.startsWith('book-convert-')?(await loaded()).action(control):false;}
 async function submit(form){return form.id==='book-conversion-form'?(await loaded()).submit(form):false;}
 return {offer,action,submit};
}
