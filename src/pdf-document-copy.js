import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {copyPdfDocumentFont} from './pdf-document-fonts.js';
import {PdfDocumentImages} from './pdf-document-images.js';
import {PdfPrintProfiles,preparePdfPrintProfile} from './pdf-print-profiles.js';
import {copyPdfImageGrants} from './pdf-research-images.js';
import {allowPdfImage,checkPdfSources,projectPdfSection} from './pdf-publication-files.js';
import {parsePdfCrossReference,pdfCrossReference} from './web/pdf-cross-reference-model.js';
import {validPdfDocumentHeader,validPdfSection} from './web/pdf-layout-model.js';

// Derive the same new section identity for a forward reference without
// loading the outline or accumulating a cross-document identity table.
export function copiedPdfSectionId(destination,section){
 const bytes=createHash('sha256').update(destination+'\0'+section).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=bytes.toString('hex');
 return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
function remapLinks(node,source,destination){
 if(!node||typeof node!=='object')return;
 for(const mark of node.marks??[]){
  if(mark.type!=='link')continue;
  const target=parsePdfCrossReference(mark.attrs.href);
  if(target?.documentId===source)mark.attrs.href=pdfCrossReference({...target,documentId:destination,sectionId:copiedPdfSectionId(destination,target.sectionId)});
 }
 for(const child of node.content??[])remapLinks(child,source,destination);
}
export async function copyPdfEdition(owner,{id,expectedRevision,name},destination,put,{publicationFiles,signal,check}={}){
 const selected=await owner.open(id);
 if(selected.revision!==expectedRevision)throw new AppError('CONFLICT');
 const store=owner.store,header={...structuredClone(selected.header),id:destination,name};
 if(!validPdfDocumentHeader(header))throw new AppError('INVALID');
 const proof=new Map(),images=new PdfDocumentImages(store,id);
 const slots=new Map(selected.starter?.sections.map(row=>[row.sectionId,row.slot])??[]),copiedSlots=[];
 if(header.fonts){
  const pins=[];for(const pin of header.fonts)pins.push(await copyPdfDocumentFont(store,id,pin,destination,{signal}));
  header.fonts=pins;
 }
 if(header.printCondition){
  const bytes=await new PdfPrintProfiles(store,id).read(header.printCondition.profile,{signal});
  try{header.printCondition.profile=await new PdfPrintProfiles(store,destination).retain(preparePdfPrintProfile(bytes),{signal});}
  finally{bytes.fill(0);}
 }
 const artwork=header.press?.artwork;
 if(artwork?.image){
  if(await allowPdfImage(store,publicationFiles,id,artwork.image,{signal,proof}))await images.copyTo(destination,artwork.image.asset,{signal});
  else artwork.image=null;
 }
 for await(const saved of owner.content(id,selected.revision,{signal})){
  const projected=await projectPdfSection(store,publicationFiles,id,saved,{signal,proof});
  if(projected.withdrawn)continue;
  const section=structuredClone(projected.section);
  section.id=copiedPdfSectionId(destination,section.id);
  // Scientific block and note identifiers belong to the section. Keeping
  // them also preserves source projection and the author's inline note marks.
  remapLinks(section.content,id,destination);
  for(const note of section.notes??[])remapLinks(note.content,id,destination);
  if(section.publication)section.publication.review=null;
  for(const image of section.images??[])await images.copyTo(destination,image.asset,{signal});
  if(!validPdfSection(section))throw new AppError('CATALOGUE_DAMAGED');
  await put(section);
  if(slots.has(saved.id))copiedSlots.push({slot:slots.get(saved.id),sectionId:section.id});
 }
 await copyPdfImageGrants(store,id,destination,{signal});
 await checkPdfSources(publicationFiles,[...proof.values()]);await check?.();signal?.throwIfAborted();
 return {header,starter:copiedSlots.length?{...selected.starter,sections:copiedSlots}:null};
}
