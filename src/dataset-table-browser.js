import {AppError} from './errors.js';
import {exact} from './modules/validation.js';
import {digest,serialize} from './storage-format.js';
import {validMaterialReference} from './web/material-reference.js';
import {isScalarRepresentation} from './web/measurement-model.js';
import {validTableQuery,filterOperand,tableNumber,matchesTableCell,matchesTableOrder,sortTableRows} from './web/dataset-table-query.js';
import {compareKey} from './web/query-order.js';
import {datasetSequenceWindows} from './dataset-sequence-windows.js';
import {validateDatasetCell,datasetCellReference,readDatasetCell,DATASET_TEXT_CHARS} from './dataset-cell-storage.js';
import {datasetTextStream} from './dataset-text-stream.js';
import {domainValueReference} from './measurement-domain-storage.js';
import {projectDatasetRows} from './dataset-storage.js';
import {queryResultWindow} from './query-result-window.js';

const invalid=()=>{throw new AppError('INVALID');};
const damaged=()=>{throw new AppError('MATERIAL_MISSING');};
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const point=({ordinal,key})=>({ordinal,key});
const emptyQuery=query=>!query.id&&!query.filters.length&&!query.sort&&query.inclusion==='all';

async function windowCell(materials,doc,row,column,read){
 if(doc.content.datasetFormat===3){
  const vector=row.cellIndex;materials.sequences.validate(vector);
  if(vector.kind!=='cells'||vector.count!==doc.content.schemaIndex.count)damaged();
  const start=column-column%16,items=await read(vector,start,16);
  return validateDatasetCell(materials,items[column-start]);
 }
 return {value:row.cells[column],kind:row.valueKinds?.[column]??'string'};
}
const singular=(kind,value='',empty=false)=>({kind,value,empty});
function predicateKey(cell,column,raw,mode){
 if(['absent','null'].includes(cell.kind))return singular(cell.kind);
 const empty=cell.kind==='string'&&raw==='';
 if(column.missing.some(m=>m.value===raw))return singular('missing',raw,empty);
 if(mode==='spelling'||!isScalarRepresentation(column))return singular('text',raw,empty);
 try{return singular('number',tableNumber(raw,column));}
 catch(error){if(error.code==='DATASET_CALCULATION_RESOURCE')throw error;return singular('unparsed',raw,empty);}
}
async function spelledKey(materials,cell,column,{signal,mode='typed'}={}){
 const value=domainValueReference(cell.value)?cell.value.original:cell.value;
 if(typeof value==='string')return predicateKey(cell,column,value,mode);
 if(!datasetCellReference(value))damaged();
 const numeric=mode==='typed'&&isScalarRepresentation(column);
 if(numeric&&value.characters>(column.resourcePolicy?.resources.maxScalarCharacters??8192))throw new AppError('DATASET_CALCULATION_RESOURCE');
 const complete=numeric||column.missing.some(m=>m.value.length===value.characters);
 let raw='';
 for await(const part of datasetTextStream(materials,value,{signal})){
  if(complete)raw+=part;
  else if(raw.length<256)raw+=part.slice(0,256-raw.length);
 }
 if(!complete)return {...singular('text',raw),source:value};
 return predicateKey(cell,column,raw,mode);
}
async function compareText(materials,left,right,signal){
 const a=left.source??left.value,b=right.source??right.value;
 const aSize=left.source?.characters??a.length,bSize=right.source?.characters??b.length;
 const known=Math.min(left.value.length,right.value.length),first=compareKey(left.value.slice(0,known),right.value.slice(0,known));
 if(first)return first;
 if(left.source&&right.source&&aSize===bSize&&a.sha256===b.sha256)return 0;
 const shared=Math.min(aSize,bSize);
 for(let offset=known;offset<shared;offset+=DATASET_TEXT_CHARS){
  const options={offset,limit:Math.min(DATASET_TEXT_CHARS,shared-offset),signal};
  const aPart=await readDatasetCell(materials,a,options),bPart=await readDatasetCell(materials,b,options);
  const order=compareKey(aPart.text,bPart.text);if(order)return order;
 }
 return compareKey(aSize,bSize);
}
async function accepts(materials,cell,column,filter,operand,signal){
 const value=domainValueReference(cell.value)?cell.value.original:cell.value;
 if(!datasetCellReference(value))return matchesTableCell(filter.test,predicateKey(cell,column,value,filter.test==='contains'?'spelling':'typed'),operand);
 // Null/absent, a declared missing token, an empty string and a retained
 // large text field have distinct meanings independent of display truncation.
 if(['null','absent','empty'].includes(filter.test))return false;
 if(column.missing.some(m=>m.value.length===value.characters)){
  const mode=filter.test==='contains'?'spelling':'typed';
  const key=await spelledKey(materials,cell,column,{signal,mode});
  return matchesTableCell(filter.test,key,operand);
 }
 if(['present','missing'].includes(filter.test))return filter.test==='present';
 if(filter.test==='contains'){
  const needle=filter.value;
  let tail='',found=!needle;
  for await(const part of datasetTextStream(materials,value,{signal})){
   if(!found){const window=tail+part;found=window.includes(needle);tail=needle.length>1?window.slice(1-needle.length):'';}
  }
  return found;
 }
 if(['equal','different'].includes(filter.test)&&!isScalarRepresentation(column)&&value.characters!==filter.value.length)return filter.test==='different';
 const key=await spelledKey(materials,cell,column,{signal});
 if(key.source&&operand?.kind==='text')return matchesTableOrder(filter.test,await compareText(materials,key,operand,signal));
 return matchesTableCell(filter.test,key,operand);
}

