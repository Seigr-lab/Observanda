// A field with a length limit shows how much it holds instead of silently
// cutting pasted text; the save is refused while the text is too long.
import {t} from './i18n/index.js';

const message=(count,limit)=>t('applicationTexts',count>limit?'lengthOver':'lengthCount',{count,limit});

export function lengthCount(value,limit,esc){
 const count=[...(value??'')].length;
 return '<small class="length-count" data-length-count'+(count>limit?' role="alert"':'')+'>'+esc(message(count,limit))+'</small>';
}

export function updateLengthCount(field){
 const limit=Number(field?.dataset?.lengthLimit);if(!Number.isSafeInteger(limit)||limit<1)return false;
 const node=field.parentElement?.querySelector('[data-length-count]');if(!node)return true;
 const count=[...field.value].length;node.textContent=message(count,limit);
 if(count>limit)node.setAttribute('role','alert');else node.removeAttribute('role');
 field.setAttribute('aria-invalid',String(count>limit));
 return true;
}

// Dialogs may stop input events; the count listens before they do.
if(typeof document!=='undefined')document.addEventListener('input',event=>updateLengthCount(event.target),true);
