import {parentPort,workerData} from 'node:worker_threads';
import {inflateSync} from 'node:zlib';
import {PDFDocument,PDFName,PDFDict,PDFArray,PDFRawStream,PDFHexString} from '@cantoo/pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {formatPdfPageReference} from './pdf-page-references.js';
const name=PDFName.of,fail=()=>Object.assign(new Error('PDF_ACCESSIBILITY_FAILED'),{code:'PDF_ACCESSIBILITY_FAILED'});
const normal=text=>text.replace(/\s+/gu,' ').trim(),escape=text=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
function decoded(stream,maxBytes){
 if(!(stream instanceof PDFRawStream))throw fail();const filter=stream.dict.get(name('Filter'));let bytes;
 if(filter===undefined)bytes=Buffer.from(stream.contents);else if(String(filter)==='/FlateDecode'&&!stream.dict.has(name('DecodeParms')))bytes=inflateSync(stream.contents,{maxOutputLength:maxBytes});else return null;
 if(bytes.length>maxBytes)throw fail();return bytes.toString('latin1');
}
// Conservative lexical reader: strings, dictionaries, arrays, names and comments
// are operands, never operator matches. Unknown inline-image syntax is left alone.
function textRanges(source){
 let at=0,marks=0,text=null;const ranges=[],space=char=>char!==undefined&&/[\x00\t\n\f\r ]/.test(char),delimiter=char=>char===undefined||space(char)||/[()[\]<>/%]/.test(char);
 function skip(){while(at<source.length){if(space(source[at]))at++;else if(source[at]==='%'){while(at<source.length&&!/[\r\n]/.test(source[at]))at++;}else break;}}
 function operand(depth=0){if(depth>128)throw fail();skip();const start=at,c=source[at++];if(c==='('){let nested=1;while(at<source.length&&nested){const c=source[at++];if(c==='\\')at++;else if(c==='(')nested++;else if(c===')')nested--;}if(nested)throw fail();return null;}
  if(c==='['||c==='<'&&source[at]==='<'){const end=c==='['?']':'>>';if(c==='<')at++;while(true){skip();if(source.startsWith(end,at)){at+=end.length;break;}if(at>=source.length)throw fail();operand(depth+1);}return null;}
  if(c==='<'){while(at<source.length&&source[at]!=='>')at++;if(at>=source.length)throw fail();at++;return null;}
  if(c==='/'){while(!delimiter(source[at]))at++;return null;}
  if(/[\]>)]/.test(c??''))throw fail();while(!delimiter(source[at]))at++;if(at===start)throw fail();return source.slice(start,at);
 }
 while(at<source.length){skip();if(at>=source.length)break;const start=at,token=operand();if(token===null)continue;if(token==='BI')return null;
  if(token==='BMC'||token==='BDC'){marks++;if(text)text.safe=false;}
  else if(token==='EMC'){if(--marks<0)throw fail();if(text)text.safe=false;}
  else if(token==='BT'){if(text)throw fail();text={start,safe:marks===0,shown:false};}
  else if(token==='ET'){if(!text)throw fail();if(text.safe&&text.shown)ranges.push([text.start,at]);text=null;}
  else if(['Tj','TJ',"'",'"'].includes(token)){if(!text)throw fail();text.shown=true;}
 }
 if(text||marks)throw fail();return ranges;
}
function runningPage(page,items,layouts,index,total){
 const [x,y,right,top]=page.view,width=right-x,height=top-y,scale=72/25.4,matching=(layouts??[]).filter(row=>Math.abs(row.widthMm*scale-width)<1&&Math.abs(row.heightMm*scale-height)<1);
 if(page.rotate!==0||page.userUnit!==1||!matching.length||!items.length)return false;
 const expected=new Set(matching.flatMap(row=>(row.runningText??[]).map(value=>normal(value.replace(/\{(page|pages)\}/g,(_,key)=>formatPdfPageReference(key==='page'?index:total-1,row.numberStyle??'decimal',key==='page'?row.numberStart??1:1))))));
 return items.every(item=>{
  const t=item.transform;if(Math.abs(t[1])>.001||Math.abs(t[2])>.001||!expected.has(normal(item.str)))return false;
  // A full em below/above the baseline is conservative for all bundled faces.
  const bounds={left:t[4]-1,right:t[4]+item.width+1,bottom:t[5]-item.height,top:t[5]+item.height*1.25};
  return matching.every(row=>bounds.right<x+row.margins.left*scale||bounds.left>right-row.margins.right*scale||bounds.top<y+row.margins.bottom*scale||bounds.bottom>top-row.margins.top*scale);
 });
}
async function apply(){
 const {bytes,maxBytes,accessibilityLayout,identifyPdfUa}=workerData,document=await PDFDocument.load(bytes,{forIncrementalUpdate:true,updateMetadata:false,throwOnInvalidObject:true}),context=document.context;
 if(!document.getPageCount())throw fail();const loading=getDocument({data:Uint8Array.from(bytes),useSystemFonts:false,isEvalSupported:false,disableFontFace:true,maxImageSize:1}),pdf=await loading.promise;
 try{
  const links=new Map();let decodedBytes=0;
  for(let number=1;number<=pdf.numPages;number++){
   const page=await pdf.getPage(number),content=await page.getTextContent({includeMarkedContent:true}),marked=new Map(),stack=[],unmarked=[];
   for(const item of content.items){if(item.type==='beginMarkedContent'||item.type==='beginMarkedContentProps')stack.push(item.id??null);else if(item.type==='endMarkedContent')stack.pop();else if(typeof item.str==='string'){if(!stack.length&&normal(item.str))unmarked.push(item);for(const id of stack)if(id)marked.set(id,(marked.get(id)??'')+item.str+(item.hasEOL?'\n':''));}}
   const tree=await page.getStructTree(),annotations=await page.getAnnotations(),actual=new Set(annotations.filter(row=>row.subtype==='Link').map(row=>row.id));
   function link(node){if(!node)return;const ids=[],parts=[];function collect(child){if(child.type==='annotation')ids.push(child.id);else if(child.type==='content')parts.push(marked.get(child.id)??'');for(const nested of child.children??[])collect(nested);}
    if(node.role==='Link'){collect(node);const label=normal(node.alt??parts.join(''));if(label&&label.length<=65536)for(const id of ids){const ref=id.replace(/^pdfjs_internal_id_/,'');if(actual.has(ref)||actual.has(id)){const labels=links.get(ref)??new Set();labels.add(label);links.set(ref,labels);}}}
    for(const child of node.children??[])link(child);
   }link(tree);
   if(runningPage(page,unmarked,accessibilityLayout?.layouts,number-1,pdf.numPages)){
    const target=document.getPage(number-1),raw=target.node.get(name('Contents')),stored=context.lookup(raw),streams=stored instanceof PDFArray?stored.asArray():raw?[raw]:[],replacements=[];let usable=true,totalRanges=0;
    for(const ref of streams){const text=decoded(context.lookup(ref),maxBytes-decodedBytes);if(text===null){usable=false;break;}decodedBytes+=Buffer.byteLength(text,'latin1');const ranges=textRanges(text);if(ranges===null){usable=false;break;}totalRanges+=ranges.length;let output=text;for(const [start,end] of ranges.reverse())output=output.slice(0,start)+'/Artifact <</Type /Pagination>> BDC\n'+output.slice(start,end)+'\nEMC'+output.slice(end);replacements.push({ref,text:output,changed:ranges.length>0});}
    if(usable&&totalRanges)target.node.set(name('Contents'),context.obj(replacements.map(row=>row.changed?context.register(context.flateStream(Buffer.from(row.text,'latin1'))):row.ref)));
   }
  }
  for(const [ref,obj] of context.enumerateIndirectObjects()){
   if(!(obj instanceof PDFDict))continue;const key=ref.objectNumber+'R'+(ref.generationNumber||''),label=links.get(key);
   if(String(obj.get(name('Subtype')))==='/Link'&&!obj.has(name('Contents'))&&label)obj.set(name('Contents'),PDFHexString.fromText([...label].join(' ')));
   if(String(obj.get(name('S')))!=='/Figure'||obj.has(name('Alt'))||obj.has(name('ActualText')))continue;const kids=context.lookup(obj.get(name('K')));
   // HTML figure is a grouping container; its child image/SVG already has the
   // authored alternative. Preserve that child and caption as separate content.
   if(kids instanceof PDFArray){const values=kids.asArray().map(value=>context.lookup(value));if(values.length&&values.every(value=>value instanceof PDFDict&&String(value.get(name('Type')))==='/StructElem')&&values.filter(value=>String(value.get(name('S')))==='/Figure'&&(value.has(name('Alt'))||value.has(name('ActualText')))).length===1)obj.set(name('S'),name('Div'));}
  }
  const title=document.getTitle()??'',language=document.getLanguage()??'';document.catalog.getOrCreateViewerPreferences().setDisplayDocTitle(true);
  let xml;const existing=context.lookup(document.catalog.get(name('Metadata')));
  if(existing){const raw=decoded(existing,maxBytes);if(raw===null)throw fail();xml=Buffer.from(raw,'latin1').toString('utf8');if(identifyPdfUa&&!/pdfuaid:part/.test(xml)){if(!xml.includes('</rdf:RDF>'))throw fail();xml=xml.replace('</rdf:RDF>','<rdf:Description rdf:about="" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/" pdfuaid:part="1"/></rdf:RDF>');}else xml=null;}
  else xml='<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">'+escape(title)+'</rdf:li></rdf:Alt></dc:title><dc:language><rdf:Bag><rdf:li>'+escape(language)+'</rdf:li></rdf:Bag></dc:language></rdf:Description>'+(identifyPdfUa?'<rdf:Description rdf:about="" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/" pdfuaid:part="1"/>':'')+'</rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  if(xml!==null)document.catalog.set(name('Metadata'),context.register(context.stream(Buffer.from(xml,'utf8'),{Type:'Metadata',Subtype:'XML'})));
  const output=await document.save({useObjectStreams:false,addDefaultPage:false,updateFieldAppearances:false});if(output.length>maxBytes)throw Object.assign(fail(),{code:'PDF_CAPACITY'});if(output.length<=bytes.length||!Buffer.from(output.buffer,output.byteOffset,bytes.length).equals(Buffer.from(bytes)))throw fail();return output;
 }finally{await loading.destroy();}
}
try{const bytes=await apply();parentPort.postMessage({bytes},[bytes.buffer]);}catch(error){parentPort.postMessage({error:error?.code==='PDF_CAPACITY'?'PDF_CAPACITY':'PDF_ACCESSIBILITY_FAILED'});}
