import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {selectPdfResearchTable} from './web/pdf-research-table.js';
import {pdfReferencedFigures,validPdfResearch} from './web/pdf-research-model.js';
import {PDF_IMAGE_MAX_BYTES} from './web/pdf-image-model.js';
import {proseDocument} from './web/prose-model.js';
import {reconcilePdfPlacements} from './web/pdf-placement-review.js';
import {pdfImageGrant,pdfImageGrants} from './pdf-research-images.js';

const invalid=()=>{throw new AppError('INVALID');};
const denied=()=>{throw new AppError('PDF_SOURCE_CONTENT');};
const same=(a,b)=>serialize(a)===serialize(b);
const sourceWindows=new WeakMap(),imageWindows=new WeakMap();
const proofKey=({workspaceId,recordId})=>workspaceId+':'+recordId;
const exact=(input,keys)=>input&&Object.keys(input).sort().join()===keys.split(',').sort().join();
export const pdfSelectionInput=value=>exact(value,'sourceId,snapshotId,recordId,collection,itemId'+(Object.hasOwn(value??{},'blockId')?',blockId':''))&&[value.sourceId,value.recordId,value.itemId].every(researchId)&&(value.snapshotId===null||revisionId(value.snapshotId))&&['entry','body','sections','figures'].includes(value.collection)&&(!Object.hasOwn(value,'blockId')||researchId(value.blockId)&&value.collection!=='figures');

