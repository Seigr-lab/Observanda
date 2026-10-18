import {PdfPrintProfiles,preparePdfPrintProfile} from './pdf-print-profiles.js';
import {PdfDocumentStore} from './pdf-document-store.js';
import {requirePdfDomainFormat} from './pdf-domain-format.js';
import {validPdfPrintCondition,PDF_ICC_MAX_BYTES} from './web/pdf-print-condition-model.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
export async function retainPdfPrintProfile(documents,input,{signal,check=async()=>{}}={}){
 if(!input||Object.keys(input).sort().join()!=='bytes,commandId,expectedRevision,id,label,renderingIntent'||![input.id,input.commandId].every(researchId)||!revisionId(input.expectedRevision)||typeof input.bytes!=='string'||input.bytes.length>Math.ceil(PDF_ICC_MAX_BYTES/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.bytes))throw new AppError('INVALID');
 await check();signal?.throwIfAborted();if(!await documents.available())throw new AppError('NOT_FOUND');const bytes=Buffer.from(input.bytes,'base64');if(bytes.toString('base64')!==input.bytes)throw new AppError('INVALID');let prepared;try{prepared=preparePdfPrintProfile(bytes);}catch{throw new AppError('PDF_PRINT_PROFILE');}
 return documents.domains.run(['pdf'],async get=>{const store=get('pdf'),owner=new PdfDocumentStore(store),selected=await owner.open(input.id,{revision:input.expectedRevision});if(selected.header.outputProfile==='pdfa-2u')throw new AppError('PDF_PRINT_CONFLICT');await requirePdfDomainFormat(store,3);const profile=await new PdfPrintProfiles(store,input.id).retain(prepared,{signal}),condition={version:1,profile,label:input.label,renderingIntent:input.renderingIntent};if(!validPdfPrintCondition(condition))throw new AppError('INVALID');const header={...selected.header,printCondition:condition};return {...await owner.change({id:input.id,commandId:input.commandId,expectedRevision:input.expectedRevision,operation:{type:'header',header}},{signal}),printCondition:condition};},{signal,check,write:['pdf']});
}
