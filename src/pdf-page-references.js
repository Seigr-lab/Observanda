import {createHash} from 'node:crypto';
import {PdfLayoutError} from './web/pdf-layout-model.js';
const maximumBytes=64*1024*1024,maximumReferences=12000,origin='https://pdf-reference.invalid/',stateKey='observanda.pdf.pageReferences';
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(value);
export function validPdfPageReferences(refs){
 return Array.isArray(refs)&&refs.length<=maximumReferences&&new Set(refs.map(ref=>ref?.id)).size===refs.length&&refs.every(ref=>ref&&typeof ref==='object'&&!Array.isArray(ref)&&Object.keys(ref).sort().join()==='id,start,style,target'&&safeId(ref.id)&&safeId(ref.target)&&ref.id!==ref.target&&['decimal','lower-roman','upper-roman'].includes(ref.style)&&Number.isInteger(ref.start)&&ref.start>=1&&ref.start<=9999);
}
function validate(refs){if(!validPdfPageReferences(refs))throw new PdfLayoutError('PDF_PAGE_REFERENCES');}
const tokens=refs=>refs.map((ref,index)=>createHash('sha256').update(JSON.stringify([index,ref.id,ref.target])).digest('hex'));
export function formatPdfPageReference(pageIndex,style,start){
 if(!Number.isSafeInteger(pageIndex)||pageIndex<0||!['decimal','lower-roman','upper-roman'].includes(style)||!Number.isInteger(start)||start<1||start>9999||!Number.isSafeInteger(pageIndex+start))throw new PdfLayoutError('PDF_PAGE_REFERENCES');
 let value=pageIndex+start;if(style==='decimal'||value>3999)return String(value);
 let result='';for(const [amount,roman] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']])while(value>=amount){result+=roman;value-=amount;}
 return style==='lower-roman'?result.toLowerCase():result;
}
// These functions execute only in the isolated, already loaded renderer. They
// never fetch a marker URL; the first-pass appendix exists only to emit links.
function installMeasurement(refs,markers,key){
 const fail=()=>{throw Object.assign(Error('PDF_PAGE_REFERENCES'),{code:'PDF_PAGE_REFERENCES'});},symbol=Symbol.for(key),appendixId='pdf-reference-measurement',styleId=appendixId+'-style';
 if(!refs.length)return {references:0};
 if(globalThis[symbol]||document.getElementById(appendixId)||document.getElementById(styleId))fail();
 const ids=new Map();for(const node of document.querySelectorAll('[id]')){const values=ids.get(node.id)??[];values.push(node);ids.set(node.id,values);}
 const fields=refs.map(ref=>{const candidates=ids.get(ref.id),targets=ids.get(ref.target);if(candidates?.length!==1||targets?.length!==1)fail();const node=candidates[0],box=node.getBoundingClientRect();if(node.children.length||box.width<=0||box.height<=0)fail();return {node,text:node.textContent,width:box.width,height:box.height};});
 const state={fields,refs,appendix:null,style:null};globalThis[symbol]=state;
 try{
  for(const field of fields){field.node.textContent='0';const box=field.node.getBoundingClientRect();if(Math.abs(box.width-field.width)>.1||Math.abs(box.height-field.height)>.1)fail();}
  const style=document.createElement('style');style.id=styleId;style.textContent='@page observandaPdfReferenceMeasurement{size:210mm 297mm;margin:15mm;@top-left{content:none}@top-center{content:none}@top-right{content:none}@bottom-left{content:none}@bottom-center{content:none}@bottom-right{content:none}}#'+appendixId+'{page:observandaPdfReferenceMeasurement!important;break-before:page!important;break-after:auto!important;display:block!important;position:static!important;columns:1!important;column-count:1!important;writing-mode:horizontal-tb!important;direction:ltr!important;margin:0!important;padding:0!important;transform:none!important;font:10pt monospace!important;color:#000!important}#'+appendixId+'>div{display:block!important;position:static!important;height:18pt!important;line-height:18pt!important;white-space:nowrap!important;break-inside:avoid!important;margin:0!important;padding:0!important}#'+appendixId+' a{display:inline-block!important;position:static!important;width:100pt!important;height:14pt!important;line-height:14pt!important;white-space:nowrap!important;vertical-align:top!important;margin:0 10pt 0 0!important;padding:0!important;border:0!important;font:10pt/14pt monospace!important;color:#000!important;text-decoration:none!important}';document.head.append(style);state.style=style;
  const appendix=document.createElement('section');appendix.id=appendixId;state.appendix=appendix;
  for(let index=0;index<refs.length;index++){const row=document.createElement('div'),marker=document.createElement('a'),destination=document.createElement('a');marker.href='https://pdf-reference.invalid/'+markers[index];marker.textContent='Marker';destination.href='#'+refs[index].target;destination.textContent='Destination';row.append(marker,destination);appendix.append(row);}document.body.append(appendix);
  return {references:refs.length};
 }catch(error){state.appendix?.remove();state.style?.remove();for(const field of fields)field.node.textContent=field.text;delete globalThis[symbol];throw error;}
}
function cleanupMeasurement(key){const symbol=Symbol.for(key),state=globalThis[symbol];if(!state)return;state.appendix?.remove();state.style?.remove();for(const field of state.fields)field.node.textContent=field.text;delete globalThis[symbol];}
function applyMeasurement(refs,labels,key){
 const fail=()=>{throw Object.assign(Error('PDF_PAGE_REFERENCES'),{code:'PDF_PAGE_REFERENCES'});},symbol=Symbol.for(key),state=globalThis[symbol];if(!refs.length)return {references:0};
 if(!state||JSON.stringify(state.refs)!==JSON.stringify(refs))fail();
 try{
  state.appendix.remove();state.style.remove();
  for(let index=0;index<state.fields.length;index++){const field=state.fields[index];if(!field.node.isConnected)fail();field.node.textContent=labels[index].label;const box=field.node.getBoundingClientRect();if(Math.abs(box.width-field.width)>.1||Math.abs(box.height-field.height)>.1||field.node.scrollWidth>field.node.clientWidth+1)fail();}
  delete globalThis[symbol];return {references:refs.length};
 }catch(error){for(const field of state.fields)field.node.textContent=field.text;delete globalThis[symbol];throw error;}
}
const script=(fn,args)=>'('+fn.toString()+')('+args.map(value=>JSON.stringify(value).replace(/</g,'\\u003c')).join(',')+')';
export function pdfPageReferenceMeasurementScript(refs){validate(refs);return script(installMeasurement,[refs,tokens(refs),stateKey]);}
export const pdfPageReferenceCleanupScript=script(cleanupMeasurement,[stateKey]);
export function pdfPageReferenceApplyScript(refs,measurement){
 validate(refs);if(!measurement||!Number.isSafeInteger(measurement.pages)||measurement.pages<0||!Array.isArray(measurement.labels)||measurement.labels.length!==refs.length)throw new PdfLayoutError('PDF_PAGE_REFERENCES');
 for(let index=0;index<refs.length;index++){const ref=refs[index],label=measurement.labels[index];if(!label||label.id!==ref.id||label.target!==ref.target||!Number.isSafeInteger(label.pageIndex)||label.pageIndex<0||label.pageIndex>=measurement.pages||label.label!==formatPdfPageReference(label.pageIndex,ref.style,ref.start))throw new PdfLayoutError('PDF_PAGE_REFERENCES');}
 return script(applyMeasurement,[refs,measurement.labels,stateKey]);
}
const rectangle=value=>Array.isArray(value)&&value.length===4&&value.every(Number.isFinite)&&value[2]>value[0]&&value[3]>value[1];
const sameRow=(a,b)=>Math.abs(a[1]-b[1])<=.25&&Math.abs(a[3]-b[3])<=.25&&b[0]>=a[2]-.25&&b[0]-a[2]<=120;
let library;
export async function extractPdfPageReferences(bytes,refs,{signal,maxBytes=maximumBytes}={}){
 validate(refs);signal?.throwIfAborted();if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>maximumBytes)throw new PdfLayoutError('PDF_PAGE_REFERENCES');
 if(!(bytes instanceof Uint8Array))throw new PdfLayoutError('PDF_PAGE_REFERENCES');if(bytes.byteLength>maxBytes)throw new PdfLayoutError('PDF_CAPACITY');
 if(Buffer.from(bytes.buffer,bytes.byteOffset,Math.min(5,bytes.byteLength)).toString()!=='%PDF-')throw new PdfLayoutError('PDF_PAGE_REFERENCES');
 const pdf=await(library??=import('pdfjs-dist/legacy/build/pdf.mjs'));signal?.throwIfAborted();
 const task=pdf.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,useWasm:false,useWorkerFetch:false,isOffscreenCanvasSupported:false,disableAutoFetch:true,disableStream:true,stopAtErrors:true}),abort=()=>{void task.destroy().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
 try{
  const document=await task.promise;signal?.throwIfAborted();const expected=new Map(tokens(refs).map((token,index)=>[origin+token,index])),found=new Map(),appendixPages=new Set(),pageCache=new Map();
  async function destinationIndex(destination){
   if(typeof destination==='string')destination=await document.getDestination(destination);signal?.throwIfAborted();if(!Array.isArray(destination)||destination.length<2)throw new PdfLayoutError('PDF_PAGE_REFERENCES');
   const ref=destination[0];let index;if(Number.isInteger(ref))index=ref;else if(ref&&Number.isInteger(ref.num)&&ref.num>0&&Number.isInteger(ref.gen)&&ref.gen>=0){const key=ref.num+':'+ref.gen;if(!pageCache.has(key))pageCache.set(key,await document.getPageIndex(ref));index=pageCache.get(key);}else throw new PdfLayoutError('PDF_PAGE_REFERENCES');
   if(!Number.isSafeInteger(index)||index<0||index>=document.numPages)throw new PdfLayoutError('PDF_PAGE_REFERENCES');return index;
  }
  for(let pageIndex=0;pageIndex<document.numPages;pageIndex++){
   signal?.throwIfAborted();const page=await document.getPage(pageIndex+1);
   try{
    const annotations=await page.getAnnotations(),markers=annotations.filter(value=>value.subtype==='Link'&&typeof(value.url??value.unsafeUrl)==='string'&&(value.url??value.unsafeUrl).startsWith(origin));signal?.throwIfAborted();if(!markers.length)continue;
    appendixPages.add(pageIndex);const used=new Set();
    for(const marker of markers){const url=marker.url??marker.unsafeUrl,index=expected.get(url);if(index===undefined||found.has(index)||!rectangle(marker.rect))throw new PdfLayoutError('PDF_PAGE_REFERENCES');
     const candidates=annotations.filter(value=>value!==marker&&value.subtype==='Link'&&value.dest&&!value.url&&rectangle(value.rect)&&sameRow(marker.rect,value.rect));if(candidates.length!==1||used.has(candidates[0]))throw new PdfLayoutError('PDF_PAGE_REFERENCES');used.add(marker);used.add(candidates[0]);found.set(index,await destinationIndex(candidates[0].dest));
    }
    if(annotations.length!==used.size)throw new PdfLayoutError('PDF_PAGE_REFERENCES');
   }finally{page.cleanup();}
  }
  signal?.throwIfAborted();if(found.size!==refs.length)throw new PdfLayoutError('PDF_PAGE_REFERENCES');
  if(!refs.length)return {pages:document.numPages,labels:[]};
  const pages=Math.min(...appendixPages);if(pages<1||document.numPages-pages!==appendixPages.size||[...found.values()].some(index=>index>=pages))throw new PdfLayoutError('PDF_PAGE_REFERENCES');
  return {pages,labels:refs.map((ref,index)=>({id:ref.id,target:ref.target,pageIndex:found.get(index),label:formatPdfPageReference(found.get(index),ref.style,ref.start)}))};
 }catch(error){signal?.throwIfAborted();if(error instanceof PdfLayoutError)throw error;throw new PdfLayoutError('PDF_PAGE_REFERENCES');}
 finally{signal?.removeEventListener('abort',abort);await task.destroy().catch(()=>{});}
}
