import {selectPdfResearchTable} from './web/pdf-research-table.js';
import {PdfDocumentStore} from './pdf-document-store.js';
import {preparePdfFont} from './pdf-document-fonts.js';
import {pdfInlineFontIds} from './web/pdf-font-model.js';
import {BUNDLED_FONTS,customFontId} from './web/font-catalogue.js';
import {AppError} from './errors.js';
import {SnapshotIndex} from './snapshot-index.js';
import {withRecordDocument} from './record-document.js';
import {RecordMemberCollections,memberCollectionCount} from './record-member-collections.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validPdfResearch,pdfReferencedFigures} from './web/pdf-research-model.js';
const invalid=()=>{throw new AppError('INVALID');};
const exact=(v,keys)=>v&&Object.keys(v).sort().join()===keys.split(',').sort().join();
const natural=v=>Number.isSafeInteger(v)&&v>=0;
export function validPdfSourceSelection(value){return exact(value,'sourceId,snapshotId,recordId,collection,itemId'+(Object.hasOwn(value??{},'blockId')?',blockId':''))&&[value.sourceId,value.recordId,value.itemId].every(researchId)&&(value.snapshotId===null||revisionId(value.snapshotId))&&['body','sections','figures'].includes(value.collection)&&(!Object.hasOwn(value,'blockId')||researchId(value.blockId)&&['body','sections'].includes(value.collection));}
// Explicit authenticated sources include private research. No website sharing
// flags apply, and no source path or credential becomes document content.
export async function readPdfResearch(sourceReader,input,{signal,onSelection}={}){
 if(!input||!researchId(input.sourceId)||input.snapshotId!==null&&!revisionId(input.snapshotId))invalid();
 const {operation}=input;
 if(operation==='records'){if(!exact(input,'operation,sourceId,snapshotId,after,search')||input.after!==null&&!researchId(input.after)||typeof input.search!=='string'||input.search.length>160)invalid();}
 else if(operation==='parts'){if(!exact(input,'operation,sourceId,snapshotId,recordId,collection,offset')||!researchId(input.recordId)||!['sections','figures'].includes(input.collection)||!natural(input.offset))invalid();}
 else if(operation==='selection'){const {operation:_,...selection}=input;if(!validPdfSourceSelection(selection))invalid();}
 else invalid();
 const reader=await sourceReader({signal});
 try{
  const result=await reader.use(input.sourceId,input.snapshotId??undefined,async(store,snapshot,pinned)=>{
   const common={sourceId:input.sourceId,snapshotId:pinned.snapshotId};signal?.throwIfAborted();
   if(operation==='records'){
    const items=[],needle=input.search.trim().toLocaleLowerCase();let after=input.after,scanned=0,more=false;
    const rows=snapshot.indexVersion?new SnapshotIndex(store).members(snapshot.membership,{after:input.after}):snapshot.records.filter(row=>input.after===null||row.id>input.after).sort((a,b)=>a.id.localeCompare(b.id));
    for await(const row of rows){signal?.throwIfAborted();if(scanned===128||items.length===20){more=true;break;}scanned++;after=row.id;
     const [summary]=await Array.fromAsync(store.queryDocuments([row],snapshot.metadata,{signal,search:false}));
     if(!needle||summary.title.toLocaleLowerCase().includes(needle))items.push({id:row.id,title:summary.title,notebookId:row.notebookId});
    }
    return {...common,items,next:more?after:null};
   }
   const row=await store.member(snapshot,input.recordId);if(!row)throw new AppError('NOT_FOUND');
   return withRecordDocument(store,row.id,row.revision,async document=>{
    const field=async path=>(await document.field(path,{signal})).value;
    if(operation==='parts'){
     const total=memberCollectionCount(row,input.collection),items=[];
     if(!natural(total)||input.offset>total)invalid();
     for(let position=input.offset;position<Math.min(total,input.offset+20);position++){const path=[input.collection,String(position)];items.push({id:await field([...path,'id']),title:await field([...path,'title'])});}
     return {...common,recordId:row.id,recordRevision:row.revision,recordTitle:await field(['title']),items,total,next:input.offset+items.length<total?input.offset+items.length:null};
    }
    const collection=input.collection,index=new RecordMemberCollections(store);
    const selected=async(kind,id)=>{const position=await index.position(row,kind,id);if(position<0)throw new AppError('NOT_FOUND');return field([kind,String(position)]);};
    let title,content,figures=[];
    if(collection==='body'){if(input.itemId!==row.id)invalid();title=await field(['title']);content=await field(['body']);}
    else if(collection==='sections'){const section=await selected('sections',input.itemId);title=section.title;content=section.body;}
    else {const figure=await selected('figures',input.itemId);title=figure.title;figures=[figure];content={type:'doc',content:[{type:'book_figure',attrs:{version:1,id:figure.id,figureId:figure.id,alternative:figure.title}}]};}
    if(input.blockId){content=selectPdfResearchTable(content,input.blockId);if(!content)throw new AppError('PDF_SOURCE_CONTENT');title=content.content[0].attrs.title.slice(0,240);}
    if(collection!=='figures')for(const id of pdfReferencedFigures(content)){signal?.throwIfAborted();figures.push(await selected('figures',id));}
    const [summary]=await Array.fromAsync(store.queryDocuments([row],snapshot.metadata,{signal,search:false,revisions:true}));
    const value={version:1,workspaceId:input.sourceId,snapshotId:pinned.snapshotId,recordId:row.id,recordRevision:summary.revision,collection,itemId:input.itemId,...(input.blockId?{blockId:input.blockId}:{}),title,content,figures};
    if(!validPdfResearch(value))throw new AppError('PDF_SOURCE_CONTENT');
    if(Buffer.byteLength(JSON.stringify(value))>384*1024)throw new AppError('PDF_CAPACITY');
    if(onSelection)await onSelection(value,pinned.storage??store.workspace);
    return value;
   });
  });await reader.verify();signal?.throwIfAborted();return result.value;
 }finally{await reader.close();}
}
export async function retainPdfResearch(documents,sourceReader,input,options={}){
 if(!exact(input,'id,commandId,expectedRevision,sectionId,replace,source')||![input.id,input.commandId,input.sectionId].every(researchId)||!revisionId(input.expectedRevision)||typeof input.replace!=='boolean'||!validPdfSourceSelection(input.source)||input.source.snapshotId===null)invalid();
 // An exact retry uses the immutable section already published by this
 // command; source/library availability cannot change a committed capture.
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
 const preparedFonts=new Map(),research=await readPdfResearch(sourceReader,{operation:'selection',...input.source},{...options,onSelection:async(value,storage)=>{
  for(const id of pdfInlineFontIds(value.content)){if(BUNDLED_FONTS.some(font=>font.id===id))continue;if(!customFontId(id)||!storage)throw new AppError('PDF_FONT',[id]);preparedFonts.set(id,await preparePdfFont(storage,id,options));}
 }});
 const section={...(previous??{id:input.sectionId,layout:null,start:null}),title:research.title,content:research.content,figures:research.figures,research};
 return documents.change({id:input.id,commandId:input.commandId,expectedRevision:input.expectedRevision,operation:{type:input.replace?'section':'append',section}},{...options,preparedFonts});
}
