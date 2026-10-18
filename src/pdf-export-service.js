import {preparePdfBleedImage} from './pdf-bleed-artwork.js';
import {PdfPrintProfiles} from './pdf-print-profiles.js';
import {PdfDocuments} from './pdf-documents.js';
import {PdfDocumentStore} from './pdf-document-store.js';
import {PdfDocumentImages} from './pdf-document-images.js';
import {readPdfDocumentFont} from './pdf-document-fonts.js';
import {compilePdfDocument} from './pdf-document-renderer.js';
import {embedPdfFonts} from './pdf-font-assets.js';
import {renderSavedPdf} from './pdf-render-service.js';
import {PdfLayoutError} from './web/pdf-layout-model.js';
import {PdfExportJobs} from './pdf-export-jobs.js';
import {withoutWriterWait} from './writer-wait.js';
import {withDatabaseRequest} from './database-request-context.js';
import {AppError} from './errors.js';

export async function prepareSavedPdf(documents,{documentId,revision},{signal,check=async()=>{},progress=async()=>{},preflightOnly=false}={}){
 try{
  await check();await progress('compiling');
  const compiled=await documents.domains.run(['pdf'],async get=>{
   const store=get('pdf'),owner=new PdfDocumentStore(store),selected=await owner.open(documentId,{revision});
   const compiled=await compilePdfDocument(selected.header,owner.content(documentId,revision,{signal}),{signal,readImage:asset=>new PdfDocumentImages(store,documentId).read(asset,{signal})}),customFonts=new Map();
   const bleedImage=await preparePdfBleedImage(selected.header.press,asset=>new PdfDocumentImages(store,documentId).read(asset,{signal}),{signal});if(bleedImage)compiled.bleedImage=bleedImage;
   for(const pin of selected.header.fonts??[])if(compiled.fonts.includes(pin.id))customFonts.set(pin.id,await readPdfDocumentFont(store,documentId,pin,{signal}));
   if(selected.header.printCondition){compiled.printCondition=structuredClone(selected.header.printCondition);compiled.iccProfile=(await new PdfPrintProfiles(store,documentId).read(selected.header.printCondition.profile,{signal})).toString('base64');}
   return embedPdfFonts(compiled,{signal,customFonts});
  },{signal,check});
  await progress('rendering');const result=await renderSavedPdf({...compiled,preflightOnly},{signal,wait:true});await check();signal?.throwIfAborted();return result;
 }catch(error){if(preflightOnly&&error instanceof PdfLayoutError&&error.code==='PDF_LINK_CODE_LAYOUT'&&typeof error.details?.[0]==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(error.details[0])){await check();signal?.throwIfAborted();return {preflight:{version:1,status:'fatal',truncated:false,findings:[{code:error.code,severity:'fatal',sectionId:error.details[0],blockId:null,blockIndex:null,details:{}}]}};}if(error instanceof PdfLayoutError)throw new AppError(error.code,error.details);throw error;}
}
// The desktop renderer is intentionally single-owner. Queued exports compile
// only when their turn begins instead of retaining many whole documents in RAM.
let rendering=Promise.resolve();
export class PdfExportService{
 constructor(storage,{check=async()=>{}}={}){this.storage=storage;this.check=check;this.pending=new Map();this.again=new Map();this.closed=false;this.controller=new AbortController();}
 queue(workspaceId){return new PdfExportJobs(new PdfDocuments(this.storage,workspaceId),{prepare:(pin,options)=>prepareSavedPdf(new PdfDocuments(this.storage,workspaceId),pin,options)});}
 schedule(workspaceId,id,{check=async()=>{}}={}){
  if(this.closed)throw new AppError('ACCESS_LOCKED');const key=workspaceId+':'+id;if(this.pending.has(key)){this.again.set(key,{workspaceId,id,check});return;}
  const current=async()=>{if(this.closed)throw new AppError('ACCESS_LOCKED');await this.check();await check();},queue=this.queue(workspaceId),signal=this.controller.signal;
  let started=false,settle;const task=new Promise(resolve=>{settle=resolve;}),finish=()=>{signal.removeEventListener('abort',cancel);this.pending.delete(key);settle();const again=this.again.get(key);this.again.delete(key);if(again&&!this.closed)this.schedule(again.workspaceId,again.id,{check:again.check});},cancel=()=>{if(!started)finish();};signal.addEventListener('abort',cancel,{once:true});
  this.pending.set(key,task);rendering=withoutWriterWait(()=>withDatabaseRequest(undefined,()=>rendering.catch(()=>{}).then(async()=>{signal.throwIfAborted();started=true;await current();await queue.work(id,{signal,check:current});}))).catch(()=>{}).finally(finish);
 }
 async close(){if(this.closed)return;this.closed=true;this.again.clear();this.controller.abort(new AppError('PDF_CANCELLED'));await Promise.all([...this.pending.values()]);}
}
