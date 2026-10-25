import {coordinateAlignmentPublicPage} from './coordinate-alignment.js';
import {publicCusumContext} from './web/dataset-cusum-model.js';
import {publicCoordinateFrameContext} from './web/coordinate-frame-schema.js';
import {publicSpectrumContext} from './web/dataset-spectrum-model.js';
import {statisticalUncertaintyContextText} from './web/statistical-uncertainty-context.js';
import {measurementUnitContextText} from './web/measurement-unit-context.js';
import {aggregationQuantileContextText,aggregationPairContextText} from './web/dataset-aggregation-context.js';
import {resolveScalarOperand} from './measurement-scalar-storage.js';
import {resolveScalarDefinitions} from './measurement-scalar-storage.js';
import {clockSynchronizationContextText} from './web/measurement-clock-context.js';
import {computationLabel,resolveCellComputation,perCellComputation,effectiveCellColumn} from './web/measurement-computation.js';
import {AppError} from './errors.js';
import {readTableCursor,tableCursors} from './retained-table-cursor.js';
const tableReads=async(materials,operation)=>materials.workspace?.withCatalogueConnections&&await materials.workspace.storageKind?.()==='catalogue'?materials.workspace.withCatalogueConnections(operation):operation();
import {measurementRef} from './web/measurement-model.js';
import {validTableSelection,validRetainedTable} from './web/retained-table-model.js';
export const hasPagedResultTables=results=>results?.statements?.some(statement=>statement?.table?.version===3||statement?.tableSelection!==undefined&&!validTableSelection(statement.tableSelection))??false;
export async function pagedTableDocument(document){
 if(!await document.reference(['results','statements']))return false;
 for await(const item of document.items(['results','statements'])){
  if((await document.tree.selected(item.value,['table','version'])).value===3)return true;
  const selection=await document.tree.selected(item.value,['tableSelection']);if(selection.found&&!validTableSelection(selection.value))return true;
 }
 return false;
}
export const retainedTable=(materials,command)=>tableReads(materials,()=>readRetainedTable(materials,command));
async function readRetainedTable(materials,{ref,selection,version=2}){
 if(version===3){await retainedTableSource(materials,ref,selection);return {version:3,selection:structuredClone(selection)};}
 if(!measurementRef(ref)||ref.kind!=='dataset'||!validTableSelection(selection)||![1,2].includes(version))throw new AppError('DATASET_TABLE');
 const doc=await materials.read(ref),columns=await materials.datasetColumns(doc);if(selection.columns.some(index=>perCellComputation(columns[index])||columns[index]?.spectrum||columns[index]?.cusum||columns[index]?.coordinateAlignment))throw new AppError('DATASET_TABLE');
 if(selection.columns.some(i=>i>=columns.length))throw new AppError('DATASET_TABLE');
 for(const index of selection.columns)if(columns[index].synchronization)columns[index]={...columns[index],...(await resolveScalarDefinitions(materials,{synchronization:columns[index].synchronization}))};
 for(const index of selection.columns)if(columns[index].quantity?.unitDefinition)columns[index]={...columns[index],...(await resolveScalarDefinitions(materials,{quantity:columns[index].quantity}))};
 const quantileContexts=new Map();for(const index of selection.columns)quantileContexts.set(index,await legacyQuantileContext(materials,doc,index));
 const table={version,selection,headers:selection.columns.map(i=>columns[i].name+(columns[i].unit?' ['+columns[i].unit+']':'')+(computationLabel(columns[i])?' ['+computationLabel(columns[i])+']':'')+(columns[i].synchronization?' ['+clockSynchronizationContextText(columns[i].synchronization)+']':'')+(columns[i].statisticalUncertainty?' ['+statisticalUncertaintyContextText(columns[i].statisticalUncertainty)+']':'')+(quantileContexts.get(i)?' ['+quantileContexts.get(i)+']':'')+(pairedMetric(doc,i)?' ['+aggregationPairContextText(pairedMetric(doc,i))+']':'')+(columns[i].quantity?.unitDefinition?' ['+measurementUnitContextText(columns[i].quantity.unitDefinition)+']':'')),rows:[],...(version===2?{formats:selection.columns.map(i=>({representation:columns[i].representation,radix:columns[i].radix,...(columns[i].domain?{domain:columns[i].domain}:{})}))}:{})};let count=0;
 for await(const row of materials.iterateDataset(ref)){
  if(row.excluded&&!selection.includeExcluded)continue;if(count++<selection.offset)continue;
  table.rows.push({cells:selection.columns.map(i=>row.cells[i]),presence:selection.columns.map(i=>['null','absent'].includes(row.valueKinds?.[i])?row.valueKinds[i]:columns[i].missing.some(m=>m.value===row.cells[i])?'missing':'value'),exclusion:row.excluded??null});
  if(!validRetainedTable(table))throw new AppError('DATASET_TABLE');if(table.rows.length===selection.count)break;
 }
 if(!table.rows.length)throw new AppError('DATASET_TABLE');return table;
}


