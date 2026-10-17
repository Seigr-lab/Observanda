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
const bound=(command)=>validFigureCopySource(command.source)&&command.source.workspaceId===command.workspaceId&&command.source.id===command.recordId;

export async function figureCopyChoices(workspace,command,{signal}={}){
 signal?.throwIfAborted();
 if(!exact(command,['workspaceId','recordId','source','offset'])||![command.workspaceId,command.recordId].every(researchId)||!Number.isSafeInteger(command.offset)||command.offset<0||command.source!==null&&!bound(command))invalid();
 const retained=new RetainedRecordDocuments(workspace);
 const source=command.source??await workspace.withLock(()=>workspace.catalogue(async store=>{
  if((await store.snapshot()).metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  return retained.pinLocked(command.recordId);
 }));
 if(!source)throw new AppError('FORMAT');
 return retained.withDocument(source,async document=>{
  const total=await document.tree.arrayLength(document.root,['figures']),offset=Math.min(command.offset,Math.max(0,total-1)),items=[];
  for(let index=offset;index<Math.min(offset+4,total);index++){
   signal?.throwIfAborted();const path=['figures',String(index)],read=async tail=>(await document.field([...path,...tail],{signal})).value;
   const figureId=await read(['id']),title=await read(['title']);
   if(await read(['kind'])!=='panels')items.push({figureId,plotId:figureId,title});
   else for await(const panel of document.items([...path,'panels'],{signal})){
    const get=async tail=>(await document.tree.selected(panel.value,tail)).value;
    items.push({figureId,plotId:await get(['figure','id']),title:title+' · '+await get(['label'])+' · '+await get(['figure','title'])});
   }
  }
  return {workspaceId:command.workspaceId,recordId:command.recordId,source,total,offset,nextOffset:offset+4<total?offset+4:null,items};
 },{signal});
}
async function withCopyOriginal(workspace,copy,consume,{signal}={}){
 return new RetainedRecordDocuments(workspace).withDocument(copy.source,async(document,row,store)=>{
  let position=row.revision?await new RecordMemberCollections(store).position(row,'figures',copy.figureId):-1;
  if(!row.revision)for await(const item of document.items(['figures'],{signal}))if((await document.tree.selected(item.value,['id'])).value===copy.figureId){position=item.index;break;}
  if(position<0)throw new AppError('MISSING');
  const path=['figures',String(position)],kind=(await document.field([...path,'kind'],{signal})).value;let figure;
  if(kind!=='panels'&&copy.figureId===copy.plotId)figure=(await document.field(path,{signal})).value;
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
export async function copyFigureDocumentResults(original,document,pairs,{signal,uuid=randomUUID}={}){
 async function* copies(){
  for(const [source,copy] of pairs){
   const from=figureTargets([source]),to=figureTargets([copy]),targets=new Map(from.map((figure,i)=>[figure.id,to[i].id]));
   for await(const statement of figureStatements(original,targets.keys(),{signal}))yield {...statement,id:uuid(),figureId:targets.get(statement.figureId)};
  }
 }
 return appendStatements(document,copies(),{signal});
}
export async function figureCopySource(workspace,command,options={}){
 if(!exact(command,['workspaceId','recordId','source','figureId','plotId'])||!bound(command)||![command.figureId,command.plotId].every(researchId))invalid();
 const {figure,statementCount}=await withCopyOriginal(workspace,command,async(document,figure)=>({figure,statementCount:await resultFigureCount(document,command.plotId,options)}),options);
 const resolved=await resolveFigureSources(new ResearchMaterials(workspace),{recordId:command.recordId,figures:[figure]},options);
 const source=resolved.sources.find(item=>item.figureId===figure.id)?.ref;if(source)figure.source=source;
 return {...command,figure,statementCount};
}
function validateCopyPlans(value,workspaceId,recordId){
 if(!validFigureCopies(value.copies,value.value))invalid();
 for(const copy of value.copies)if(copy.source.workspaceId!==workspaceId||copy.source.id!==recordId)invalid();
}
export async function validateFigureCopyPlans(workspace,value,workspaceId,recordId,options={}){
 if(!value.copies)return;
 validateCopyPlans(value,workspaceId,recordId);
 for(const copy of value.copies)await withCopyOriginal(workspace,copy,()=>{},options);
}
export async function applyFigureCopies(workspace,original,document,value,{workspaceId,recordId,signal}={}){
 if(!value.copies)return document;
 validateCopyPlans(value,workspaceId,recordId);
 const plots=figurePlots(value.value);let checked=false;
 for(const copy of value.copies)await withCopyOriginal(workspace,copy,async(source,figure)=>{
  if(!await resultFigureCount(source,copy.plotId,{signal}))return;
  const target=plots.find(plot=>plot.id===copy.targetId);
  if(!sameFigureCalculation(figure,target))throw new AppError('FIGURE_COPY_CHANGED');
  if(!checked){
   if(await hasFigureResults(original,value.copies.map(copy=>copy.targetId),{signal}))throw new AppError('FIGURE_RESULT_COPY');
   checked=true;
  }
  document=await copyFigureDocumentResults(source,document,[[figure,target]],{signal});
 },{signal});
 return document;
}
