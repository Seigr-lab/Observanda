import {t} from './i18n/index.js';
import {NUMERAL_CLIPBOARD_PREFIX,encodeNumeralClipboard,decodeNumeralClipboard} from './numeral-clipboard.js';
import {validDatasetResourcePolicy} from './dataset-resource-policy.js';
export const numeralClipboardText=key=>t('numeralClipboard',key);
const text=numeralClipboardText;
export const copyNumeralClipboard=(value,clipboard,options)=>clipboard.writeText(encodeNumeralClipboard(value,options));
export function numeralClipboardControls({esc,copy=true,paste=true}={}){
 return '<div class="numeral-clipboard">'+(copy?'<button type="button" class="button" data-numeral-copy>'+esc(text('copy'))+'</button>':'')+(paste?'<button type="button" class="button" data-numeral-paste>'+esc(text('paste'))+'</button>':'')+'<p>'+esc(text('scope'))+'</p><p data-numeral-status role="status"></p></div>';
}
// Listeners are delegated so condition editors can replace their own operands.
export function wireNumeralClipboard(root,{fields,read=null,guard=()=>{},available=()=>true,validate=null,maxLength=8192,resourcePolicy}={}){
 let active=true,request=0;const controller=new AbortController();
 const current=control=>active&&root.isConnected&&available(control);
 const policy=control=>{try{const value=typeof resourcePolicy==='function'?resourcePolicy(control):resourcePolicy;if(value!==undefined&&!validDatasetResourcePolicy(value))throw Error();return value;}catch{refuse('NUMERAL_CLIPBOARD_CHANGED');}};
 const snapshot=control=>JSON.stringify({value:value(control),resourcePolicy:policy(control)});
 const value=control=>{if(read)return read(control);const f=fields(control);return {spelling:f.spelling.value,context:f.context??{version:1,representation:f.representation.value,radix:['radix','radix-fraction'].includes(f.representation.value)?Number(f.radix.value):10}};};
 const status=(control,key,error=false)=>{if(!current(control))return;const scope=control.closest('.numeral-clipboard,[data-numeral-scope]')??fields?.(control)?.spelling.parentElement.parentElement;const node=scope?.querySelector('[data-numeral-status]')??root.querySelector('[data-numeral-status]');if(node){node.textContent=text(key);node.setAttribute('role',error?'alert':'status');}};
 const failure=(control,error)=>status(control,error.code==='DATASET_CALCULATION_RESOURCE'?'resource':error.code==='NUMERAL_CLIPBOARD_INVALID'?'invalid':error.code==='NUMERAL_CLIPBOARD_CONTEXT'?'contextMismatch':error.code==='NUMERAL_CLIPBOARD_CHANGED'?'changed':error.code==='NUMERAL_CLIPBOARD_LENGTH'?'length':error.code==='NUMERAL_CLIPBOARD_LINES'?'lines':'unavailable',true);
 const refuse=code=>{throw Object.assign(Error(code),{code});};
 function apply(control,payload){
  const f=fields(control);if(!f?.spelling)refuse('NUMERAL_CLIPBOARD_INVALID');const destination=policy(control),maximum=Math.min(maxLength,destination?.resources.maxScalarCharacters??maxLength),limit=f.spelling.maxLength>=0?Math.min(maximum,f.spelling.maxLength):maximum;
  if(payload.spelling.length>limit)refuse('NUMERAL_CLIPBOARD_LENGTH');if(f.spelling.tagName==='INPUT'&&/[\r\n]/.test(payload.spelling))refuse('NUMERAL_CLIPBOARD_LINES');
  validate?.(payload,f);
  if(payload.kind==='typed'&&!f.context&&![...f.representation.options].some(option=>option.value===payload.context.representation))refuse('NUMERAL_CLIPBOARD_INVALID');
  if(payload.kind==='typed'&&!f.context){f.representation.value=payload.context.representation;f.radix.value=String(payload.context.radix);}
  f.spelling.value=payload.spelling;for(const node of [f.spelling,...(payload.kind==='typed'&&!f.context?[f.representation,f.radix]:[])])for(const name of ['input','change'])node.dispatchEvent(new root.ownerDocument.defaultView.Event(name,{bubbles:true}));
  status(control,payload.kind==='typed'?'pasted':'plain');
 }
 root.addEventListener('click',event=>{
  const control=event.target.closest('[data-numeral-copy],[data-numeral-paste]');if(!control||!root.contains(control)||fields&&!fields(control))return;event.preventDefault();event.stopPropagation();
  void (async()=>{try{if(!current(control))return;guard();const ticket=++request,before=snapshot(control),input=fields?.(control)?.spelling,clipboard=root.ownerDocument.defaultView.navigator.clipboard;
   if(control.hasAttribute('data-numeral-copy')){await copyNumeralClipboard(value(control),clipboard,{resourcePolicy:policy(control)});guard();if(current(control)&&ticket===request&&control.isConnected)status(control,'copied');}
   else{const raw=await clipboard.readText();guard();if(!current(control)||ticket!==request||!control.isConnected)return;let after;try{after=snapshot(control);}catch{refuse('NUMERAL_CLIPBOARD_CHANGED');}if(fields?.(control)?.spelling!==input||after!==before)refuse('NUMERAL_CLIPBOARD_CHANGED');apply(control,decodeNumeralClipboard(raw,{resourcePolicy:policy(control)}));}
  }catch(error){failure(control,error);}})();
 },{signal:controller.signal});
 root.addEventListener('paste',event=>{
  const f=fields?.(event.target);if(!f||f.spelling!==event.target)return;let payload;
  try{const raw=event.clipboardData.getData('text/plain');if(!raw.trimStart().startsWith(NUMERAL_CLIPBOARD_PREFIX))return;event.preventDefault();if(!current(event.target))return;guard();payload=decodeNumeralClipboard(raw,{resourcePolicy:policy(event.target)});request++;apply(event.target,payload);}
  catch(error){event.preventDefault();failure(event.target,error);}
 },{signal:controller.signal});
 return ()=>{active=false;request++;controller.abort();};
}
