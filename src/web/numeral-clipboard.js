// Clipboard values carry an explicit interpretation; plain text has none.
// Only spelling/context travel here. Units and evidence references remain separate.
import {validNumeralContext} from './numeral-context.js';
import {supportedValue} from './measurement-model.js';

export const NUMERAL_CLIPBOARD_PREFIX='observanda-value:';
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const contextValid=value=>validNumeralContext(value)||keys(value,['version','representation','radix'])&&value.version===1&&value.representation==='text'&&value.radix===10;
export class NumeralClipboardError extends Error {
 constructor(){super('The copied value has an unsupported or invalid spelling or interpretation.');this.name='NumeralClipboardError';this.code='NUMERAL_CLIPBOARD_INVALID';}
}
export function validNumeralClipboardValue(value){
 return !!(keys(value,['spelling','context'])&&contextValid(value.context)&&supportedValue(value.spelling,value.context.representation,value.context.radix));
}
function checked(value){
 if(!validNumeralClipboardValue(value))throw new NumeralClipboardError();
 return {spelling:value.spelling,context:{version:1,representation:value.context.representation,radix:value.context.radix}};
}
export function encodeNumeralClipboard(value){
 return NUMERAL_CLIPBOARD_PREFIX+JSON.stringify({format:'observanda-value',version:1,...checked(value)});
}
export function decodeNumeralClipboard(source){
 if(typeof source!=='string')throw new NumeralClipboardError();
 const marked=source.trimStart();
 if(!marked.startsWith(NUMERAL_CLIPBOARD_PREFIX))return {kind:'plain',spelling:source};
 let payload;try{payload=JSON.parse(marked.slice(NUMERAL_CLIPBOARD_PREFIX.length));}catch{throw new NumeralClipboardError();}
 if(!keys(payload,['format','version','spelling','context'])||payload.format!=='observanda-value'||payload.version!==1)throw new NumeralClipboardError();
 return {kind:'typed',...checked({spelling:payload.spelling,context:payload.context})};
}