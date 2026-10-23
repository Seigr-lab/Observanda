// Clipboard interpretation is explicit. A sender's resource policy never changes
// the receiving editor's policy. Units and evidence references remain separate.
import {validNumeralContext} from './numeral-context.js';
import {supportedValue} from './measurement-model.js';
import {exactRational} from './measurement-rational.js';
import {DatasetResourceBudget} from './dataset-resource-budget.js';
import {validDatasetResourcePolicy,DatasetResourceError} from './dataset-resource-policy.js';

export const NUMERAL_CLIPBOARD_PREFIX='observanda-value:';
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const contextValid=value=>validNumeralContext(value)||keys(value,['version','representation','radix'])&&value.version===1&&value.representation==='text'&&value.radix===10;
export class NumeralClipboardError extends Error {
 constructor(){super('The copied value has an unsupported or invalid spelling or interpretation.');this.name='NumeralClipboardError';this.code='NUMERAL_CLIPBOARD_INVALID';}
}
function checked(value,resourcePolicy){
 if(!keys(value,['spelling','context'])||!contextValid(value.context))throw new NumeralClipboardError();
 if(resourcePolicy===undefined){if(!supportedValue(value.spelling,value.context.representation,value.context.radix))throw new NumeralClipboardError();}
 else{
  if(!validDatasetResourcePolicy(resourcePolicy))throw new NumeralClipboardError();
  if(typeof value.spelling!=='string')throw new NumeralClipboardError();
  if(value.spelling.length>resourcePolicy.resources.maxScalarCharacters)throw new DatasetResourceError();
  try{
   if(value.context.representation==='text'){if(!supportedValue(value.spelling,'text',10))throw new NumeralClipboardError();}
   if(value.context.representation!=='text'){const budget=new DatasetResourceBudget(resourcePolicy);budget.run(()=>exactRational(value.spelling,value.context.representation,value.context.radix,budget));}
  }catch(error){if(error.code==='DATASET_CALCULATION_RESOURCE')throw error;throw new NumeralClipboardError();}
 }
 return {spelling:value.spelling,context:{version:1,representation:value.context.representation,radix:value.context.radix}};
}
export function validNumeralClipboardValue(value,{resourcePolicy}={}){try{checked(value,resourcePolicy);return true;}catch{return false;}}
export function encodeNumeralClipboard(value,{resourcePolicy}={}){
 return NUMERAL_CLIPBOARD_PREFIX+JSON.stringify({format:'observanda-value',version:resourcePolicy===undefined?1:2,...checked(value,resourcePolicy),...(resourcePolicy===undefined?{}:{resourcePolicy:structuredClone(resourcePolicy)})});
}
export function decodeNumeralClipboard(source,{resourcePolicy}={}){
 if(typeof source!=='string')throw new NumeralClipboardError();
 const marked=source.trimStart();
 if(!marked.startsWith(NUMERAL_CLIPBOARD_PREFIX))return {kind:'plain',spelling:source};
 let payload;try{payload=JSON.parse(marked.slice(NUMERAL_CLIPBOARD_PREFIX.length));}catch{throw new NumeralClipboardError();}
 const policy=payload?.version===2;
 if(!keys(payload,['format','version','spelling','context',...(policy?['resourcePolicy']:[])])||payload.format!=='observanda-value'||![1,2].includes(payload.version)||policy&&!validDatasetResourcePolicy(payload.resourcePolicy))throw new NumeralClipboardError();
 const value={spelling:payload.spelling,context:payload.context};
 // Check the destination first, so an incoming allowance cannot authorize more
 // work than that editor admits. Format 1 retains its original validation too.
 const result=checked(value,resourcePolicy);
 checked(value,policy?payload.resourcePolicy:undefined);
 return {kind:'typed',...result,...(policy?{resourcePolicy:structuredClone(payload.resourcePolicy)}:{})};
}
