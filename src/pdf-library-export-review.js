import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {pdfAudienceSelection} from './pdf-audience.js';
import {allowPdfImage,checkPdfSources,pdfFileSections} from './pdf-publication-files.js';

// A batch review receives counts and a fingerprint. Content and private
// source identifiers stay within the authenticated publication owner.
export async function reviewPdfExport(owner,files,documentId,selected,{signal}={}){
 const proof=new Map(),options={proof,signal},selection=pdfAudienceSelection(selected.header);
 const source=owner.content(documentId,selected.revision,{signal});
 for await(const section of pdfFileSections(owner.store,files,documentId,source,options)){
  const state=selection.observe(section);
  if(state.included)for(const image of section.images??[])await allowPdfImage(owner.store,files,documentId,{asset:image.asset},options);
 }
 const bleed=selected.header.press?.artwork?.image;
 if(bleed&&!await allowPdfImage(owner.store,files,documentId,{asset:bleed.asset},options))throw new AppError('PDF_SOURCE_CONTENT');
 const pins=[...proof.values()].sort((a,b)=>a.workspaceId.localeCompare(b.workspaceId)||a.recordId.localeCompare(b.recordId));
 await checkPdfSources(files,pins);
 const {audience,included,pending,ready}=selection.complete();
 return {audience,included,pending,ready,sources:digest(serialize(pins)),pins};
}
