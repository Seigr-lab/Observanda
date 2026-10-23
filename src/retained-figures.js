import {AppError} from './errors.js';
import {RetainedFigureDocuments} from './retained-figure-document.js';
import {RetainedRecordDocuments} from './retained-record-documents.js';
import {RecordValues,selectedRecordValue} from './record-values.js';
import {RecordMemberCollections} from './record-member-collections.js';
import {validRetainedFigure,validRetainedFigureText} from './web/retained-figure-model.js';
import {validMaterialReference} from './web/material-reference.js';
import {researchId} from './web/research-reference.js';
import {revisionId,revisionText} from './web/revision-model.js';
import {retainedFigureSVG} from './web/retained-figure-svg.js';
import {retainedFigureTable,retainedFigureCSV} from './web/retained-figure-data.js';
const fail=()=>{throw new AppError('ANALYSIS_INVALID');};
export async function validateRetainedFigureSource(materials,figure,{signal,verify=false}={}){
 if(!validRetainedFigure(figure)||!figure.source)fail();signal?.throwIfAborted();const source=await materials.read(figure.source),stored=source.content.figure;
 if(!validRetainedFigure(stored)||revisionText(stored.document.data)!==revisionText(figure.document.data))fail();
 const reader=await new RetainedFigureDocuments(materials.workspace,{readOnly:true,signal}).open(figure);if(verify)await reader.verify({signal});return {reader,source};
}
// The request selects an admitted material or saved record member. The client
// never supplies a block root or a replacement retained descriptor.
export async function withRetainedFigure(materials,command,consume,{signal}={}){
 const run=()=>materials.readSnapshot(async()=>{
  signal?.throwIfAborted();let figure,revision=null;
  if(command.ref!==undefined){
   if(!validMaterialReference(command.ref)||!['analysis','record'].includes(command.ref.kind))fail();
   if(command.ref.kind==='analysis'){const doc=await materials.read(command.ref);figure=doc.content.figure;revision=command.ref.revision;}
   else{
    if(!researchId(command.figureId))fail();
    figure=await new RetainedRecordDocuments(materials.workspace).withDocument(command.ref,async(document,row,store)=>{
     const position=row.collections?await new RecordMemberCollections(store).position(row,'figures',command.figureId):undefined;
     return (await selectedRecordValue(document,'figure:'+command.figureId,{position,signal})).value.value;
    },{history:true,signal});revision=command.ref.revision;
   }
  }else{
   if(!researchId(command.workspaceId)||!researchId(command.recordId)||!researchId(command.figureId))fail();await materials.assertOwner(command.recordId);
   const selected=await new RecordValues(materials.workspace).read({workspaceId:command.workspaceId,recordId:command.recordId,field:'figure:'+command.figureId},{signal});figure=selected.value.value;revision=selected.revision;
  }
  if(command.expectedRevision!==undefined&&(!revisionId(command.expectedRevision)||command.expectedRevision!==revision))throw new AppError('RECORD_CHANGED');
  if(!validRetainedFigure(figure))fail();
  const reader=command.ref?.kind==='analysis'?await new RetainedFigureDocuments(materials.workspace,{readOnly:true,signal}).open(figure):(await validateRetainedFigureSource(materials,figure,{signal})).reader;
  return consume(reader,{revision,figure});
 });
 return materials.workspace.withCatalogueConnections?materials.workspace.withCatalogueConnections(run):run();
}
const selectorKeys=['ref','workspaceId','recordId','figureId','expectedRevision'];
export function retainedFigureRequest(materials,command,{signal,download,exporting=false}={}){
 const allowed=[...selectorKeys,...(exporting?['format']:['operation','selection','window'])];
 if(!command||typeof command!=='object'||Object.keys(command).some(key=>!allowed.includes(key)))throw new AppError('INVALID');
 return withRetainedFigure(materials,command,async(reader,{revision})=>{
  return dispatchRetainedFigure(reader,revision,command,{signal,download,exporting});
 },{signal});
}
// Callers authorize and select an immutable figure before dispatching a bounded
// read or complete export. This helper never accepts a client document root.
export async function dispatchRetainedFigure(reader,revision,command,{signal,download,exporting=false}={}){
 if(command.expectedRevision!==undefined&&command.expectedRevision!==revision)throw new AppError('RECORD_CHANGED');
  if(exporting){
   if(typeof download!=='function'||!['svg','csv','json'].includes(command.format))throw new AppError('INVALID');
   const chunks=command.format==='svg'?retainedFigureSVG(reader,{signal}):command.format==='csv'?retainedFigureCSV(reader,{signal}):reader.json({signal});
   return download({name:'figure.'+command.format,contentType:command.format==='svg'?'image/svg+xml':command.format==='csv'?'text/csv; charset=utf-8':'application/json; charset=utf-8',chunks});
  }
  const selection=command.selection??{};
  switch(command.operation??'open'){
   case 'open':case 'header':return {...await reader.header(selection),revision};
   case 'cells':return {...await reader.cells(selection),revision};
   case 'window':return {...await reader.window(selection),revision};
   case 'item':return {item:await reader.item(selection),revision};
   case 'text':if(!validRetainedFigureText(selection))throw new AppError('INVALID');return {...await reader.text(selection),revision};
   case 'svg':{
    const window=command.window;if(!window||Object.keys(window).some(key=>!['plotId','seriesOffset','seriesLimit','pointOffset','pointLimit'].includes(key))||!researchId(window.plotId)||!['seriesOffset','pointOffset'].every(key=>Number.isSafeInteger(window[key]??0)&&(window[key]??0)>=0)||!Number.isInteger(window.seriesLimit)||window.seriesLimit<1||window.seriesLimit>16||!Number.isInteger(window.pointLimit)||window.pointLimit<1||window.pointLimit>128)throw new AppError('INVALID');
    let svg='',bytes=0;for await(const chunk of retainedFigureSVG(reader,{signal,window})){bytes+=Buffer.byteLength(chunk);if(bytes>4*1024*1024)throw new AppError('LIMIT');svg+=chunk;}return {svg,revision,...await reader.header({plotId:window.plotId}),window};
   }
   default:throw new AppError('INVALID');
  }
}

export {retainedFigureSVG,retainedFigureTable,retainedFigureCSV};
