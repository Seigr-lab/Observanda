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
async function selectedRecord(store,snapshot,id,signal){
 const row=await store.member(snapshot,id);if(!row)throw new AppError('NOT_FOUND');
 const [summary]=await Array.fromAsync(store.queryDocuments([row],snapshot.metadata,{signal,search:false,revisions:true}));if(!revisionId(summary?.revision))bad();return {row,recordRevision:summary.revision};
}
function sourcePin(common,collection,itemId,itemRevision,sha256,size){const value={version:1,...common,collection,itemId,itemRevision,sha256,bytes:size};if(!validPdfResearchImageSource(value))bad();return value;}
async function attachment(document,position,signal){const result={};for(const name of ['id','kind','caption','alt'])result[name]=(await document.field(['attachments',String(position),name],{signal})).value;return result;}
// Discovery opens one authorized record and never hydrates its attachment array.
// Artifact names only filter raster candidates; selection still decodes the bytes.
export async function readPdfResearchImages(sourceReader,input,{signal}={}){
 if(!exact(input,'sourceId,snapshotId,recordId,collection,offset,cursor')||![input.sourceId,input.recordId].every(researchId)||!revisionId(input.snapshotId)||!['attachments','artifacts'].includes(input.collection)||!natural(input.offset)||input.cursor!==null&&(typeof input.cursor!=='string'||input.cursor.length>4096)||input.collection==='attachments'&&input.cursor!==null||input.collection==='artifacts'&&input.offset!==0)invalid();
 const [{withRecordDocument},{memberCollectionCount},{MediaStore},{ResearchMaterials}]=await Promise.all([import('./record-document.js'),import('./record-member-collections.js'),import('./media.js'),import('./research-materials.js')]);
 const reader=await sourceReader({signal});try{
  const result=await reader.use(input.sourceId,input.snapshotId,async(store,snapshot,pinned)=>{
   signal?.throwIfAborted();const {row,recordRevision}=await selectedRecord(store,snapshot,input.recordId,signal),common={workspaceId:input.sourceId,snapshotId:pinned.snapshotId,recordId:row.id,recordRevision},storage=pinned.storage??store.workspace,items=[];let next=null;
   if(!storage||snapshot.metadata.id!==input.sourceId)bad();
   if(input.collection==='attachments')await withRecordDocument(store,row.id,row.revision,async document=>{
    const total=memberCollectionCount(row,'attachments')??await document.tree.arrayLength(document.root,['attachments']);if(input.offset>total)invalid();let position=input.offset,scanned=0;const media=new MediaStore(storage);
    while(position<total&&scanned<128&&items.length<20){signal?.throwIfAborted();const value=await attachment(document,position++,signal);scanned++;if(value.kind!=='image')continue;const {metadata}=await media.metadata(value.id);if(metadata.kind!=='image')bad();if(!bytes(metadata.bytes))continue;items.push({label:value.caption||value.alt||value.id,source:sourcePin(common,'attachments',value.id,null,metadata.sha256,metadata.bytes)});}
    next=position<total?position:null;
   });
   else{
    const materials=new ResearchMaterials(storage);if(await materials.index.state()){
     const page=await materials.index.page({recordId:row.id,kind:'artifact',cursor:input.cursor,limit:20,signal},{initialize:false});next=page.next;
     for(const head of page.items){signal?.throwIfAborted();const doc=await materials.read(head);if(doc.recordId!==row.id)bad();if(!rasterName(doc.content.name)||!bytes(doc.content.size))continue;items.push({label:doc.title,source:sourcePin(common,'artifacts',doc.id,head.revision,doc.content.sha256,doc.content.size)});}
    }else if(input.cursor!==null)invalid();
   }
   return {sourceId:input.sourceId,snapshotId:pinned.snapshotId,recordId:row.id,items,next};
  });await reader.verify();signal?.throwIfAborted();return result.value;
 }finally{await reader.close();}
}
async function readSelected(sourceReader,source,{signal}={}){
 const [{withRecordDocument},{RecordMemberCollections},{MediaStore},{ResearchMaterials}]=await Promise.all([import('./record-document.js'),import('./record-member-collections.js'),import('./media.js'),import('./research-materials.js')]);
 const reader=await sourceReader({signal});try{
  const result=await reader.use(source.workspaceId,source.snapshotId,async(store,snapshot,pinned)=>{
   const {row,recordRevision}=await selectedRecord(store,snapshot,source.recordId,signal);if(recordRevision!==source.recordRevision||pinned.snapshotId!==source.snapshotId)throw new AppError('PDF_SOURCE_CONTENT');const storage=pinned.storage??store.workspace;if(!storage||snapshot.metadata.id!==source.workspaceId)bad();let content;
   if(source.collection==='attachments'){
    const position=await new RecordMemberCollections(store).position(row,'attachments',source.itemId);if(position<0)throw new AppError('NOT_FOUND');
    await withRecordDocument(store,row.id,row.revision,async document=>{const value=await attachment(document,position,signal);if(value.id!==source.itemId||value.kind!=='image')throw new AppError('PDF_SOURCE_CONTENT');});
    const media=new MediaStore(storage),{metadata}=await media.metadata(source.itemId);if(metadata.kind!=='image'||metadata.sha256!==source.sha256||metadata.bytes!==source.bytes)throw new AppError('PDF_SOURCE_CONTENT');content=(await media.get(source.itemId,{streamed:true,signal,includeHeader:false})).bytes;
   }else{
    const materials=new ResearchMaterials(storage),ref={kind:'artifact',id:source.itemId,revision:source.itemRevision},doc=await materials.read(ref);if(doc.recordId!==row.id||doc.content.sha256!==source.sha256||doc.content.size!==source.bytes)throw new AppError('PDF_SOURCE_CONTENT');content=await materials.originalContent(doc);
   }
   if(content.size!==source.bytes||content.sha256!==source.sha256)throw new AppError('PDF_SOURCE_CONTENT');const chunks=[];let size=0;
   for await(const chunk of content.read(0,content.size-1,{signal})){signal?.throwIfAborted();size+=chunk.length;if(size>source.bytes||size>PDF_IMAGE_MAX_BYTES)throw new AppError('MEDIA_LIMIT');chunks.push(chunk);}
   const value=Buffer.concat(chunks);if(size!==source.bytes||digest(value)!==source.sha256)throw new AppError('PDF_SOURCE_CONTENT');return value;
  });await reader.verify();signal?.throwIfAborted();return result.value;
 }finally{await reader.close();}
}
export async function retainPdfResearchImage(documents,sourceReader,input,{signal,check=async()=>{}}={}){
 if(!validCommand(input))invalid();input={...input,source:{...input.source}};await check();signal?.throwIfAborted();if(!await documents.available())throw new AppError('NOT_FOUND');const fingerprint=hash(input),[{PdfDocumentStore},{PdfDocumentImages,preparePdfImage}]=await Promise.all([import('./pdf-document-store.js'),import('./pdf-document-images.js')]);
 const replay=store=>async()=>{const value=await store.object(receiptKey(input.id,input.imageId));if(value===null)return null;const receipt=checkedReceipt(value,input.id,input.imageId);if(receipt.fingerprint!==fingerprint)throw new AppError('MODULE_REPLAY');await new PdfDocumentStore(store).revision(input.id,receipt.revision);return {revision:receipt.revision,replayed:true};};
 const prior=await documents.domains.run(['pdf'],get=>replay(get('pdf'))(),{signal,check});if(prior)return prior;
 await documents.read('section',{id:input.id,sectionId:input.sectionId,revision:input.expectedRevision},{signal,check});const original=await readSelected(sourceReader,input.source,{signal});let prepared;try{prepared=await preparePdfImage(original,{signal});}finally{original.fill(0);}await check();signal?.throwIfAborted();
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