// A result pins its dataset through statement.source. Version 3 keeps only the
// selected query; previews and export traverse that immutable revision directly.
export async function retainedTableSource(materials,ref,selection){
 if(!measurementRef(ref)||ref.kind!=='dataset'||!validTableSelection(selection,{paged:true}))throw new AppError('DATASET_TABLE');
 const doc=await materials.read(ref),first=await materials.retainedSchemaPage(doc,{offset:0,limit:1}),columnCount=first.total;
 if(!columnCount||selection.columns!=='all'&&selection.columns.some(i=>i>=columnCount)||selection.offset>=doc.content.rowCount)throw new AppError('DATASET_TABLE');
 return {doc,columnCount,selectedColumns:selection.columns==='all'?columnCount:selection.columns.length};
}
function quantileMetric(doc,index){
 const recipe=doc.content.aggregation,metric=recipe?.version>=4?recipe.values[index-recipe.keys.length]:null;
 return metric?.operation==='quantile'?{method:metric.method,probability:metric.probability}:null;
}
function pairedMetric(doc,index){
 const recipe=doc.content.aggregation,metric=[5,6].includes(recipe?.version)?recipe.values[index-recipe.keys.length]:null;
 if(!metric||!['covariance','linear-fit','correlation'].includes(metric.operation))return null;
 const {operation,method,pairing}=metric;
 return {operation,method,pairing,...(operation==='correlation'?{calculationPolicy:metric.calculationPolicy}:operation==='covariance'?{normalization:metric.normalization}:{coefficient:metric.coefficient})};
}
async function legacyQuantileContext(materials,doc,index){
 const quantile=quantileMetric(doc,index);if(!quantile)return '';
 const probability=quantile.probability,policy=doc.content.aggregation.resourcePolicy,cell=await resolveScalarOperand(materials,{kind:'string',value:probability.spelling},{representation:probability.representation,radix:probability.radix,missing:[],resourcePolicy:policy},{policy});
 return aggregationQuantileContextText({...quantile,probability:{...probability,spelling:cell.value}});
}
const natural=n=>Number.isSafeInteger(n)&&n>=0;
async function tableColumns(materials,source,selection,offset,limit){
 if(!natural(offset)||offset>=source.selectedColumns||!Number.isInteger(limit)||limit<1||limit>16)throw new AppError('DATASET_TABLE');
 const indices=selection.columns==='all'?Array.from({length:Math.min(limit,source.selectedColumns-offset)},(_,i)=>offset+i):selection.columns.slice(offset,offset+limit),columns=[];
 for(const index of indices)columns.push((await materials.retainedSchemaPage(source.doc,{offset:index,limit:1})).items[0]);
 return {indices,columns,quantiles:indices.map(index=>quantileMetric(source.doc,index)),pairedStatistics:indices.map(index=>pairedMetric(source.doc,index))};
}
// Current datasets seek indexed ranks. Legacy filtered sources scan only the
// first offset, then authenticated physical anchors continue without replay.
async function* tableRows(materials,source,selection,indices,{offset=0,limit=Infinity,anchor=null,signal}={}){
 const reverse=anchor?.direction==='backward',pages=materials.datasetPageCount(source.doc);
 const start=anchor??await materials.datasetRowPosition?.(source.doc,{offset:selection.offset+offset,includeExcluded:selection.includeExcluded})??{page:0,row:0,ordinal:0,offset:0};
 let matching=anchor?anchor.offset:start.offset-selection.offset,ordinal=start.ordinal,emitted=0;
 for(let page=start.page;page>=0&&page<pages;page+=reverse?-1:1){
  signal?.throwIfAborted();const data=await materials.retainedDatasetPage(source.doc,page,{columns:indices});
  let position=page===start.page?start.row+(reverse?-1:0):reverse?data.rows.length-1:0;
  if(anchor&&page===start.page&&(start.row>=data.rows.length||data.rows[start.row].excluded&&!selection.includeExcluded))throw new AppError('DATASET_TABLE');
  if(reverse&&page===start.page)ordinal--;
  for(;position>=0&&position<data.rows.length;position+=reverse?-1:1,ordinal+=reverse?-1:1){
   const row=data.rows[position];if(row.excluded&&!selection.includeExcluded)continue;
   const at=reverse?--matching:matching++;
   if(reverse?at<0:selection.count!==null&&at>=selection.count)return;
   if(!reverse&&at<offset)continue;
   const compact=Array.isArray(row.columnIndices)||Array.isArray(data.columnIndices),get=(values,i)=>values?.[compact?i:indices[i]];
   yield {offset:at,ordinal,page,row:position,cells:indices.map((_,i)=>get(row.cells,i)),valueKinds:indices.map((_,i)=>get(row.valueKinds,i)),pointers:indices.map((_,i)=>get(row.cellPointers,i)??null),sources:indices.map((_,i)=>get(row.cellSources,i)??null),computations:indices.map((_,i)=>get(row.cellComputations,i)),alignments:indices.map((_,i)=>get(row.cellCoordinateAlignments,i)),exclusion:row.excluded??null};
   if(++emitted>=limit)return;
  }
 }
}
function presence(row,columns){return row.cells.map((cell,i)=>['null','absent'].includes(row.valueKinds[i])?row.valueKinds[i]:typeof cell==='string'&&columns[i].missing.some(m=>m.value===cell)?'missing':'value');}
function tableBlock(columns,rows,selection,quantiles=[],pairedStatistics=[]){return {version:2,selection:{includeExcluded:selection.includeExcluded},headers:columns.map(c=>c.name+(c.unit?' ['+c.unit+']':'')),formats:columns.map((c,index)=>({...(quantiles[index]?{quantile:quantiles[index]}:{}),...(pairedStatistics[index]?{pairedStatistic:pairedStatistics[index]}:{}),representation:c.representation,radix:c.radix,...(c.domain?{domain:c.domain}:{}),...(c.quantity?.uncertainty?{uncertainty:c.quantity.uncertainty}:{}),...(c.quantity?.unitDefinition?{unitDefinition:c.quantity.unitDefinition}:{}),...(c.computation?{computation:c.computation}:{}),...(c.synchronization?{synchronization:c.synchronization}:{}),...(c.statisticalUncertainty?{statisticalUncertainty:c.statisticalUncertainty}:{}),...(c.coordinateAlignment?{coordinateAlignment:c.coordinateAlignment}:{}),...(c.cusum?{cusum:publicCusumContext(c.cusum)}:{}),...(c.spectrum?{spectrum:publicSpectrumContext(c.spectrum)}:{}),...(c.coordinateFrame?{coordinateFrame:publicCoordinateFrameContext(c),coordinateFrameAxes:c.coordinateFrame.axesIndex}:{})})),rows:rows.map(row=>({...row,presence:presence(row,columns),computations:columns.map((column,index)=>resolveCellComputation(column,{...(row.computations?.[index]!==undefined?{computation:row.computations[index]}:{})}))}))};}
export const retainedTablePage=(materials,command,options)=>tableReads(materials,()=>readTablePage(materials,command,options));
async function readTablePage(materials,{ref,table,offset,cursor,limit=16,columnOffset=0,columnLimit=8},{signal}={}){
 if(!validRetainedTable(table)||table.version!==3||offset!==undefined&&!natural(offset)||!Number.isInteger(limit)||limit<1||limit>32)throw new AppError('DATASET_TABLE');
 const source=await retainedTableSource(materials,ref,table.selection),anchor=cursor===undefined?null:await readTableCursor(materials,ref,table,cursor,source,offset);
 offset=anchor?.offset??offset??0;
 const {indices,columns,quantiles,pairedStatistics}=await tableColumns(materials,source,table.selection,columnOffset,columnLimit),rows=[],reverse=anchor?.direction==='backward';
 for await(const row of tableRows(materials,source,table.selection,indices,{offset,anchor,limit:limit+1,signal}))rows.push(row);
 const extra=rows.length>limit?rows.pop():null;if(reverse)rows.reverse();
 const nextRow=reverse?anchor:extra,next=nextRow?.offset??null;offset=rows[0]?.offset??offset;
 const tokens=await tableCursors(materials,ref,table,[...rows.map(row=>({...row,direction:'forward'})),nextRow?{...nextRow,direction:'forward'}:null,offset&&rows.length?{...rows[0],direction:'backward'}:null]);
 const nextCursor=tokens[rows.length],previousCursor=tokens[rows.length+1],block=tableBlock(columns,rows,table.selection,quantiles,pairedStatistics);
 for(let r=0;r<block.rows.length;r++){const row=block.rows[r];row.cursor=tokens[r];row.alignmentDetails=[];for(let i=0;i<block.formats.length;i++)row.alignmentDetails.push(block.formats[i].coordinateAlignment?await coordinateAlignmentPublicPage(materials,row.alignments[i],{column:block.formats[i].coordinateAlignment,signal}):null);row.cellWindows=[];for(let i=0;i<row.cells.length;i++){const cell=await retainedCellWindow(materials,row.cells[i],{offset:0,limit:1024,signal});row.cells[i]=cell.value;row.cellWindows.push({next:cell.next,total:cell.total});}}
 return {table:block,columns,columnIndices:indices,offset,next,cursor:tokens[0]??null,nextCursor,previousCursor,columnOffset,columnCount:source.selectedColumns,columnNext:columnOffset+indices.length<source.selectedColumns?columnOffset+indices.length:null};
}
// Every block is independently bounded. Callers must consume the iterator to
// completion when retaining or exporting a selected table.
export async function* retainedTableBlocks(materials,{ref,table},{signal}={}){
 if(!validRetainedTable(table)||table.version!==3)throw new AppError('DATASET_TABLE');
 const source=await retainedTableSource(materials,ref,table.selection);
 for(let columnOffset=0;columnOffset<source.selectedColumns;columnOffset+=8){
  const {indices,columns,quantiles,pairedStatistics}=await tableColumns(materials,source,table.selection,columnOffset,8);let rows=[],offset=0;
  for await(const row of tableRows(materials,source,table.selection,indices,{signal})){
   rows.push(row);if(rows.length===16){yield {offset,columnOffset,columnIndices:indices,table:tableBlock(columns,rows,table.selection,quantiles,pairedStatistics)};offset+=rows.length;rows=[];}
  }
  if(rows.length)yield {offset,columnOffset,columnIndices:indices,table:tableBlock(columns,rows,table.selection,quantiles,pairedStatistics)};
 }
}

