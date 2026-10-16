import {LANGUAGES,language,t,prepareLanguage,activateLanguage} from './index.js';
export function languageUI({api,esc,render,beforeChange=task=>task(),root=()=>document,coverageId='language-coverage'}){
 let busy=false,failed=null;
 const message=key=>esc(t('preferences',key));
 function view(){
  return `<section class="language-preference panel" lang="${language()}"><label class="field">${message('language')}<select data-language-choice aria-describedby="${esc(coverageId)}" ${busy?'disabled':''}>${LANGUAGES.map(l=>`<option value="${l.id}" lang="${l.id}" ${l.id===language()?'selected':''}>${esc(l.name)}</option>`).join('')}</select></label><details id="${esc(coverageId)}"><summary>${message('coverageTitle')}</summary><p class="muted">${message('coverage')}</p></details><p role="${failed?'alert':'status'}">${busy?message('saving'):failed?message(failed):''}</p></section>`;
 }
 async function load(){
  const result=await api('/api/language');
  try{await prepareLanguage(result.language);activateLanguage(result.language);failed=null;}
  catch{activateLanguage('en');failed='loadFailed';}
 }
 async function choose(value){
  if(busy)return;busy=true;failed=null;render();
  try{await prepareLanguage(value);await api('/api/language',{language:value});activateLanguage(value);}
  catch{failed='failed';}
  finally{busy=false;render();root()?.querySelector('[data-language-choice]')?.focus({preventScroll:true});}
 }
 return {view,load,input(el){if(!el.matches('[data-language-choice]'))return false;const value=el.value;el.value=language();void beforeChange(()=>choose(value));return true;}};
}
