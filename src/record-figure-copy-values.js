import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {RetainedRecordDocuments} from './retained-record-documents.js';
import {RecordMemberCollections} from './record-member-collections.js';
import {figurePlots} from './web/figure-composition.js';
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
async function copyOriginal(workspace,copy,{signal}={}){
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
  const statements=[];
  if(await document.reference(['results','statements'],{signal}))for await(const item of document.items(['results','statements'],{signal})){
   if((await document.tree.selected(item.value,['kind'])).value==='figure'&&(await document.tree.selected(item.value,['figureId'])).value===copy.plotId)statements.push(await document.tree.read(item.value));
  }
  return {figure,statements};
 },{signal});
}
export async function figureCopySource(workspace,command,options={}){
 if(!exact(command,['workspaceId','recordId','source','figureId','plotId'])||!bound(command)||![command.figureId,command.plotId].every(researchId))invalid();
 const {figure,statements}=await copyOriginal(workspace,command,options),resolved=await resolveFigureSources(new ResearchMaterials(workspace),{recordId:command.recordId,figures:[figure]},options);
 const source=resolved.sources.find(item=>item.figureId===figure.id)?.ref;if(source)figure.source=source;
 return {...command,figure,statementCount:statements.length};
}
export async function validateFigureCopyPlans(workspace,value,workspaceId,recordId,options={}){
 if(!value.copies)return;
 if(!validFigureCopies(value.copies,value.value))invalid();
 for(const copy of value.copies){
  if(copy.source.workspaceId!==workspaceId||copy.source.id!==recordId)invalid();
  await copyOriginal(workspace,copy,options);
 }
}
export async function applyFigureCopies(workspace,original,document,value,{workspaceId,recordId,signal}={}){
 if(!value.copies)return document;
 await validateFigureCopyPlans(workspace,value,workspaceId,recordId,{signal});
 const plots=figurePlots(value.value),additions=[];
 for(const copy of value.copies){
  const {figure,statements}=await copyOriginal(workspace,copy,{signal}),target=plots.find(plot=>plot.id===copy.targetId);
  if(statements.length&&!sameFigureCalculation(figure,target))throw new AppError('FIGURE_COPY_CHANGED');
  for(const statement of statements)additions.push({...statement,id:randomUUID(),figureId:target.id});
 }
 if(!additions.length)return document;
 const results=(await original.field(['results'],{signal})).value??{version:1,statements:[]};
 if(results.statements.length+additions.length>64)throw new AppError('FIGURE_RESULT_COPY');
 const existing=new Set(results.statements.map(statement=>statement.figureId));if(value.copies.some(copy=>existing.has(copy.targetId)))throw new AppError('FIGURE_RESULT_COPY');
 return document.property([],'results',{...results,statements:[...results.statements,...additions]});
}
