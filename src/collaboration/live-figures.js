import {liveValid as valid} from './live-protocol.js';
import {LiveRelationships} from './live-relationships.js';
import {LiveAttempts} from './live-attempts.js';
import {LiveEvidence} from './live-evidence.js';
import {LiveMaterialReading} from './live-material-reading.js';
import {RetainedFigureDocuments} from '../retained-figure-document.js';
import {dispatchRetainedFigure} from '../retained-figures.js';
import {validRetainedFigure} from '../web/retained-figure-model.js';
import {allFigurePlots} from '../web/figure-provenance.js';
import {revisionId,revisionText} from '../web/revision-model.js';
import {recordRevision} from '../research.js';
import {uuid,exact} from '../modules/validation.js';

// Resolve only through the record, linked revision or retained reference chain
// already admitted by the room. Figure/block roots are never request values.
export function liveFigure(research,identity,scope,data,{signal,download,exporting=false}={}){
 const allowed=['recordId','figureId','revision','via','expectedRevision',...(exporting?['format']:['operation','selection','window'])];
 valid(data&&Object.keys(data).every(k=>allowed.includes(k))&&uuid(data.recordId)&&uuid(data.figureId)&&revisionId(data.revision));
 return research.workspace.withCatalogueConnections(async()=>{
  const selectedReader=await research.workspace.catalogue(async store=>{
  signal?.throwIfAborted();const access=await research.authorized(identity,scope),readRecord=research.record.bind(research),source=await readRecord(store,access,data.recordId);let selected={record:source,revision:recordRevision(source)};
  const via=data.via;
  if(via){
   if(via.kind==='link'){valid(exact(via,['kind','id'])&&uuid(via.id));selected=await new LiveRelationships(research.workspace,readRecord).linked(store,access,source,via.id);}
   else{valid(exact(via,['kind','ref','trail'])&&['attempt','evidence'].includes(via.kind));const reader=via.kind==='attempt'?new LiveAttempts(research.workspace,readRecord):new LiveEvidence(research.workspace);selected=await reader.read(store,access,source,via.ref,via.trail);}
  }
  valid(selected.revision===data.revision,'RECORD_CHANGED');
  const figure=selected.record?allFigurePlots(selected.record.figures).find(f=>f.id===data.figureId):selected.document?.content?.figure;
  valid(figure?.id===data.figureId&&validRetainedFigure(figure),'COLLABORATION_DENIED');
  if(selected.record){
   valid(figure.source,'COLLABORATION_DENIED');const original=await new LiveMaterialReading(research.workspace,readRecord).resolve(store,access,figure.source);
   valid(validRetainedFigure(original.content?.figure)&&revisionText(original.content.figure.document.data)===revisionText(figure.document.data),'COLLABORATION_DENIED');
  }
  const reader=await new RetainedFigureDocuments(research.workspace,{readOnly:true,signal}).open(figure);
  return {reader,revision:selected.revision};
  });
  signal?.throwIfAborted();return dispatchRetainedFigure(selectedReader.reader,selectedReader.revision,data,{signal,download,exporting});
 });
}
