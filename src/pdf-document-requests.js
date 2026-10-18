import {PdfDocuments} from './pdf-documents.js';
import {PdfDocumentStore} from './pdf-document-store.js';
import {compilePdfDocument} from './pdf-document-renderer.js';
import {embedPdfFonts} from './pdf-font-assets.js';
import {pdfRendererAvailable,renderSavedPdf} from './pdf-render-service.js';
import {PdfLayoutError} from './web/pdf-layout-model.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
const methods=['list','open','sections','section','history','change','capabilities','export','layouts','layout-change'];
export function pdfDocumentRequest(route,method='POST'){
 if(method!=='POST'||!route.startsWith('/api/pdf/'))return null;const pdf=route.slice(9);
 return methods.includes(pdf)?{pdf,method:'POST',write:pdf==='change'||pdf==='layout-change',binary:pdf==='export',limit:1024*1024}:null;
}
export async function executePdfRequest(storage,request,data,{signal,check=async()=>{},binary}={}){
 if(storage.labBookId)throw new AppError('INVALID');await check();signal?.throwIfAborted();
 const {workspaceId,...input}=data??{},documents=new PdfDocuments(storage,workspaceId);
 if(request.pdf==='capabilities'){await documents.available();return {render:pdfRendererAvailable()};}
 try{
  if(request.pdf==='export'){
   if(!revisionId(input.revision)||Object.keys(input).sort().join()!=='id,revision')throw new AppError('INVALID');
   if(!pdfRendererAvailable())throw new AppError('PDF_DESKTOP');
   if(!await documents.available())throw new AppError('NOT_FOUND');
   const compiled=await documents.domains.run(['pdf'],async get=>{const owner=new PdfDocumentStore(get('pdf')),selected=await owner.open(input.id,{revision:input.revision});return compilePdfDocument(selected.header,owner.content(input.id,input.revision,{signal}),{signal});},{signal,check});
   const result=await renderSavedPdf(await embedPdfFonts(compiled,{signal}),{signal});await check();signal?.throwIfAborted();
   return binary({name:'document.pdf',download:'document.pdf',mime:'application/pdf',content:result.bytes});
  }
  const result=request.pdf==='layout-change'?await documents.changeLayout(input,{signal,check}):request.pdf==='change'?await documents.change(input,{signal,check}):await documents.read(request.pdf,input,{signal,check});await check();return result;
 }catch(error){if(error instanceof PdfLayoutError)throw new AppError(error.code,error.details);throw error;}
}
