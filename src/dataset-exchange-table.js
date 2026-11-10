import {AppError} from './errors.js';
import {exact} from './modules/validation.js';
import {validateDatasetCell} from './dataset-cell-storage.js';
import {csvCell,csvCellChunks} from './web/csv-cell.js';
import {datasetTextStream} from './dataset-text-stream.js';

const natural=value=>Number.isSafeInteger(value)&&value>=0;
const invalid=()=>{throw new AppError('INVALID');};

// Offsets and ranges refer to the original acquisition order and retained
// schema. Withholding excluded rows never shifts the user's range selection.
export function datasetExchangeSelection(doc,selection){
 const width=doc.content.schemaIndex?.count??doc.content.columns?.length;
 if(doc.kind!=='dataset'||!natural(width)||!width||!natural(doc.content.rowCount))throw new AppError('MATERIAL_MISSING');
 if(!exact(selection,['offset','count','columns','includeExcluded'])||!natural(selection.offset)||selection.offset>doc.content.rowCount||selection.count!==null&&!natural(selection.count)||typeof selection.includeExcluded!=='boolean')invalid();
 if(selection.count!==null&&selection.count>doc.content.rowCount-selection.offset)invalid();
 const ranges=selection.columns??[{offset:0,count:width}];
 if(!Array.isArray(ranges)||!ranges.length)invalid();
 let end=0;
 for(const range of ranges){
  if(!exact(range,['offset','count'])||!natural(range.offset)||!natural(range.count)||!range.count||range.offset<end||range.count>width-range.offset)invalid();
  end=range.offset+range.count;
 }
 return {offset:selection.offset,count:selection.count??doc.content.rowCount-selection.offset,columns:ranges,includeExcluded:selection.includeExcluded};
}

export async function* exchangeColumns(materials,doc,selection,{signal,check}={}){
 for(const range of selection.columns){
  const end=range.offset+range.count;
  for(let offset=range.offset;offset<end;){
   signal?.throwIfAborted();
   await check?.();
   const read=()=>materials.retainedSchemaPage(doc,{offset,limit:Math.min(64,end-offset)});
   const {items}=await (materials.workspace?.catalogue?materials.workspace.catalogue(read):read());
   if(!items.length)throw new AppError('MATERIAL_MISSING');
   for(const column of items)yield {index:offset++,column};
  }
 }
}

export async function* exchangeRows(materials,doc,selection,{signal,check,progress}={}){
 if(!selection.count)return;
 const pages=materials.datasetPageCount(doc),end=selection.offset+selection.count;
 const start=await materials.datasetRowPosition(doc,{offset:selection.offset,includeExcluded:true});
 let position=start?.ordinal??0,written=0;
 for(let page=start?.page??0;page<pages&&position<end;page++){
  signal?.throwIfAborted();
  await check?.();
  const read=()=>materials.retainedDatasetPage(doc,page,{metadataOnly:true});
  const {rows}=await (materials.workspace?.catalogue?materials.workspace.catalogue(read):read());
  for(let i=page===start?.page?start.row:0;i<rows.length&&position<end;i++,position++){
   if(position>=selection.offset&&(selection.includeExcluded||!rows[i].excluded)){
    yield {index:position,row:rows[i]};written++;
   }
  }
  await progress?.({position,rows:written});
 }
 if(position!==end)throw new AppError('MATERIAL_MISSING');
}

export async function* exchangeCells(materials,doc,row,selection,{signal,readWindow}={}){
 if(doc.content.datasetFormat!==3){
  let i=0,r=0;
  const last=selection.columns.at(-1);
  const end=last.offset+last.count;
  for await(const cell of materials.iterateDatasetCells(doc,row)){
   signal?.throwIfAborted();
   while(r<selection.columns.length&&i>=selection.columns[r].offset+selection.columns[r].count)r++;
   if(r===selection.columns.length)return;
   if(i>=selection.columns[r].offset)yield {index:i,cell};
   i++;
   if(i===end)return;
  }
  throw new AppError('MATERIAL_MISSING');
 }
 materials.sequences.validate(row.cellIndex);
 if(row.cellIndex.kind!=='cells'||row.cellIndex.count!==doc.content.schemaIndex.count)throw new AppError('MATERIAL_MISSING');
 for(const range of selection.columns){
  const end=range.offset+range.count;
  for(let offset=range.offset;offset<end;){
   signal?.throwIfAborted();
   const limit=Math.min(64,end-offset);
   const items=readWindow?await readWindow(row.cellIndex,offset,limit):(await materials.sequences.page(row.cellIndex,{offset,limit})).items;
   if(!items.length)throw new AppError('MATERIAL_MISSING');
   for(const cell of items)yield {index:offset++,cell:validateDatasetCell(materials,cell)};
  }
 }
}

// The delimited file is a spreadsheet-safe rendition of the source spelling.
// The accompanying typed exchange preserves distinctions such as null/absent.
export async function* delimitedDataset(materials,doc,selection,{format,signal,check,progress}={}){
 if(!['csv','tsv'].includes(format))invalid();
 const separator=format==='csv'?',':'\t';
 let first=true;
 for await(const {column} of exchangeColumns(materials,doc,selection,{signal,check})){
  if(!first)yield separator;
  first=false;yield csvCell(column.name);
 }
 yield '\r\n';
 for await(const {row} of exchangeRows(materials,doc,selection,{signal,check,progress})){
  first=true;
  for await(const {cell} of exchangeCells(materials,doc,row,selection,{signal})){
   if(!first)yield separator;
   first=false;
   yield* csvCellChunks(datasetTextStream(materials,cell.value,{signal}));
  }
  yield '\r\n';
 }
}
