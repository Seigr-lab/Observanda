import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {digest as sourceDigest} from './storage-format.js';
import {revisionText} from './web/revision-model.js';
import {domainValueReference,verifyDomainValue} from './measurement-domain-storage.js';
import {datasetCellReference,retainedCellSources} from './dataset-cell-storage.js';
import {aggregationMemberContext,aggregationMemberRows} from './dataset-aggregation-members.js';
import {validMaterialReference,materialReference,materialReferenceKey} from './web/material-reference.js';
import {exchangeCells,exchangeColumns,exchangeRows} from './dataset-exchange-table.js';
import {datasetSequenceWindows} from './dataset-sequence-windows.js';
import {datasetTextStream} from './dataset-text-stream.js';
import {exchangeMetadata} from './dataset-exchange-metadata.js';
import {maxExchangeFrameBytes} from './dataset-exchange-lines.js';

const format='observanda-dataset-exchange';
const line=value=>Buffer.from(JSON.stringify(value)+'\n');
const selected=(ranges,position)=>ranges.some(({offset,count})=>position>=offset&&position-offset<count);
function partialInterpretation(interpretation){
 const {algorithm,algorithmVersion,encoding,order,sourceMapping}=interpretation;
 const value={projection:'selected-result-fields',encoding,order,sourceMapping:{format:sourceMapping?.format??'delimited'}};
 if(algorithm)value.algorithm=algorithm;
 if(algorithmVersion!==undefined)value.algorithmVersion=algorithmVersion;
 for(const key of ['calculation','aggregation','cusum','spectrum','calculatorResult','uncertainty']){
  const recipe=interpretation[key];if(!recipe)continue;
  value[key]=Object.fromEntries(Object.entries(recipe).filter(([role,ref])=>role==='version'||['graph','source','analysis','recipe'].includes(role)&&validMaterialReference(ref)));
 }
 return value;
}

function projectedObservation(metadata,recipe,ranges){
 const {id,order,line,excluded,calculationLineage,aggregation}=metadata;
 const data={id,order,line,excluded};
 if(calculationLineage){const {version,graph,outputExcluded}=calculationLineage;data.calculationLineage={version,graph,outputExcluded};}
 if(Array.isArray(aggregation)&&Array.isArray(recipe?.keys)){
  data.metricReceipts=aggregation.flatMap((receipt,index)=>{const column=recipe.keys.length+index;return selected(ranges,column)?[{column,receipt}]:[];});
 }
 return data;
}