async function schemaFor(materials,doc,positions){
 const schema=new Map(),windows=new Map();
 for(const index of positions){
  const at=index-index%16;
  if(!windows.has(at))windows.set(at,(await materials.retainedSchemaPage(doc,{offset:at,limit:16})).items);
  const column=windows.get(at)[index-at];if(!column)invalid();schema.set(index,column);
 }
 return schema;
}

async function locateOriginalObservation(materials,doc,id){
 const {datasetFormat,inputs,sourceMapping,rowCount,algorithm}=doc.content;
 if(datasetFormat!==3||!id||algorithm||inputs?.length!==1||inputs[0].kind!=='artifact'||!['delimited','json','jsonl','json-nested'].includes(sourceMapping?.format))return null;
 const prefix=inputs[0].id+':';
 if(!id.startsWith(prefix)||!/^\d+$/.test(id.slice(prefix.length)))return null;
 const row=Number(id.slice(prefix.length)),offset=row-(sourceMapping.format==='delimited'?2:1);
 if(!Number.isSafeInteger(offset)||offset<0||offset>=rowCount)return null;
 const location=await materials.datasetRowPosition(doc,{offset,includeExcluded:true});
 const source=await materials.retainedDatasetPage(doc,location.page,{metadataOnly:true});
 // Retained acquisition rows use the original line or ordinal. Multiline
 // records can break that correspondence. Only trust an exact identity hit.
 return source.rows[location.row]?.id===id?{...location,source}:null;
}

