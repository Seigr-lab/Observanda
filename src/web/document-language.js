import {t,language} from './i18n/index.js';

// These persistent nodes sit outside the page outlet and survive language changes.
export function updateDocumentLanguage(document){
 document.documentElement.lang=language();
 const skip=document.querySelector('.skip-link');
 if(skip){skip.textContent=t('startup','skip');skip.lang=language();}
}
