import {AppError} from '../errors.js';
import {packageSelection} from './research-package.js';
import {RetainedFigureDocuments} from '../retained-figure-document.js';
import {dispatchRetainedFigure,validateRetainedFigureSource} from '../retained-figures.js';
import {ResearchMaterials} from '../research-materials.js';
import {validRetainedFigure} from '../web/retained-figure-model.js';
import {allFigurePlots} from '../web/figure-provenance.js';
import {recordRevision} from '../research.js';
import {revisionId,revisionText} from '../web/revision-model.js';
import {serialize,digest} from '../storage-format.js';
import {uuid} from '../modules/validation.js';
const valid=(condition,code='COLLABORATION_DENIED')=>{if(!condition)throw new AppError(code);};

// Packet membership and current grant admission precede every read. The caller
// supplies the selected record revision, never a figure descriptor or block root.
export function sharedReviewFigure(review,data,{signal,download,exporting=false}={}){
 const allowed=['workspaceId','reviewId','recordId','version','revision','figureId','expectedRevision',...(exporting?['format']:['operation','selection','window'])];
 valid(data&&Object.keys(data).every(key=>allowed.includes(key))&&uuid(data.workspaceId)&&uuid(data.reviewId)&&uuid(data.recordId)&&uuid(data.figureId)&&['base','incoming','current'].includes(data.version)&&revisionId(data.revision),'INVALID');
 return review.workspace.withCatalogueConnections(async()=>{
  const reader=await review.workspace.catalogue(async store=>{
  signal?.throwIfAborted();valid((await store.snapshot()).metadata.id===data.workspaceId,'WORKSPACE_CHANGED');
  const record=await review.record(data.reviewId,data.recordId,data.version);valid(record);
  valid(recordRevision(record)===data.revision,'RECORD_CHANGED');
  const figure=allFigurePlots(record.figures).find(value=>value.id===data.figureId);valid(validRetainedFigure(figure));
  const raw=await review.workspace.readMetadata('.observanda/collaboration/reviews/'+data.reviewId+'.json',16*1024*1024);valid(raw);
  const saved=JSON.parse(raw),{base,parts,selection}=await review.inputs(saved.packageId,{baseId:saved.baseId});
  let reader;
  if(data.version==='current'){
   const {reader:opened,source}=await validateRetainedFigureSource(new ResearchMaterials(review.workspace),figure,{signal});
   const member=source?await store.member(await store.snapshot(),source.recordId):null,owner=source?(member?await store.record(source.recordId,member.revision):null):record;
   const books=[...selection.metadata.notebooks,...(selection.kind==='offer'?(await packageSelection(base)).metadata.notebooks:[])];
   valid(owner&&books.some(book=>book.id===owner.notebookId));reader=opened;
  }else{
   const packet=data.version==='base'?base:parts;
   const adapter={readMetadata:async relative=>{
    signal?.throwIfAborted();valid(/^\.observanda\/materials\/figures\/(?:value|index)\/[a-f0-9]{64}\.json$/.test(relative));
    const part=await packet.descriptor('metadata',relative);valid(part&&part.size<=65536);
    return serialize(await packet.value('metadata',relative));
   }};
   if(figure.source){
    const ref=figure.source,pinned=await packet.value('metadata','.observanda/materials/objects/'+ref.id+'/'+ref.revision+'.json');
    valid(ref.kind==='analysis'&&pinned.kind===ref.kind&&pinned.id===ref.id&&digest(revisionText(pinned))===ref.revision&&validRetainedFigure(pinned.content?.figure)&&revisionText(pinned.content.figure.document.data)===revisionText(figure.document.data));
   }
   reader=await new RetainedFigureDocuments(adapter,{readOnly:true,signal}).open(figure);
  }
  return reader;
  });
  signal?.throwIfAborted();return dispatchRetainedFigure(reader,data.revision,data,{signal,download,exporting});
 });
}
