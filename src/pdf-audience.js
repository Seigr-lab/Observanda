import {PdfLayoutError,validPdfDocumentHeader,validPdfSection} from './web/pdf-layout-model.js';
import {pdfAudience,pdfSectionPublicationState} from './web/pdf-audience-model.js';
// A scalar summary and one selected section at a time. Filtering happens before
// outline registration, font/glyph collection or any image bytes are requested.
export function pdfAudienceSelection(header){
 if(!validPdfDocumentHeader(header))throw new PdfLayoutError('PDF_AUDIENCE');
 const counts={audience:pdfAudience(header),total:0,included:0,omitted:0,reviewed:0,pending:0,complete:false};
 function observe(section){
  if(!validPdfSection(section))throw new PdfLayoutError('PDF_SECTION');
  const state=pdfSectionPublicationState(header,section);counts.total++;
  if(state.included)counts.included++;if(state.choice==='omit')counts.omitted++;
  if(state.review==='reviewed')counts.reviewed++;if(!state.allowed)counts.pending++;return state;
 }
 const summary=()=>({...counts,ready:counts.complete&&counts.included>0&&counts.pending===0});
 function accept(section){const state=observe(section);if(!state.allowed)throw new PdfLayoutError('PDF_PUBLIC_REVIEW',[section.id]);return state.included;}
 function complete(){counts.complete=true;return summary();}
 return {observe,accept,summary,complete,async *sections(source,{signal}={}){for await(const section of source){signal?.throwIfAborted();if(accept(section))yield section;}signal?.throwIfAborted();complete();}};
}
export async function pdfAudienceSummary(header,sections,{signal}={}){
 const selection=pdfAudienceSelection(header);for await(const section of sections){signal?.throwIfAborted();selection.observe(section);}signal?.throwIfAborted();return selection.complete();
}
