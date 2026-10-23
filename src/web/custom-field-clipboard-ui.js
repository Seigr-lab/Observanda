import {wireNumeralClipboard} from './numeral-clipboard-ui.js';
import {validateCustomFieldClipboard} from './custom-field-clipboard.js';
// One delegated binding serves ordinary, selected, module and online editors.
// Each rendered wrapper carries the saved field's context, never editable controls.
export function wireCustomFieldClipboard(root,{available=()=>true}={}){
 const fields=control=>{
  const host=control?.closest?.('[data-custom-field-number]');if(!host||!root.contains(host))return null;
  const spelling=host.querySelector('input[data-custom-field-spelling]');if(!spelling)return null;
  return {spelling,context:JSON.parse(host.dataset.customFieldNumber)};
 };
 return wireNumeralClipboard(root,{fields,validate:(payload,field)=>validateCustomFieldClipboard(payload,field.context),available:control=>{
  if(!available())return false;
  const field=fields(control);if(!field||!field.spelling.isConnected||field.spelling.readOnly||field.spelling.matches(':disabled')||field.spelling.closest('[inert],[hidden]'))return false;
  const dialog=field.spelling.closest('dialog');return !dialog||dialog.open;
 }});
}
