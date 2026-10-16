import {parse,defaultTreeAdapter} from 'parse5';
import {importBookHTML} from './book-content.js';
import {AppError} from '../errors.js';
import {selectedJSON} from '../structured-selection.js';
import {selectorLimits} from './selector-contract.js';
export {sourceAttributes,selectedJSON} from '../structured-selection.js';
const fail=()=>{throw new AppError('IMPORT_CONTENT');};
const maximum=60000;
async function boundedText(chunks,limit,{signal}={}){
 const decoder=new TextDecoder('utf-8',{fatal:true});let result='';
 try{for await(const chunk of chunks){signal?.throwIfAborted();result+=decoder.decode(chunk,{stream:true});if(result.length>limit)fail();}result+=decoder.decode();}
 catch(error){if(signal?.aborted||error instanceof AppError)throw error;fail();}
 if(result.length>limit||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(result))fail();return result;
}

// The caller supplies authenticated staged bytes. Boundary selection and text
// conversion are separate choices; binary originals need no prose conversion.
export async function importContent(content,file,mode,{signal}={}){
 if(mode==='original')return {body:'',conversion:'original',omitted:[]};
 const s=file.selector,start=s.kind==='bytes'?s.offset:0,end=s.kind==='bytes'?s.offset+s.length-1:content.size-1;
 const chunks=()=>content.read(start,end,{signal});
 if(s.kind==='json-pointer'||mode==='json'){
  if(s.kind==='anchor'||mode!=='json')fail();
  return {body:await selectedJSON(chunks(),s.kind==='json-pointer'?s.value:'',{signal}),conversion:'json',omitted:[]};
 }
 let source=await boundedText(chunks(),['html','html-book'].includes(mode)?selectorLimits.htmlBytes:maximum,{signal});
 if(mode==='text'){if(s.kind==='anchor')fail();return {body:source,conversion:'text',omitted:[]};}
 if(!['html','html-book'].includes(mode))fail();
 let allocated=0;const adapter={...defaultTreeAdapter};
 for(const name of ['createElement','createCommentNode','createDocumentFragment','insertText','insertTextBefore'])adapter[name]=(...args)=>{if(++allocated>selectorLimits.htmlNodes)fail();return defaultTreeAdapter[name](...args);};
 const doc=parse(source,{sourceCodeLocationInfo:true,treeAdapter:adapter});let root=doc;
 const visit=(node,operation)=>{const pending=[node];while(pending.length){const n=pending.pop();operation(n);for(const child of n.childNodes??[])pending.push(child);}};
 if(s.kind==='anchor'){
  const matches=[];visit(doc,n=>{if((n.attrs??[]).some(a=>a.name==='id'&&a.value===s.value||n.tagName==='a'&&a.name==='name'&&a.value===s.value))matches.push(n);});
  if(matches.length!==1)fail();root=matches[0];
 }
 if(mode==='html-book')return importBookHTML(root,source,file);
 let body='';const omissions=new Map(),omit=name=>omissions.set(name,(omissions.get(name)??0)+1),pending=[{node:root,exit:false}];
 while(pending.length){
  const {node:n,exit}=pending.pop();
  if(exit){if(['td','th'].includes(n.tagName))body+='\t';else if(['p','div','section','article','li','h1','h2','h3','h4','h5','h6','br','tr'].includes(n.tagName))body+='\n';continue;}
  if(['script','style','template','iframe','object','embed','form','input','button'].includes(n.tagName)){omit(n.tagName);continue;}
  if(n.attrs?.some(a=>a.name==='hidden')){omit('hidden-element');continue;}
  if(n.nodeName==='#text')body+=n.value;
  if(n.tagName==='img'){const alt=n.attrs.find(a=>a.name==='alt')?.value;if(alt)body+=alt;omit('image');}
  if(n.tagName==='a'&&n.attrs?.some(a=>a.name==='href'))omit('link-target');
  if(['table','pre','ul','ol'].includes(n.tagName))omit(n.tagName+'-formatting');
  pending.push({node:n,exit:true});for(let i=(n.childNodes?.length??0)-1;i>=0;i--)pending.push({node:n.childNodes[i],exit:false});
  if(body.length>maximum)fail();
 }
 if(body.length>maximum)fail();return {body,conversion:'html-text',omitted:[...omissions].map(([element,count])=>({element,count}))};
}
