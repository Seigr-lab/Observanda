import {AppError} from './errors.js';
import {serialize,digest} from './storage-format.js';
import {RetainedFigureDocuments} from './retained-figure-document.js';
import {retainedFigureBlockChildren} from './retained-figure-blocks.js';
import {validateRetainedFigureSource} from './retained-figures.js';
import {validRetainedFigure} from './web/retained-figure-model.js';
import {researchId} from './web/research-reference.js';
const fail=()=>{throw new AppError('JOB_DAMAGED');};
const key=(recordId,figureId)=>recordId+'/'+figureId;
export const PUBLICATION_FIGURE_COLLECTIONS=Object.freeze({retainedFigures:{indexes:['record']},figureBlocks:{indexes:[]}});
export async function retainPublicationFigures(builder,materials,record,recordId,{signal}={}){
 let count=0;
 for(const figure of record.figures??[]){
  if(figure.kind!=='retained')continue;signal?.throwIfAborted();
  const {reader}=await validateRetainedFigureSource(materials,figure,{signal});
  for(const [name,definition]of Object.entries(PUBLICATION_FIGURE_COLLECTIONS))builder.ensureCollection(name,definition);
  for await(const block of reader.blocks({signal})){
   const id=block.kind+'/'+block.revision,prior=await builder.get('figureBlocks',id,{signal});
   if(prior!==null&&prior!==undefined){if(serialize(prior)!==serialize(block.node))fail();}else await builder.append('figureBlocks',id,block.node,{signal});
  }
  await builder.append('retainedFigures',key(recordId,figure.id),{recordId,figure},{indexes:{record:recordId+'/'},signal});count++;
 }return count;
}
export async function openPublicationFigure(input,recordId,figureId,{signal}={}){
 if(!input.native||!input.document.collectionNames().includes('retainedFigures'))fail();
 const selected=await input.document.get('retainedFigures',key(recordId,figureId),{signal});if(!selected||selected.recordId!==recordId||selected.figure?.id!==figureId||!validRetainedFigure(selected.figure))fail();
 const storage={readMetadata:async relative=>{const match=/^\.observanda\/materials\/figures\/(value|index)\/([a-f0-9]{64})\.json$/.exec(relative);if(!match)fail();const value=await input.document.get('figureBlocks',match[1]+'/'+match[2],{signal});return value===null||value===undefined?null:serialize(value);}};
 return new RetainedFigureDocuments(storage,{readOnly:true,signal}).open(selected.figure);
}
export async function verifyPublicationFigureEntry(input,collection,id,value,{signal}={}){
 if(collection==='figureBlocks'){
  const match=/^(value|index)\/([a-f0-9]{64})$/.exec(id);if(!match||digest(serialize(value))!==match[2])fail();retainedFigureBlockChildren(match[1],value);return;
 }
 if(!value||Object.keys(value).sort().join()!=='figure,recordId'||!researchId(value.recordId)||!validRetainedFigure(value.figure)||id!==key(value.recordId,value.figure.id))fail();
 const record=await input.record(value.recordId),figure=record.figures.find(figure=>figure.id===value.figure.id);if(serialize(figure)!==serialize(value.figure))fail();
 const reader=await openPublicationFigure(input,value.recordId,value.figure.id,{signal});await reader.verify({signal});
}
export async function verifyPublicationFigures(input,record,{signal}={}){
 for(const figure of record.figures??[])if(figure.kind==='retained'){
  const reader=await openPublicationFigure(input,record.id,figure.id,{signal});if(serialize(reader.figure)!==serialize(figure))fail();
 }
}
