import {parse,defaultTreeAdapter} from 'parse5';
import {selectorLimits} from './selector-contract.js';
import {checkSourceSignal} from './source-files.js';

// HTML parsing is inert. Template contents are not document anchors; scripts,
// comments and styles cannot invent anchors. No URL is fetched by parse5.
export async function verifyHTMLSelectors(chunks,selectors,{signal}={}){
 let source='',nodes=0;for await(const text of chunks){checkSourceSignal(signal);source+=text;}
 const budget=()=>{if(++nodes>selectorLimits.htmlNodes)throw Object.assign(new Error(),{selectorCode:'selector-limit'});};
 const adapter={...defaultTreeAdapter};
 for(const method of ['createElement','createCommentNode','createDocumentFragment','insertText','insertTextBefore'])adapter[method]=(...args)=>{budget();return defaultTreeAdapter[method](...args);};
 const document=parse(source,{sourceCodeLocationInfo:true,treeAdapter:adapter}),found=new Map(selectors.map(s=>[s.value,[]])),pending=[document];
 while(pending.length){
  checkSourceSignal(signal);const element=pending.pop(),attrs=element.attrs??[],id=attrs.find(a=>a.name==='id')?.value,name=element.tagName==='a'?attrs.find(a=>a.name==='name')?.value:undefined;
  if(element.tagName==='meta'){
   const charset=attrs.find(a=>a.name==='charset')?.value,
    legacy=attrs.find(a=>a.name==='http-equiv')?.value.toLowerCase()==='content-type'?attrs.find(a=>a.name==='content')?.value.match(/charset\s*=\s*["']?\s*([^\s;"']+)/i)?.[1]:undefined;
   if([charset,legacy].some(value=>value!==undefined&&!/^utf-?8$/i.test(value.trim())))throw Object.assign(new Error(),{selectorCode:'selector-encoding'});
  }
  for(const value of new Set([id,name]))if(found.has(value))found.get(value).push(element);
  if(element.childNodes)pending.push(...element.childNodes);
 }
 return selectors.map(s=>{
  const matches=found.get(s.value);
  if(matches.length!==1)return {status:'blocked',code:matches.length?'selector-ambiguous':'selector-missing'};
  const element=matches[0],location=element.sourceCodeLocation;
  if(!location||!Number.isSafeInteger(location.endOffset))return {status:'blocked',code:'selector-boundary'};
  return {status:'verified',element:element.tagName,range:{unit:'utf16',start:location.startOffset,end:location.endOffset}};
 });
}
