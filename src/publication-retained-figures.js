import {AppError} from './errors.js';
import {serialize,digest} from './storage-format.js';
import {RetainedFigureDocuments} from './retained-figure-document.js';
import {retainedFigureBlockChildren} from './retained-figure-blocks.js';
import {validateRetainedFigureSource} from './retained-figures.js';
import {validRetainedFigure} from './web/retained-figure-model.js';
import {researchId} from './web/research-reference.js';
import {hasRetainedFigure} from './record-retained-figures.js';
import {allFigurePlots} from './web/figure-provenance.js';
import {RetainedFigureAuthoring} from './retained-figure-authoring.js';
import {figureCalculationFingerprint} from './record-figure-calculation.js';
const fail=()=>{throw new AppError('JOB_DAMAGED');};
const key=(recordId,figureId)=>recordId+'/'+figureId;
export const PUBLICATION_FIGURE_COLLECTIONS=Object.freeze({retainedFigures:{indexes:['record']},figureBlocks:{indexes:[]}});
export async function retainPublicationFigures(builder,materials,record,recordId,{signal}={}){
 let count=0;
 for(const figure of record.figures??[]){
  if(!hasRetainedFigure(figure))continue;signal?.throwIfAborted();
  for(const [name,definition]of Object.entries(PUBLICATION_FIGURE_COLLECTIONS))builder.ensureCollection(name,definition);
  let reader,renderedFigure;
  if(figure.kind==='retained')({reader}=await validateRetainedFigureSource(materials,figure,{signal}));
  else{
   for(const child of allFigurePlots([figure]))if(child.kind==='retained')await validateRetainedFigureSource(materials,child,{signal});
   const storage={
    async readMetadata(relative){const match=/^\.observanda\/materials\/figures\/(value|index)\/([a-f0-9]{64})\.json$/.exec(relative);if(!match)fail();const prior=await builder.get('figureBlocks',match[1]+'/'+match[2],{signal});return prior===null||prior===undefined?materials.workspace.readMetadata(relative,65536):serialize(prior);},
    async writeMetadata(relative,text){signal?.throwIfAborted();const match=/^\.observanda\/materials\/figures\/(value|index)\/([a-f0-9]{64})\.json$/.exec(relative);if(!match||digest(text)!==match[2])fail();const node=JSON.parse(text),id=match[1]+'/'+match[2],prior=await builder.get('figureBlocks',id,{signal});if(prior!==null&&prior!==undefined){if(serialize(prior)!==text)fail();}else await builder.append('figureBlocks',id,node,{signal});}
   };
   const authoring=new RetainedFigureAuthoring(storage,{signal});renderedFigure=await authoring.finish(await authoring.start(figure));reader=await new RetainedFigureDocuments(storage,{readOnly:true,signal}).open(renderedFigure);
   for(const panel of figure.panels)if(await figureCalculationFingerprint(storage,panel.figure,{signal})!==await figureCalculationFingerprint(storage,renderedFigure,{plotId:panel.figure.id,signal}))fail();
  }
  for await(const block of reader.blocks({signal})){
   const id=block.kind+'/'+block.revision,prior=await builder.get('figureBlocks',id,{signal});
   if(prior!==null&&prior!==undefined){if(serialize(prior)!==serialize(block.node))fail();}else await builder.append('figureBlocks',id,block.node,{signal});
  }
  await builder.append('retainedFigures',key(recordId,figure.id),{recordId,figure,...(renderedFigure?{renderedFigure}:{})},{indexes:{record:recordId+'/'},signal});count++;
 }return count;
}
export async function openPublicationFigure(input,recordId,figureId,{signal}={}){
 if(!input.native||!input.document.collectionNames().includes('retainedFigures'))fail();
 const selected=await input.document.get('retainedFigures',key(recordId,figureId),{signal});if(!selected||selected.recordId!==recordId||selected.figure?.id!==figureId||!(selected.renderedFigure?hasRetainedFigure(selected.figure)&&selected.figure.kind==='panels'&&validRetainedFigure(selected.renderedFigure)&&selected.renderedFigure.id===figureId:validRetainedFigure(selected.figure)))fail();
 const storage={readMetadata:async relative=>{const match=/^\.observanda\/materials\/figures\/(value|index)\/([a-f0-9]{64})\.json$/.exec(relative);if(!match)fail();const value=await input.document.get('figureBlocks',match[1]+'/'+match[2],{signal});return value===null||value===undefined?null:serialize(value);}};
 const reader=await new RetainedFigureDocuments(storage,{readOnly:true,signal}).open(selected.renderedFigure??selected.figure);if(selected.renderedFigure)reader.originalFigure=selected.figure;return reader;
}
export async function verifyPublicationFigureEntry(input,collection,id,value,{signal}={}){
 if(collection==='figureBlocks'){
  const match=/^(value|index)\/([a-f0-9]{64})$/.exec(id);if(!match||digest(serialize(value))!==match[2])fail();retainedFigureBlockChildren(match[1],value);return;
 }
 if(!value||Object.keys(value).sort().join()!==(value.renderedFigure?'figure,recordId,renderedFigure':'figure,recordId')||!researchId(value.recordId)||!(value.renderedFigure?hasRetainedFigure(value.figure)&&value.figure.kind==='panels'&&validRetainedFigure(value.renderedFigure)&&value.renderedFigure.id===value.figure.id:validRetainedFigure(value.figure))||id!==key(value.recordId,value.figure.id))fail();
 const record=await input.record(value.recordId),figure=record.figures.find(figure=>figure.id===value.figure.id);if(serialize(figure)!==serialize(value.figure))fail();
 const reader=await openPublicationFigure(input,value.recordId,value.figure.id,{signal});await reader.verify({signal});
}
export async function verifyPublicationFigures(input,record,{signal}={}){
 for(const figure of record.figures??[])if(hasRetainedFigure(figure)){
  const reader=await openPublicationFigure(input,record.id,figure.id,{signal});if(serialize(reader.originalFigure??reader.figure)!==serialize(figure))fail();
 }
}
