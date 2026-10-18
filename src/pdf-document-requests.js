import {pdfAudienceSummary} from './pdf-audience.js';
import {readPdfResearchImages,retainPdfResearchImage} from './pdf-research-images.js';
import {prepareSavedPdf} from './pdf-export-service.js';
import {PdfExportJobs} from './pdf-export-jobs.js';
import {PdfLayoutLibrary} from './pdf-layout-library.js';
import {PdfDocumentImages,preparePdfImage} from './pdf-document-images.js';
import {PDF_IMAGE_MAX_BYTES} from './web/pdf-image-model.js';
import {preparePdfFont,retainPdfDocumentFont,copyPdfDocumentFont,readPdfDocumentFont,describePdfDocumentFont} from './pdf-document-fonts.js';
import {WorkspaceFonts} from './workspace-fonts.js';
import {researchId} from './web/research-reference.js';
import {customFontId} from './web/font-catalogue.js';
import {readPdfResearch,retainPdfResearch} from './pdf-research-sources.js';
import {PdfDocuments} from './pdf-documents.js';
import {PdfDocumentStore} from './pdf-document-store.js';


import {pdfRendererAvailable,pdfRendererCapabilities} from './pdf-render-service.js';
import {PdfLayoutError} from './web/pdf-layout-model.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
const methods=['list','archive','openArchived','open','sections','outline','section','history','change','capabilities','export','layouts','layout-change','source','source-retain','source-images','source-image-retain','selection','preflight','fonts','font-retain','image-import','image-read','exports','export-start','export-status','export-cancel','export-resume','export-download'];
export function pdfDocumentRequest(route,method='POST'){
 if(method!=='POST'||!route.startsWith('/api/pdf/'))return null;const pdf=route.slice(9);
 return methods.includes(pdf)?{pdf,method:'POST',write:['change','layout-change','source-retain','source-image-retain','font-retain','image-import','export-start','export-cancel','export-resume'].includes(pdf),binary:['export','image-read','export-download'].includes(pdf),limit:pdf==='image-import'?24*1024*1024:1024*1024}:null;
}
export async function executePdfRequest(storage,request,data,{signal,check=async()=>{},binary,sourceReader,exportService}={}){
 if(storage.labBookId)throw new AppError('INVALID');await check();signal?.throwIfAborted();
 const {workspaceId,...input}=data??{},documents=new PdfDocuments(storage,workspaceId);
 if(request.pdf==='capabilities'){await documents.available();return pdfRendererCapabilities();}
 try{
  if(request.pdf==='exports'||request.pdf.startsWith('export-')){
   const jobs=new PdfExportJobs(documents),options={signal,check};
   if(request.pdf==='exports')return jobs.list(input,options);
   if(request.pdf==='export-start'){
    if(!exportService||!pdfRendererAvailable())throw new AppError('PDF_DESKTOP');const job=await jobs.start(input,options);if(job.state==='queued')exportService.schedule(workspaceId,job.id,{check});return job;
   }
   if(Object.keys(input).join()!=='id'||!researchId(input.id))throw new AppError('INVALID');
   if(request.pdf==='export-status')return jobs.status(input.id,options);
   if(request.pdf==='export-cancel')return jobs.cancel(input.id,options);
   if(request.pdf==='export-resume'){if(!exportService||!pdfRendererAvailable())throw new AppError('PDF_DESKTOP');const job=await jobs.resume(input.id,options);if(job.state==='queued')exportService.schedule(workspaceId,job.id,{check});return job;}
   const output=await jobs.download(input.id,options);return binary({name:'document.pdf',download:'document.pdf',mime:'application/pdf',content:output.bytes});
  }
  if(request.pdf==='image-import'){
   if(Object.keys(input).sort().join()!=='bytes,id'||!researchId(input.id)||typeof input.bytes!=='string'||input.bytes.length>Math.ceil(PDF_IMAGE_MAX_BYTES/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.bytes)||!await documents.available())throw new AppError('INVALID');
   await documents.read('open',{id:input.id},{signal,check});const bytes=Buffer.from(input.bytes,'base64');if(bytes.toString('base64')!==input.bytes)throw new AppError('INVALID');const prepared=await preparePdfImage(bytes,{signal});await check();
   return documents.domains.run(['pdf'],async get=>{await new PdfDocumentStore(get('pdf')).open(input.id);return new PdfDocumentImages(get('pdf'),input.id).retain(prepared,{signal});},{signal,check,write:['pdf']});
  }
  if(request.pdf==='image-read'){
   if(Object.keys(input).sort().join()!=='asset,id'||!researchId(input.id)||!revisionId(input.asset)||!await documents.available())throw new AppError('INVALID');
   const image=await documents.domains.run(['pdf'],async get=>{await new PdfDocumentStore(get('pdf')).open(input.id);return new PdfDocumentImages(get('pdf'),input.id).read(input.asset,{signal});},{signal,check});await check();return binary({name:'image.png',mime:'image/png',content:image.content});
  }
  if(request.pdf==='fonts'){

   if(Object.keys(input).sort().join()!=='id'||input.id!==null&&!researchId(input.id))throw new AppError('INVALID');
   const available=(await new WorkspaceFonts(storage).list()).filter(font=>font.embed&&!font.restricted&&!font.hidden),retained=input.id&&await documents.available()?await documents.domains.run(['pdf'],async get=>{const store=get('pdf'),selected=await new PdfDocumentStore(store).open(input.id);return Promise.all((selected.header.fonts??[]).map(pin=>describePdfDocumentFont(store,input.id,pin,{signal})));},{signal,check}):[];
   await check();return {available,retained};
  }
  if(request.pdf==='font-retain'){
   if(Object.keys(input).sort().join()!==('commandId,expectedRevision,fontId,id'+(Object.hasOwn(input,'sourceLayout')?',sourceLayout':''))||![input.id,input.commandId].every(researchId)||!revisionId(input.expectedRevision)||!customFontId(input.fontId)||!await documents.available())throw new AppError('INVALID');
   if(input.sourceLayout&&(Object.keys(input.sourceLayout).sort().join()!=='id,revision'||!researchId(input.sourceLayout.id)||!revisionId(input.sourceLayout.revision)))throw new AppError('INVALID');
   const replay=await documents.domains.run(['pdf'],get=>get('pdf').object('pdf:command:'+input.id+':'+input.commandId),{signal,check});
   const prepared=replay||input.sourceLayout?null:await preparePdfFont(storage,input.fontId,{signal,check});
   return documents.domains.run(['pdf'],async get=>{const store=get('pdf'),owner=new PdfDocumentStore(store),selected=await owner.open(input.id,{revision:input.expectedRevision}),pin=await (async()=>{if(replay){const saved=await owner.revision(input.id,replay.revision),pin=saved.header.fonts?.find(font=>font.id===input.fontId);if(!pin)throw new AppError('MODULE_REPLAY');await describePdfDocumentFont(store,input.id,pin,{signal});return pin;}if(!input.sourceLayout)return retainPdfDocumentFont(store,input.id,prepared,{signal});const layout=await new PdfLayoutLibrary(store).value(input.sourceLayout.revision);if(layout.id!==input.sourceLayout.id||layout.fontPin?.id!==input.fontId)throw new AppError('INVALID');return copyPdfDocumentFont(store,layout.id,layout.fontPin,input.id,{signal});})(),header={...selected.header,fonts:[...(selected.header.fonts??[]).filter(font=>font.id!==pin.id),pin]};return owner.change({id:input.id,commandId:input.commandId,expectedRevision:input.expectedRevision,operation:{type:'header',header}},{signal});},{signal,check,write:['pdf']});
  }
  if(request.pdf==='selection'){if(Object.keys(input).sort().join()!=='id,revision'||!researchId(input.id)||!revisionId(input.revision)||!await documents.available())throw new AppError('INVALID');return documents.domains.run(['pdf'],async get=>{const owner=new PdfDocumentStore(get('pdf')),selected=await owner.open(input.id,{revision:input.revision});return pdfAudienceSummary(selected.header,owner.content(input.id,input.revision,{signal}),{signal});},{signal,check});}
  if(request.pdf==='source-images'||request.pdf==='source-image-retain'){if(!sourceReader)throw new AppError('INVALID');return request.pdf==='source-images'?readPdfResearchImages(sourceReader,input,{signal}):retainPdfResearchImage(documents,sourceReader,input,{signal,check});}
  if(request.pdf==='source'||request.pdf==='source-retain'){if(!sourceReader)throw new AppError('INVALID');return request.pdf==='source'?readPdfResearch(sourceReader,input,{signal}):retainPdfResearch(documents,sourceReader,input,{signal,check});}
  if(request.pdf==='export'||request.pdf==='preflight'){
   if(!revisionId(input.revision)||Object.keys(input).sort().join()!=='id,revision')throw new AppError('INVALID');
   if(!pdfRendererAvailable())throw new AppError('PDF_DESKTOP');
   if(!await documents.available())throw new AppError('NOT_FOUND');
   const result=await prepareSavedPdf(documents,{documentId:input.id,revision:input.revision},{signal,check,preflightOnly:request.pdf==='preflight'});
   if(request.pdf==='preflight')return {revision:input.revision,...result.preflight};
   if(!result.bytes||result.preflight?.status==='fatal')throw new AppError('PDF_PREFLIGHT',result.preflight?.findings??[]);
   return binary({name:'document.pdf',download:'document.pdf',mime:'application/pdf',content:result.bytes});
  }
  const result=request.pdf==='layout-change'?await documents.changeLayout(input,{signal,check}):request.pdf==='change'?await documents.change(input,{signal,check}):await documents.read(request.pdf,input,{signal,check});await check();return result;
 }catch(error){if(error instanceof PdfLayoutError)throw new AppError(error.code,error.details);throw error;}
}