export async function browseDatasetTable(materials,data,{signal,check=async()=>{}}={}){
 if(!exact(data,['ref','query','offset','limit','columns'])||!validMaterialReference(data.ref)||data.ref.kind!=='dataset'||!validTableQuery(data.query)||!integer(data.offset)||!integer(data.limit)||data.limit<1||data.limit>64||!Array.isArray(data.columns)||!data.columns.length||data.columns.length>32||new Set(data.columns).size!==data.columns.length||data.columns.some(n=>!integer(n)))invalid();
 return materials.workspace.withCatalogueConnections(async()=>{
  signal?.throwIfAborted();await check();
  const {ref,query,columns,offset,limit}=data,doc=await materials.read(ref),{recordId}=doc;
  const grant=async()=>{signal?.throwIfAborted();await check();await materials.assertOwner(recordId);};
  await grant();
  const positions=new Set([...columns,...query.filters.map(f=>f.column),...(query.sort?[query.sort.column]:[])]);
  const width=doc.content.schemaIndex?.count??doc.content.columns.length;
  if([...positions].some(n=>n>=width))invalid();
  const schema=await schemaFor(materials,doc,positions),read=datasetSequenceWindows(materials);
  let operands;
  try{operands=query.filters.map(f=>filterOperand(f,schema.get(f.column)));}catch{invalid();}
  const order=sortTableRows(query.sort?.direction);
  const deferredOrder=query.sort&&!isScalarRepresentation(schema.get(query.sort.column))?async(a,b)=>{
   if(a.key.kind==='text'&&b.key.kind==='text'&&(a.key.source||b.key.source)){
    const difference=await compareText(materials,a.key,b.key,signal);
    return (query.sort.direction==='descending'?-difference:difference)||a.ordinal-b.ordinal;
   }
   return order(a,b);
  }:undefined;
  const direct=emptyQuery(query),identity=await locateOriginalObservation(materials,doc,query.id);
  const pages=materials.datasetPageCount(doc),start=identity??(direct&&offset<doc.content.rowCount?await materials.datasetRowPosition(doc,{offset,includeExcluded:true}):null);
  const output=[],directPages=new Map();
  async function* matching(guard){
   let ordinal=start?start.ordinal-start.row:0;
   for(let page=start?.page??0;page<(identity?identity.page+1:pages);page++){
    guard?.();await grant();const kept=identity?.source??await materials.retainedDatasetPage(doc,page,{metadataOnly:true});
    if(identity||direct&&ordinal+kept.rows.length>offset)directPages.set(page,kept.rows);
    for(const [index,row] of kept.rows.entries()){
     const position=ordinal++;if(direct&&position<offset||identity&&index!==identity.row)continue;
     if(query.id&&query.id!==row.id||query.inclusion==='included'&&row.excluded||query.inclusion==='excluded'&&!row.excluded)continue;
     const cells=new Map();
     const selected=async index=>{
      if(!cells.has(index))cells.set(index,await windowCell(materials,doc,row,index,read));
      return cells.get(index);
     };
     let matches=query.join==='all'||!query.filters.length;
     for(const [i,f] of query.filters.entries()){
      const yes=await accepts(materials,await selected(f.column),schema.get(f.column),f,operands[i],signal);
      if(query.join==='all'&&!yes){matches=false;break;}
      if(query.join==='any'&&yes){matches=true;break;}
     }
     if(matches){
      const key=query.sort?await spelledKey(materials,await selected(query.sort.column),schema.get(query.sort.column),{signal}):null;
      yield {ordinal:position,page,index,id:row.id,key};
     }
    }
   }
  }
  let total;
  if(direct){
   total=doc.content.rowCount;
   if(offset<total)for await(const address of matching()){output.push(address);if(output.length===limit)break;}
  }else if(identity){
   total=0;for await(const address of matching()){if(!offset)output.push(address);total++;}
  }else{
   const queryHash=digest(serialize({format:'dataset-table-query',ref,query}));
   const result=await queryResultWindow({workspace:materials.workspace,ownerId:recordId,snapshotId:ref.revision,queryHash,order,deferredOrder,point,offset,limit,signal},guard=>({rows:matching(guard)}));
   if(!result)throw new AppError('WORKLOAD_BUSY');
   output.push(...result.records);total=result.total;
  }
  const groups=new Map(),rows=Array(output.length);
  for(const [position,address] of output.entries()){
   if(!groups.has(address.page))groups.set(address.page,[]);
   groups.get(address.page).push({...address,position});
  }
  for(const [page,addresses] of groups){
   await grant();
   const source=directPages.get(page)??(await materials.retainedDatasetPage(doc,page,{metadataOnly:true})).rows;
   const chosen=addresses.map(({index,id})=>{if(source[index]?.id!==id)damaged();return source[index];});
   const projected=await projectDatasetRows(materials,doc,chosen,columns);
   for(const [i,{index,ordinal,id,position}] of addresses.entries()){
    const row=projected.rows[i];rows[position]={page,index,ordinal,id,excluded:row.excluded,order:row.order,cells:row.cells,valueKinds:row.valueKinds,cellComputations:row.cellComputations,locator:row.locator,line:row.line};
   }
  }
  await grant();return {rows,columns:columns.map(index=>({index,definition:schema.get(index)})),offset,total,width,sourceRows:doc.content.rowCount,revision:ref.revision};
 });
}