async function* frames(materials,doc,ref,selection,{signal,checkSource,check,progress}){
 if(!validMaterialReference(ref)||ref.kind!=='dataset'||ref.kind!==doc.kind||ref.id!==doc.id||!ref.workspaceId||typeof checkSource!=='function'||typeof check!=='function')throw new AppError('INVALID');
 signal?.throwIfAborted();await checkSource(ref);
 if(sourceDigest(revisionText(doc))!==ref.revision)throw new AppError('MATERIAL_MISSING');
 yield {type:'dataset',format,version:1,ref:materialReference(ref),title:doc.title,selection,sourceRows:doc.content.rowCount,sourceColumns:doc.content.schemaIndex?.count??doc.content.columns.length};
 const {schemaIndex,pageIndex,columns,pages,inputs,inputsIndex,schemaInputsIndex,outputs,outputsIndex,provenanceInputs,aggregationMembersIndex,...interpretation}=doc.content;
 // Each selected declaration and source address is exported separately.
 // The storage indexes are private implementation details.
 const width=schemaIndex?.count??columns.length,completeSchema=selection.columns.reduce((n,r)=>n+r.count,0)===width;
 yield {type:'interpretation',value:completeSchema?interpretation:partialInterpretation(interpretation)};
 // Schema and cell references travel with their selected declarations and
 // values. A projection must still honor input grants for the computation,
 // including joins, without publishing the addresses of unrelated fields.
 const original=!interpretation.algorithm&&inputs?.length===1&&inputs[0].kind==='artifact'?materialReferenceKey(inputs[0]):null;
 for await(const source of materials.references({inputs,inputsIndex,provenanceInputs})){
  signal?.throwIfAborted();
  if(completeSchema||original&&materialReferenceKey(source)===original)yield {type:'source',ref:materialReference(source)};
  else await checkSource(source);
 }
 for await(const {column,index} of exchangeColumns(materials,doc,selection,{signal,check})){
  yield {type:'column',index,column};
 }
 const readWindow=datasetSequenceWindows(materials);
 let aggregation;
 for await(const {index:rowIndex,row} of exchangeRows(materials,doc,selection,{signal,check,progress})){
  const {cellIndex,cells,valueKinds,cellPointers,cellSources,aggregationMembers,...metadata}=row;
  yield {type:'row',index:rowIndex,metadata:completeSchema?metadata:projectedObservation(metadata,doc.content.aggregation,selection.columns),memberCount:aggregationMembers?.count??0};
  if(doc.content.aggregationMembersIndex){
   if(!aggregation){
    await checkSource(doc.content.aggregation.source);
    aggregation=await aggregationMemberContext(materials,doc);
   }
   let i=0;
   for await(const member of aggregationMemberRows(materials,aggregation,row,{signal})){
    if(i%64===0)await check();
    yield {type:'member',index:i++,page:member.page,row:member.row,id:member.value.id};
   }
   if(i!==aggregationMembers?.count)throw new AppError('MATERIAL_MISSING');
  }else if(aggregationMembers)throw new AppError('MATERIAL_MISSING');
  for await(const {index,cell} of exchangeCells(materials,doc,row,selection,{signal,readWindow})){
   const {value,exchangeBytes,...properties}=cell;
   if(exchangeBytes)properties.sources=retainedCellSources(doc,row,cell);
   let original=value,domain=null;
   if(domainValueReference(value)){
    await verifyDomainValue(materials,value,{signal,check});
    original=value.original;
    // Original spelling plus the exact codec declaration reconstructs tensor,
    // interval, sequence and topology values. The reader compares that
    // reconstructed semantic identity before admitting the imported value.
    domain={version:value.version,definition:value.definition,complete:value.complete,identity:value.identity,...(value.count===undefined?{}:{count:value.count})};
   }
   if(typeof original==='string'){
    yield {type:'cell',index,properties,domain,text:original};
   }else{
    if(!datasetCellReference(original))throw new AppError('MATERIAL_MISSING');
    yield {type:'cell',index,properties,domain,parts:{characters:original.characters,sha256:original.sha256}};
    for await(const text of datasetTextStream(materials,original,{signal}))yield {type:'text',text};
   }
  }
 }
 await check();
}

// A reader verifies the final checksum over all preceding bytes, including
// newlines. A truncated stream cannot be accepted as a completed exchange.
export async function* datasetExchangeJSONL(materials,doc,ref,selection,options){
 const digest=createHash('sha256');
 // The sink can flush a bounded chunk even when the selected snapshot has
 // millions of observations. Long source cells are already split upstream.
 const chunkBytes=64*1024;
 let pending=[],size=0,count=0,rows=0,columns=0,cells=0;
 const metadataOptions={...options,namespace:ref.workspaceId};
 for await(const raw of frames(materials,doc,ref,selection,options)){
  for await(const frame of exchangeMetadata(materials,raw,metadataOptions)){
   options.signal?.throwIfAborted();
   const bytes=line(frame);
   if(bytes.length-1>maxExchangeFrameBytes)throw new AppError('MATERIAL_DATASET_LIMIT');
   digest.update(bytes);count++;
   if(frame.type==='row')rows++;
   if(frame.type==='column')columns++;
   if(frame.type==='cell')cells++;
   if(size&&size+bytes.length>chunkBytes){yield Buffer.concat(pending,size);pending=[];size=0;}
   if(bytes.length>=chunkBytes)yield bytes;
   else{pending.push(bytes);size+=bytes.length;}
  }
 }
 options.signal?.throwIfAborted();
 if(size)yield Buffer.concat(pending,size);
 yield line({type:'complete',frames:count,rows,columns,cells,sha256:digest.digest('hex')});
}