async function source(files,workspaceId,recordId,{signal,proof,missing=false}={}){
 signal?.throwIfAborted();if(!files)denied();const key=proofKey({workspaceId,recordId});let cache=proof?sourceWindows.get(proof):null;
 if(proof&&!cache){cache={values:new Map(),bytes:0};sourceWindows.set(proof,cache);}
 if(cache?.values.has(key)){const {data}=cache.values.get(key);if(!data&&!missing)denied();return data;}
 const state=await files.sourceForRecord({workspaceId,recordId,target:'pdf'}),revision=state?.revision??null;
 if(proof){const prior=proof.get(key);if(prior&&prior.revision!==revision)denied();proof.set(key,{workspaceId,recordId,revision});}
 const data=state?.visible?await files.pdfSource(state.id,{revision,signal}):null;
 if(cache){const size=data?Buffer.byteLength(serialize(data)):64;if(size<=8*1024*1024){while(cache.values.size&&(cache.bytes+size>8*1024*1024||cache.values.size>=16)){const [id,item]=cache.values.entries().next().value;cache.values.delete(id);cache.bytes-=item.size;}cache.values.set(key,{data,size});cache.bytes+=size;}}
 if(!data&&!missing)denied();return data;

}
export async function checkPdfSources(files,proof){
 if(!Array.isArray(proof))denied();for(const pin of proof){if(!exact(pin,'workspaceId,recordId,revision')||!researchId(pin.workspaceId)||!researchId(pin.recordId)||pin.revision!==null&&!revisionId(pin.revision)||!files)denied();if(((await files.sourceForRecord({...pin,target:'pdf'}))?.revision??null)!==pin.revision)denied();}
}
function selection(data,request){
 const {itemId,collection,blockId}=request,{parts}=data,provenance=data.provenance;let content=null,title=data.title,figures=[];
 if(collection==='body'||collection==='entry'){if(itemId!==provenance.recordId)invalid();content=parts[collection];}
 else if(collection==='sections'){const item=parts.sections.find(item=>item.id===itemId);if(item){content=item.content;title=item.title;}}
 else if(collection==='figures'){const figure=parts.figures.find(item=>item.id===itemId);if(figure){title=figure.title;content={type:'doc',content:[{type:'book_figure',attrs:{version:1,id:figure.id,figureId:figure.id,alternative:title}}]};}}
 if(content===null||content===undefined)return null;
 if(blockId){content=selectPdfResearchTable(content,blockId);if(!content)return null;title=content.content[0].attrs.title.slice(0,240);}
 for(const id of pdfReferencedFigures(content)){const figure=parts.figures.find(item=>item.id===id);if(!figure)denied();figures.push(figure);}
 const value={version:1,workspaceId:provenance.workspaceId,snapshotId:data.revision,recordId:provenance.recordId,recordRevision:provenance.recordRevision??provenance.revision,collection,itemId,...(blockId?{blockId}:{}),title,content,figures};if(!validPdfResearch(value))denied();if(Buffer.byteLength(serialize(value))>384*1024)throw new AppError('PDF_CAPACITY');return value;
}
export async function pdfFileResearch(files,input,{signal}={}){
 signal?.throwIfAborted();if(!files)denied();const {operation}=input??{};
 if(operation==='records'){
  if(!exact(input,'operation,after,search')||input.after!==null&&!revisionId(input.after)||typeof input.search!=='string'||input.search.length>160)invalid();
  const window=await files.library({after:input.after,limit:20,target:'pdf',signal}),needle=input.search.trim().toLocaleLowerCase();
  return {items:window.items.filter(item=>!needle||item.title.toLocaleLowerCase().includes(needle)).map(item=>({id:item.recordId,title:item.title,sourceId:item.workspaceId,snapshotId:item.revision,notebookId:item.notebookId})),next:window.next};
 }
 if(!researchId(input?.sourceId)||!researchId(input?.recordId)||input.snapshotId!==null&&!revisionId(input.snapshotId))invalid();
 const data=await source(files,input.sourceId,input.recordId,{signal});if(input.snapshotId!==null&&input.snapshotId!==data.revision)throw new AppError('CONFLICT');
 if(operation==='parts'){
  if(!exact(input,'operation,sourceId,snapshotId,recordId,collection,offset')||!['sections','figures'].includes(input.collection)||!Number.isSafeInteger(input.offset)||input.offset<0)invalid();
  const values=data.parts[input.collection];if(input.offset>values.length)invalid();const items=values.slice(input.offset,input.offset+20).map(({id,title})=>({id,title}));
  return {sourceId:input.sourceId,snapshotId:data.revision,recordId:input.recordId,recordRevision:data.provenance.recordRevision??data.provenance.revision,recordTitle:data.title,items,total:values.length,next:input.offset+items.length<values.length?input.offset+items.length:null};
 }
 const {operation:_op,...request}=input;if(operation!=='selection'||!pdfSelectionInput(request))invalid();return selection(data,request)??denied();
}
function imageChoice(data,item){
 const asset=data.assets.find(value=>value.path===item.path);
 if(!asset||!asset.size||asset.size>PDF_IMAGE_MAX_BYTES||!['image/png','image/jpeg','image/webp','image/svg+xml'].includes(asset.contentType))return null;
 return {label:item.label,source:{version:1,workspaceId:data.provenance.workspaceId,snapshotId:data.revision,recordId:data.provenance.recordId,recordRevision:data.provenance.recordRevision??data.provenance.revision,collection:'attachments',itemId:item.id,itemRevision:null,sha256:asset.sha256,bytes:asset.size}};
}
export async function pdfFileImages(files,input,{signal}={}){
 if(!exact(input,'sourceId,snapshotId,recordId,collection,offset,cursor')||![input.sourceId,input.recordId].every(researchId)||!revisionId(input.snapshotId)||!['attachments','artifacts'].includes(input.collection)||!Number.isSafeInteger(input.offset)||input.offset<0||input.cursor!==null)invalid();
 const data=await source(files,input.sourceId,input.recordId,{signal});if(input.snapshotId!==data.revision)throw new AppError('CONFLICT');const values=input.collection==='attachments'?data.parts.images:[],items=values.slice(input.offset,input.offset+20).map(item=>imageChoice(data,item)).filter(Boolean);
 return {sourceId:input.sourceId,recordId:input.recordId,snapshotId:data.revision,items,next:input.offset+20<values.length?input.offset+20:null};
}
async function imageFile(files,pin,options={}){
 if(pin.collection!=='attachments')return null;
 const data=await source(files,pin.workspaceId,pin.recordId,{...options,missing:true});if(!data)return null;
 const item=data.parts.images.find(item=>item.id===pin.itemId);if(!item)return null;const choice=imageChoice(data,item);if(!choice||choice.source.sha256!==pin.sha256||choice.source.bytes!==pin.bytes)return null;
 return {data,item};
}
export async function pdfFileImageBytes(files,pin,{signal}={}){
 const row=await imageFile(files,pin,{signal});if(!row||row.data.revision!==pin.snapshotId)denied();return files.pdfAsset(row.data.id,row.item.path,{revision:row.data.revision,limit:PDF_IMAGE_MAX_BYTES,signal});
}
export async function allowPdfImage(store,files,documentId,{asset,imageId},{signal,proof}={}){
 // Match by asset as well as placement: changing an image placement ID cannot
 // resurrect a private retained blob or bypass the direct image-read endpoint.
 if(imageId){const grant=await pdfImageGrant(store,documentId,imageId);if(grant)return grant.asset===asset&&Boolean(await imageFile(files,grant.source,{signal,proof}));}
 let documents=imageWindows.get(store);if(!documents){documents=new Map();imageWindows.set(store,documents);}
 if(!documents.has(documentId)){
  const rows=new Map();for await(const grant of pdfImageGrants(store,documentId,{signal})){const pins=rows.get(grant.asset)??[];pins.push(grant.source);rows.set(grant.asset,pins);}
  documents.set(documentId,rows);
 }
 const grants=documents.get(documentId).get(asset);if(!grants)return true;
 let allowed=false;for(const pin of grants)if(await imageFile(files,pin,{signal,proof}))allowed=true;return allowed;

}
function currentWriting(authored,old,next){
 if(same(old,next))return authored;if(same(old,authored))return next;
 const original=proseDocument(old).content??[],edited=proseDocument(authored).content??[],incoming=proseDocument(next).content??[];
 if(original.length!==edited.length)return next;
 const permitted=new Map();for(const block of incoming){const key=digest(serialize(block));permitted.set(key,1+(permitted.get(key)??0));}
 // A reordered or edited withdrawn block has no reliable correspondence.
 // Prefer the current permitted composition in that ambiguous case.
 for(let n=0;n<original.length;n++){const key=digest(serialize(original[n])),allowed=permitted.get(key)??0;if(allowed)permitted.set(key,allowed-1);else if(!same(original[n],edited[n]))return next;}
 const byHash=new Map();for(let n=0;n<original.length;n++){const key=digest(serialize(original[n]));if(!byHash.has(key))byHash.set(key,[]);byHash.get(key).push(n);}
 // Only transfer author changes when the original block still exists in the
 // explicitly permitted composition. A deleted private block never survives.
 return {type:'doc',content:incoming.map(block=>{const positions=byHash.get(digest(serialize(block)));return positions?.length?edited[positions.shift()]:block;})};
}
export async function projectPdfSection(store,files,documentId,original,{signal,proof}={}){
 let section=original,withdrawn=false;const prior=original.research;
 if(prior){
  const data=await source(files,prior.workspaceId,prior.recordId,{signal,proof,missing:true}),approved=data&&selection(data,prior);
  if(!approved){withdrawn=true;const blank={...prior,title:'',content:'',figures:[]};delete blank.blockId;section={...section,title:'',content:'',figures:[],research:blank};}
  else section={...section,title:prior.title===approved.title?section.title:approved.title,content:currentWriting(section.content,prior.content,approved.content),figures:same(prior.figures,approved.figures)?section.figures??[]:approved.figures,research:approved};
 }
 if(section.images?.length){const images=[];for(const image of section.images)if(await allowPdfImage(store,files,documentId,{asset:image.asset,imageId:image.id},{signal,proof}))images.push(image);section={...section,images};}
 return {section:reconcilePdfPlacements(original,section),withdrawn};
}
export async function* pdfFileSections(store,files,documentId,source,options={}){
 for await(const value of source){const result=await projectPdfSection(store,files,documentId,value,options);if(!result.withdrawn)yield result.section;}
}
