import {RetainedFigureDocuments} from './retained-figure-document.js';
import {figureCalculationFingerprint} from './record-figure-calculation.js';
import {hasRetainedFigureTarget} from './retained-figure-targets.js';
import {referenceNamespaceMatches} from './research-reference-namespace.js';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {RetainedRecordDocuments} from './retained-record-documents.js';
import {RecordMemberCollections} from './record-member-collections.js';
import {figurePlots,figureTargets} from './web/figure-composition.js';
import {RecordResultIndex} from './record-result-index.js';
import {resultFigureCount} from './record-result-document.js';
import {sameFigureCalculation} from './web/figure-result-links.js';
import {resolveFigureSources} from './figure-provenance.js';
import {ResearchMaterials} from './research-materials.js';
import {validFigureCopies,validFigureCopySource} from './web/record-figure-copy-model.js';
import {researchId} from './web/research-reference.js';
const exact=(v,keys)=>v&&Object.keys(v).sort().join()===keys.sort().join();
const invalid=()=>{throw new AppError('INVALID');};
const bound=command=>validFigureCopySource(command.source)&&command.source.id===command.recordId;
// An old namespace is valid only with this catalogue's identity-specific,
// authenticated ownership witness. Equal IDs in another workspace grant nothing.
async function authorizeSource(workspace,workspaceId,source=null){
 return workspace.catalogue(async store=>{
  if((await store.snapshot()).metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  if(source&&!await referenceNamespaceMatches(store,source))throw new AppError('WORKSPACE_CHANGED');
 });
}

export async function figureCopyChoices(workspace,command,{signal}={}){
 signal?.throwIfAborted();
 const child=Object.hasOwn(command,'figureId');
 if(!exact(command,['workspaceId','recordId','source','offset',...(child?['figureId']:[])])||![command.workspaceId,command.recordId].every(researchId)||!Number.isSafeInteger(command.offset)||command.offset<0||command.source!==null&&!bound(command)||child&&(!researchId(command.figureId)||!command.source))invalid();
 await authorizeSource(workspace,command.workspaceId,command.source);
 const retained=new RetainedRecordDocuments(workspace);
 const source=command.source??await workspace.withLock(()=>workspace.catalogue(async store=>{
  if((await store.snapshot()).metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  return retained.pinLocked(command.recordId);
 }));
 if(!source)throw new AppError('FORMAT');
 return retained.withDocument(source,async(document,row,store)=>{
  const text=value=>typeof value==='string'?value.slice(0,160):typeof value?.preview==='string'?value.preview.slice(0,160):'';
  const items=[];let total,offset;
  if(!child){
   total=await document.tree.arrayLength(document.root,['figures']);offset=Math.min(command.offset,Math.max(0,total-1));
   for(let index=offset;index<Math.min(offset+4,total);index++){
    signal?.throwIfAborted();const figure=(await document.field(['figures',String(index)],{signal})).value;
    const panels=figure.kind==='panels'||figure.kind==='retained'&&(await (await new RetainedFigureDocuments(workspace,{signal,readOnly:true}).open(figure)).header()).header.kind==='panels';
    items.push({figureId:figure.id,plotId:panels?null:figure.id,title:text(figure.title),type:panels?'panels':'plot'});
   }
  }else{
   const position=await figurePosition(document,row,store,command.figureId,{signal});if(position<0)throw new AppError('MISSING');
   const figure=(await document.field(['figures',String(position)],{signal})).value;
   if(figure.kind==='panels'){
    total=figure.panels.length;offset=Math.min(command.offset,Math.max(0,total-1));
    for(const panel of figure.panels.slice(offset,offset+4))items.push({figureId:figure.id,plotId:panel.figure.id,title:text(panel.label)+' - '+text(panel.figure.title),type:'plot'});
   }else if(figure.kind==='retained'){
    const reader=await new RetainedFigureDocuments(workspace,{signal,readOnly:true}).open(figure);if((await reader.header()).header.kind!=='panels')invalid();
    total=(await reader.scope({collection:'panels'})).total;offset=Math.min(command.offset,Math.max(0,total-1));
    for(const panel of (await reader.window({collection:'panels',offset,limit:4})).items)items.push({figureId:figure.id,plotId:panel.plotId,title:text(panel.value.label)+' - '+text(panel.value.header.title),type:'plot'});
   }else invalid();
  }
  return {workspaceId:command.workspaceId,recordId:command.recordId,source,figureId:command.figureId??null,total,offset,nextOffset:offset+4<total?offset+4:null,items};
 },{signal});
}
async function figurePosition(document,row,store,id,{signal}={}){
 if(row.revision)return new RecordMemberCollections(store).position(row,'figures',id);
 for await(const item of document.items(['figures'],{signal}))if((await document.tree.selected(item.value,['id'])).value===id)return item.index;
 return -1;
}
export async function withCopyOriginal(workspace,copy,consume,{signal}={}){
 return new RetainedRecordDocuments(workspace).withDocument(copy.source,async(document,row,store)=>{
  const position=await figurePosition(document,row,store,copy.figureId,{signal});
  if(position<0)throw new AppError('MISSING');
  const path=['figures',String(position)],kind=(await document.field([...path,'kind'],{signal})).value;let figure;
  if(kind==='retained'){
   figure=(await document.field(path,{signal})).value;if(!await hasRetainedFigureTarget(workspace,figure,copy.plotId,{signal}))throw new AppError('MISSING');
  }else if(kind!=='panels'&&copy.figureId===copy.plotId)figure=(await document.field(path,{signal})).value;
  else if(kind==='panels')for await(const panel of document.items([...path,'panels'],{signal})){
   if((await document.tree.selected(panel.value,['figure','id'])).value===copy.plotId){figure=(await document.tree.selected(panel.value,['figure'])).value;break;}
  }
  if(!figure)throw new AppError('MISSING');
  return consume(document,figure);
 },{signal});
}
// Merge the small association windows by their original position. A composition
// can link both its root and panels; grouping by figure would reorder results.
async function* figureStatements(document,ids,{signal}={}){
 const targets=new Set(ids),index=await RecordResultIndex.open(document,{signal});
 if(index){
  const windows=[];
  for(const id of targets){
   const page=await index.figureWindow(id,{limit:4,signal});
   if(page.total&&!page.rows.length)throw new AppError('CATALOGUE_DAMAGED');
   if(page.total)windows.push({id,...page,at:0});
  }
  while(windows.length){
   signal?.throwIfAborted();
   windows.sort((a,b)=>a.rows[a.at].position-b.rows[b.at].position);
   const window=windows[0],row=window.rows[window.at++];
   yield (await document.field(['results','statements',String(row.position)],{signal})).value;
   if(window.at===window.rows.length){
    const offset=window.offset+window.rows.length;
    if(offset>=window.total)windows.shift();
    else{
     const page=await index.figureWindow(window.id,{offset,limit:4,signal});
     if(page.offset!==offset||!page.rows.length)throw new AppError('CATALOGUE_DAMAGED');
     Object.assign(window,page,{at:0});
    }
   }
  }
  return;
 }
 if(await document.reference(['results','statements'],{signal}))for await(const item of document.items(['results','statements'],{signal})){
  if((await document.tree.selected(item.value,['kind'])).value==='figure'&&targets.has((await document.tree.selected(item.value,['figureId'])).value))yield await document.tree.read(item.value);
 }
}
async function hasFigureResults(document,ids,{signal}={}){
 const index=await RecordResultIndex.open(document,{signal});
 if(index){for(const id of ids)if(await index.hasFigure(id,{signal}))return true;return false;}
 for await(const statement of figureStatements(document,ids,{signal}))return true;
 return false;
}
async function appendStatements(document,statements,{signal}={}){
 const path=['results','statements'];let present=!!await document.reference(['results'],{signal}),offset=present?await document.tree.arrayLength(document.root,path):0,batch=[];
 const flush=async()=>{
  if(!batch.length)return;
  if(!present){document=await document.property([],'results',{version:1,statements:[]},{signal});present=true;}
  document=await document.splice(path,offset,0,batch,{signal});offset+=batch.length;batch=[];
 };
 for await(const statement of statements){signal?.throwIfAborted();batch.push(statement);if(batch.length===4)await flush();}
 await flush();return document;
}
export async function copyFigureDocumentResults(original,document,pairs,{signal,uuid=randomUUID,mapTarget}={}){
 async function* copies(){
  if(mapTarget){
   // The encrypted mapping is operation-scoped. Walk statements in their
   // original order rather than retaining one window per figure target.
   if(await original.reference(['results','statements'],{signal}))for await(const item of original.items(['results','statements'],{signal})){
    signal?.throwIfAborted();if((await original.tree.selected(item.value,['kind'])).value!=='figure')continue;
    const target=await mapTarget((await original.tree.selected(item.value,['figureId'])).value);if(target===undefined)continue;if(!researchId(target))invalid();
    yield {...await original.tree.read(item.value),id:uuid(),figureId:target};
   }
   return;
  }
  for(const [source,copy] of pairs){
   const from=figureTargets([source]),to=figureTargets([copy]),targets=new Map(from.map((figure,i)=>[figure.id,to[i].id]));
   for await(const statement of figureStatements(original,targets.keys(),{signal}))yield {...statement,id:uuid(),figureId:targets.get(statement.figureId)};
  }
 }
 return appendStatements(document,copies(),{signal});
}
export async function figureCopySource(workspace,command,options={}){
 if(!exact(command,['workspaceId','recordId','source','figureId','plotId'])||!bound(command)||![command.figureId,command.plotId].every(researchId))invalid();
 await authorizeSource(workspace,command.workspaceId,command.source);
 const {figure,statementCount}=await withCopyOriginal(workspace,command,async(document,figure)=>({figure,statementCount:await resultFigureCount(document,command.plotId,options)}),options);
 const resolved=await resolveFigureSources(new ResearchMaterials(workspace),{recordId:command.recordId,figures:[figure]},options);
 const source=resolved.sources.find(item=>item.figureId===figure.id)?.ref;if(source)figure.source=source;
 return {...command,figure,statementCount};
}
function validateCopyPlans(value,workspaceId,recordId){
 if(!validFigureCopies(value.copies,value.value))invalid();
 for(const copy of value.copies)if(copy.source.id!==recordId)invalid();
}
export async function validateFigureCopyPlans(workspace,value,workspaceId,recordId,options={}){
 if(!value.copies)return;
 validateCopyPlans(value,workspaceId,recordId);
 for(const copy of value.copies){await authorizeSource(workspace,workspaceId,copy.source);if(!await hasRetainedFigureTarget(workspace,value.value,copy.targetId,{...options,draft:true}))invalid();await withCopyOriginal(workspace,copy,()=>{},options);}
}
export async function applyFigureCopies(workspace,original,document,value,{workspaceId,recordId,signal}={}){
 if(!value.copies)return document;
 validateCopyPlans(value,workspaceId,recordId);
 const plots=figurePlots(value.value);let checked=false;
 for(const copy of value.copies){await authorizeSource(workspace,workspaceId,copy.source);await withCopyOriginal(workspace,copy,async(source,figure)=>{
  if(!await hasRetainedFigureTarget(workspace,value.value,copy.targetId,{signal}))invalid();
  if(!await resultFigureCount(source,copy.plotId,{signal}))return;
  const target=value.value.kind==='retained'?value.value:plots.find(plot=>plot.id===copy.targetId);
  if(figure.kind==='retained'||target.kind==='retained'){if(await figureCalculationFingerprint(workspace,figure,{plotId:copy.plotId,signal})!==await figureCalculationFingerprint(workspace,target,{plotId:copy.targetId,signal}))throw new AppError('FIGURE_COPY_CHANGED');}
  else if(!sameFigureCalculation(figure,target))throw new AppError('FIGURE_COPY_CHANGED');
  if(!checked){
   if(await hasFigureResults(original,value.copies.map(copy=>copy.targetId),{signal}))throw new AppError('FIGURE_RESULT_COPY');
   checked=true;
  }
  async function* statements(){for await(const statement of figureStatements(source,[copy.plotId],{signal}))yield {...statement,id:randomUUID(),figureId:copy.targetId};}
  document=await appendStatements(document,statements(),{signal});
 },{signal});}
 return document;
}
