import {t} from './i18n/index.js';
import {customFieldClipboardContext} from './custom-field-clipboard.js';
import {numeralClipboardControls} from './numeral-clipboard-ui.js';
import {customFieldLabel as templateFieldLabel} from './custom-field-presentation.js';
export {templateFieldLabel};
const tr=key=>t('moduleFields',key);
export const templateInputValue=(field,value)=>field.type==='boolean'?(value===''?null:value==='true'):value;

// Shared by creation and editing. Scientific numbers remain text; using a
// number input or Number() here would discard the user's exact representation.
export function templateFieldInput(field,value,{esc,attrs=''}){
 const option=(key,label)=>'<option value="'+esc(String(key))+'" '+(String(key)===String(value??'')?'selected':'')+'>'+esc(label)+'</option>';
 const attributes=attrs+' aria-label="'+esc(templateFieldLabel(field))+'"'+(field.required?' required':'');
 if(['select','boolean'].includes(field.type))return '<select '+attributes+'>'+option('',tr('choose'))+(field.type==='boolean'?[[true,tr('yes')],[false,tr('no')]]:field.choices.map(v=>[v,v])).map(([v,label])=>option(v,label)).join('')+'</select>';
 if(field.type==='number')return '<span data-numeral-scope data-custom-field-number="'+esc(JSON.stringify(customFieldClipboardContext(field)))+'"><input '+attributes+' data-custom-field-spelling type="text" value="'+esc(value??'')+'">'+numeralClipboardControls({esc})+'</span>';
 return field.type==='text'?'<textarea '+attributes+' maxlength="10000" rows="2">'+esc(value??'')+'</textarea>':'<input '+attributes+' type="'+(field.type==='date'?'date':'text')+'" value="'+esc(value??'')+'">';
}