async function retainedCellWindow(materials,value,{offset=0,limit=4096,signal}={}){
 signal?.throwIfAborted();
 if(!natural(offset)||!Number.isSafeInteger(limit)||limit<1||limit>4096)throw new AppError('DATASET_TABLE');
 if(typeof value==='string'){if(offset>value.length)throw new AppError('DATASET_TABLE');return {value:value.slice(offset,offset+limit),offset,total:value.length,next:offset+limit<value.length?offset+limit:null};}
 const page=await materials.readDatasetCell(value,{offset,limit,signal});return {...page,value:page.value??page.text};
}
export const retainedTableCell=(materials,command,options)=>tableReads(materials,()=>readTableCell(materials,command,options));
async function readTableCell(materials,{ref,table,rowOffset,cursor,columnOffset,offset=0,limit=4096},{signal}={}){
 if(!validRetainedTable(table)||table.version!==3||rowOffset!==undefined&&!natural(rowOffset)||rowOffset===undefined&&cursor===undefined)throw new AppError('DATASET_TABLE');
 const source=await retainedTableSource(materials,ref,table.selection),anchor=cursor===undefined?null:await readTableCursor(materials,ref,table,cursor,source,rowOffset);
 if(anchor&&anchor.direction!=='forward')throw new AppError('DATASET_TABLE');
 const {indices,columns}=await tableColumns(materials,source,table.selection,columnOffset,1);
 for await(const row of tableRows(materials,source,table.selection,indices,{offset:anchor?.offset??rowOffset,anchor,limit:1,signal}))return {...await retainedCellWindow(materials,row.cells[0],{offset,limit,signal}),cursor:(await tableCursors(materials,ref,table,[{...row,direction:'forward'}]))[0],column:effectiveCellColumn(columns[0],{...(row.computations?.[0]!==undefined?{computation:row.computations[0]}:{})}),presence:presence(row,columns)[0],source:{ref,selector:{kind:'cell',page:row.page,row:row.row,column:indices[0]}},pointer:row.pointers[0],sources:row.sources[0],exclusion:row.exclusion};
 throw new AppError('DATASET_TABLE');
}
