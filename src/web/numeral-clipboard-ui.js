import {t} from './i18n/index.js';
import {encodeNumeralClipboard,decodeNumeralClipboard} from './numeral-clipboard.js';
export const numeralClipboardText=key=>t('numeralClipboard',key);
const text=numeralClipboardText;
export const copyNumeralClipboard=(value,clipboard)=>clipboard.writeText(encodeNumeralClipboard(value));
export function numeralClipboardControls({esc,copy=true,paste=true}={}){
 return '<div class="numeral-clipboard">'+(copy?'<button type="button" class="button" data-numeral-copy>'+esc(text('copy'))+'</button>':'')+(paste?'<button type="button" class="button" data-numeral-paste>'+esc(text('paste'))+'</button>':'')+'<p>'+esc(text('scope'))+'</p><p data-numeral-status role="status"></p></div>';
}
// Listeners are delegated so condition editors can replace their own operands.
export function wireNumeralClipboard(root,{fields,read=null,guard=()=>{},available=()=>true,maxLength=8192}={}){
 let active=true,request=0;const controller=new AbortController();
 const current=()=>active&&root.isConnected&&available();
 const value=control=>{if(read)return read(control);const f=fields(control);return {spelling:f.spelling.value,context:{version:1,representation:f.representation.value,radix:['radix','radix-fraction'].includes(f.representation.value)?Number(f.radix.value):10}};};
 const status=(control,key,error=false)=>{if(!current())return;const scope=control.closest('.numeral-clipboard')??fields?.(control)?.spelling.parentElement.parentElement;const node=scope?.querySelector('[data-numeral-status]')??root.querySelector('[data-numeral-status]');if(node){node.textContent=text(key);node.setAttribute('role',error?'alert':'status');}};
 const failure=(control,error)=>status(control,error.code==='NUMERAL_CLIPBOARD_INVALID'?'invalid':error.code==='NUMERAL_CLIPBOARD_CHANGED'?'changed':error.code==='NUMERAL_CLIPBOARD_LENGTH'?'length':error.code==='NUMERAL_CLIPBOARD_LINES'?'lines':'unavailable',true);
 const refuse=code=>{throw Object.assign(Error(code),{code});};
 function apply(control,payload){
  const f=fields(control);if(!f?.spelling)refuse('NUMERAL_CLIPBOARD_INVALID');const limit=f.spelling.maxLength>=0?Math.min(maxLength,f.spelling.maxLength):maxLength;
  if(payload.spelling.length>limit)refuse('NUMERAL_CLIPBOARD_LENGTH');if(f.spelling.tagName==='INPUT'&&/[\r\n]/.test(payload.spelling))refuse('NUMERAL_CLIPBOARD_LINES');
  if(payload.kind==='typed'&&![...f.representation.options].some(option=>option.value===payload.context.representation))refuse('NUMERAL_CLIPBOARD_INVALID');
  if(payload.kind==='typed'){f.representation.value=payload.context.representation;f.radix.value=String(payload.context.radix);}
  f.spelling.value=payload.spelling;for(const node of [f.spelling,...(payload.kind==='typed'?[f.representation,f.radix]:[])])for(const name of ['input','change'])node.dispatchEvent(new root.ownerDocument.defaultView.Event(name,{bubbles:true}));
  status(control,payload.kind==='typed'?'pasted':'plain');
 }
 root.addEventListener('click',event=>{
  const control=event.target.closest('[data-numeral-copy],[data-numeral-paste]');if(!control||!root.contains(control))return;event.preventDefault();event.stopPropagation();
  void (async()=>{try{if(!current())return;guard();const ticket=++request,snapshot=JSON.stringify(value(control)),clipboard=root.ownerDocument.defaultView.navigator.clipboard;
   if(control.hasAttribute('data-numeral-copy')){await copyNumeralClipboard(value(control),clipboard);guard();if(current()&&ticket===request&&control.isConnected)status(control,'copied');}
   else{const raw=await clipboard.readText();guard();if(!current()||ticket!==request||!control.isConnected)return;if(JSON.stringify(value(control))!==snapshot)refuse('NUMERAL_CLIPBOARD_CHANGED');apply(control,decodeNumeralClipboard(raw));}
  }catch(error){failure(control,error);}})();
 },{signal:controller.signal});
 root.addEventListener('paste',event=>{
  const f=fields?.(event.target);if(!f||f.spelling!==event.target)return;let payload;
  try{payload=decodeNumeralClipboard(event.clipboardData.getData('text/plain'));if(payload.kind==='plain')return;event.preventDefault();if(!current())return;guard();request++;apply(event.target,payload);}
  catch(error){event.preventDefault();failure(event.target,error);}
 },{signal:controller.signal});
 return ()=>{active=false;request++;controller.abort();};
}
