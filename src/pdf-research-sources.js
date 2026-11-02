import {preparePdfPublicationFont} from './pdf-document-fonts.js';
import {PdfDocumentStore} from './pdf-document-store.js';
import {pdfInlineFontIds} from './web/pdf-font-model.js';
import {customFontId} from './web/font-catalogue.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {pdfFileResearch,pdfSelectionInput} from './pdf-publication-files.js';
const invalid=()=>{throw new AppError('INVALID');};
const exact=(v,keys)=>v&&Object.keys(v).sort().join()===keys.split(',').sort().join();
export const validPdfSourceSelection=pdfSelectionInput;
export const readPdfResearch=pdfFileResearch;
export async function retainPdfResearch(documents,publicationFiles,input,options={}){
 if(!exact(input,'id,commandId,expectedRevision,sectionId,replace,source')||![input.id,input.commandId,input.sectionId].every(researchId)||!revisionId(input.expectedRevision)||typeof input.replace!=='boolean'||!validPdfSourceSelection(input.source)||input.source.snapshotId===null)invalid();
 // An exact retry uses the immutable section already published by this
 // command; source/library availability cannot change a committed capture.
 const research=await readPdfResearch(publicationFiles,{operation:'selection',...input.source},options);
 if(await documents.available()){
  const replay=await documents.domains.run(['pdf'],async get=>{
   const store=get('pdf'),receipt=await store.object('pdf:command:'+input.id+':'+input.commandId);if(!receipt)return null;
   const owner=new PdfDocumentStore(store),{section}=await owner.section(input.id,input.sectionId,{revision:receipt.revision}),research=section.research,source=input.source;
   if(!research||research.workspaceId!==source.sourceId||research.snapshotId!==source.snapshotId||research.recordId!==source.recordId||research.collection!==source.collection||research.itemId!==source.itemId||research.blockId!==source.blockId)throw new AppError('MODULE_REPLAY');
   const result=await owner.change({id:input.id,commandId:input.commandId,expectedRevision:input.expectedRevision,operation:{type:input.replace?'section':'append',section}},options);
   return pdfInlineFontIds(section.content).some(customFontId)?{...result,fonts:(await owner.revision(input.id,result.revision)).header.fonts??[]}:result;
  },options);if(replay)return replay;
 }
 const previous=input.replace?(await documents.read('section',{id:input.id,sectionId:input.sectionId,revision:input.expectedRevision},options)).section:null;
 const preparedFonts=new Map(),custom=pdfInlineFontIds(research.content).filter(customFontId);
 if(custom.length){const selected=await publicationFiles.sourceForRecord({workspaceId:research.workspaceId,recordId:research.recordId,target:'pdf'});if(!selected?.visible||selected.revision!==research.snapshotId)throw new AppError('PDF_SOURCE_CONTENT');for(const fontId of custom)preparedFonts.set(fontId,await preparePdfPublicationFont(publicationFiles,selected.id,selected.revision,fontId,options));}
 const section={...(previous??{id:input.sectionId,layout:null,start:null}),title:research.title,content:research.content,figures:research.figures,research};
 return documents.change({id:input.id,commandId:input.commandId,expectedRevision:input.expectedRevision,operation:{type:input.replace?'section':'append',section}},{...options,preparedFonts});
}
