// Keep the retained-provenance verifier independent of research-owner loading.
// Source access modules are opened only by an authorized async read/retain.
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {PDF_IMAGE_MAX_BYTES,pdfImagePlacement} from './web/pdf-image-model.js';
const prefix='pdf-source-image:';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.split(',').sort().join();
const hash=value=>digest(serialize(value));
const invalid=()=>{throw new AppError('INVALID');},bad=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const text=(value,required=false)=>typeof value==='string'&&value.length<=2000&&(!required||!!value.trim())&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const bytes=value=>Number.isSafeInteger(value)&&value>0&&value<=PDF_IMAGE_MAX_BYTES;
const rasterName=value=>typeof value==='string'&&/\.(?:png|jpe?g|webp|bmp|tiff?)$/i.test(value);
export function validPdfResearchImageSource(value){
 return exact(value,'version,workspaceId,snapshotId,recordId,recordRevision,collection,itemId,itemRevision,sha256,bytes')&&value.version===1&&[value.workspaceId,value.recordId,value.itemId].every(researchId)&&[value.snapshotId,value.recordRevision,value.sha256].every(revisionId)&&['attachments','artifacts'].includes(value.collection)&&(value.collection==='attachments'?value.itemRevision===null:revisionId(value.itemRevision))&&bytes(value.bytes);
}
function validCommand(value){return exact(value,'id,commandId,expectedRevision,sectionId,imageId,source,alt,caption')&&[value.id,value.commandId,value.sectionId,value.imageId].every(researchId)&&revisionId(value.expectedRevision)&&validPdfResearchImageSource(value.source)&&text(value.alt,true)&&text(value.caption);}
const receiptKey=(id,imageId)=>prefix+id+':'+imageId;
function checkedReceipt(value,id,imageId){
 if(!exact(value,'version,command,fingerprint,asset,revision')||value.version!==1||!validCommand(value.command)||value.command.id!==id||value.command.imageId!==imageId||value.fingerprint!==hash(value.command)||![value.asset,value.revision].every(revisionId))bad();return value;
}
export {pdfFileImages as readPdfResearchImages} from './pdf-publication-files.js';
import {pdfFileImageBytes} from './pdf-publication-files.js';
export async function retainPdfResearchImage(documents,publicationFiles,input,{signal,check=async()=>{}}={}){
 if(!validCommand(input))invalid();input={...input,source:{...input.source}};await check();signal?.throwIfAborted();if(!await documents.available())throw new AppError('NOT_FOUND');const fingerprint=hash(input),[{PdfDocumentStore},{PdfDocumentImages,preparePdfImage}]=await Promise.all([import('./pdf-document-store.js'),import('./pdf-document-images.js')]);
 const replay=store=>async()=>{const value=await store.object(receiptKey(input.id,input.imageId));if(value===null)return null;const receipt=checkedReceipt(value,input.id,input.imageId);if(receipt.fingerprint!==fingerprint)throw new AppError('MODULE_REPLAY');await new PdfDocumentStore(store).revision(input.id,receipt.revision);return {revision:receipt.revision,replayed:true};};
 const prior=await documents.domains.run(['pdf'],get=>replay(get('pdf'))(),{signal,check});if(prior){await pdfFileImageBytes(publicationFiles,input.source,{signal});return prior;}
 await documents.read('section',{id:input.id,sectionId:input.sectionId,revision:input.expectedRevision},{signal,check});const original=await pdfFileImageBytes(publicationFiles,input.source,{signal});let prepared;try{prepared=await preparePdfImage(original,{signal,approvedSvg:true});}finally{original.fill(0);}await check();signal?.throwIfAborted();
 return documents.domains.run(['pdf'],async get=>{
  const store=get('pdf'),previous=await replay(store)();if(previous)return previous;const owner=new PdfDocumentStore(store),selected=await owner.section(input.id,input.sectionId,{revision:input.expectedRevision});if(selected.section.images?.some(image=>image.id===input.imageId))throw new AppError('EXISTS');
  const asset=await new PdfDocumentImages(store,input.id).retain(prepared,{signal}),image=pdfImagePlacement(asset,{id:input.imageId,alt:input.alt,caption:input.caption}),section={...selected.section,images:[...(selected.section.images??[]),image]},result=await owner.change({id:input.id,commandId:input.commandId,expectedRevision:input.expectedRevision,operation:{type:'section',section}},{signal});
  await store.putObject(receiptKey(input.id,input.imageId),{version:1,command:input,fingerprint,asset:asset.asset,revision:result.revision});signal?.throwIfAborted();return result;
 },{signal,check,write:['pdf']});
}
// Retained provenance is authenticated locally. Historical PDF verification
// never needs the selected research owner to remain open or even available.
export async function verifyPdfResearchImages(store,{signal}={}){
 if(store.domain!=='pdf')invalid();let images=0;const [{PdfDocumentStore},{PdfDocumentImages}]=await Promise.all([import('./pdf-document-store.js'),import('./pdf-document-images.js')]),owner=new PdfDocumentStore(store);
 for await(const key of store.objectIdEntries(prefix,{signal})){
  signal?.throwIfAborted();const parts=key.slice(prefix.length).split(':');if(parts.length!==2||!parts.every(researchId))bad();const receipt=checkedReceipt(await store.object(key),...parts),command=receipt.command,value=await owner.revision(command.id,receipt.revision),entry=await owner.index(command.id).find({root:value.sections},command.sectionId);if(!entry)bad();
  const {section}=await owner.sectionRow(command.id,entry.revision,command.sectionId),image=section.images?.find(image=>image.id===command.imageId);let asset;try{asset=await new PdfDocumentImages(store,command.id).descriptor(receipt.asset);}catch(error){if(error.code==='NOT_FOUND')bad();throw error;}if(!image||serialize(image)!==serialize(pdfImagePlacement(asset,{id:command.imageId,alt:command.alt,caption:command.caption})))bad();
  const saved=await store.object('pdf:command:'+command.id+':'+command.commandId);if(saved?.revision!==receipt.revision||saved.fingerprint!==hash({id:command.id,expectedRevision:command.expectedRevision,operation:{type:'section',section}}))bad();images++;
 }
 return {images};
}
