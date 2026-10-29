import * as model from './composition-tree.js';
import {t} from './i18n/index.js';
import './i18n/catalogues/compositionControls.js';

export * from './composition-tree.js';
export const compositionText=(key,values)=>t('compositionControls',key,values);
export const elementName=element=>model.ELEMENTS.some(item=>item.kind===element?.kind)?compositionText('element_'+element.kind):element?.name??element?.kind??'';
export const elementGroup=element=>['Layout','Content','Research'].includes(element?.group)?compositionText('group_'+element.group):element?.group??'';
// Tree operations also run outside the browser. Translate only their display
// errors here; keep model defaults, identities and saved content unchanged.
const localized=operation=>(...args)=>{
 try{return operation(...args);}catch(error){
  if(error.compositionMessage)error.message=compositionText(error.compositionMessage);
  throw error;
 }
};
export const moveElement=localized(model.moveElement);
export const insertElement=localized(model.insertElement);
export const newElement=localized(model.newElement);
