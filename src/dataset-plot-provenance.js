// Plot receipts retain display errors and exact source positions separately
// from the figure. Source rows and reduction memberships remain paged.
import {AppError} from './errors.js';
import {withScratch} from './scratch-work.js';
import {revisionText} from './web/revision-model.js';
import {exactRational} from './web/measurement-model.js';
import {projectTransformedValue,validMeasurementProjection} from './web/measurement-transform.js';
import {INTERVAL_FIELDS} from './web/figure-intervals.js';
import {sameUnitDefinition,sameUnitDimensions,validUnitDefinition,unitScalar} from './web/measurement-unit-model.js';
import {datasetPlotSelection} from './dataset-plot-selection.js';
import {assertDatasetScalars} from './dataset-selected-columns.js';
const fail=(code='MATERIAL_MISSING')=>{throw new AppError(code);};
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const same=(a,b)=>revisionText(a)===revisionText(b);
const absolute=(selection,index)=>index===null?null:selection.indices?.[index]??index;
const rational=value=>{const r=exactRational(value,'rational');if(value!==r.numerator+'/'+r.denominator)fail();return r;};
const refColumns=(mapping,column)=>{
 const value=mapping.values.find(v=>v.column===column),fields={x:mapping.x};
 if(column!==null)fields.y=column;
 if(mapping.group!==null)fields.group=mapping.group;
 if(value)for(const field of ['error',...INTERVAL_FIELDS,'count'])if(value[field]!=null)fields[field]=value[field];
 return fields;
};
function compatibleUnits(coordinate,value,{delta=false}={}){
 if(!coordinate||!value)return false;const a=coordinate.quantity?.unitDefinition,b=value.quantity?.unitDefinition;
 if(!a&&!b)return coordinate.unit===value.unit;if(!a||!b)return false;
 if(!delta)return sameUnitDefinition(a,b);
 if(!validUnitDefinition(a)||!validUnitDefinition(b)||b.kind!=='difference'||!sameUnitDimensions(a,b))return false;
 const left=unitScalar(a.scale),right=unitScalar(b.scale);return left.numerator===right.numerator&&left.denominator===right.denominator;
}
export function assertPlotProjectionUnits(mapping,columns){
 if(mapping.projection===undefined)return;
 if(!validMeasurementProjection(mapping.projection)||mapping.projection.x&&mapping.xKind!=='number')fail('MATERIAL_INVALID');
 if(new Set(mapping.values.map(value=>value.column)).size!==mapping.values.length)fail('MATERIAL_INVALID');
 if(mapping.projection.y&&(mapping.operation??'raw')!=='count'){
  const definitions=mapping.values.map(value=>columns[value.column]);if(definitions.some(value=>!compatibleUnits(definitions[0],value)))fail('MATERIAL_INVALID');
 }
 for(const value of mapping.values)for(const field of ['error',...INTERVAL_FIELDS])if(value[field]!=null&&!compatibleUnits(columns[field[0]==='x'?mapping.x:value.column],columns[value[field]],{delta:field==='error'}))fail('MATERIAL_INVALID');
}
export function withPlotProvenance(materials,selection,operation,run,{write,signal}={}){
 return withScratch(async work=>{
  const pending=[],counts=new Map();
  const callbacks={point(index,details){pending.push(['point:'+index,{...details,valueColumn:absolute(selection,details.valueColumn)}]);},member(bucket,source){const count=counts.get(bucket)??0;counts.set(bucket,count+1);pending.push(['member:'+bucket+':'+count,source]);}};
  const flush=async()=>{while(pending.length){signal?.throwIfAborted();let bytes=0,count=0;for(const [,value]of pending){const size=Buffer.byteLength(revisionText(value));if(count&&(count===32||bytes+size>262144))break;bytes+=size;count++;}await work.putMany(pending.splice(0,count));}};
  const finish=async order=>{
   await flush();const points=materials.sequences.builder('plot-points',write),members=operation==='raw'?null:materials.sequences.builder('plot-members',write);
   for(const [series,indices]of order.entries())for(const [point,index]of indices.entries()){
    signal?.throwIfAborted();const details=await work.get('point:'+index);if(!details)fail();
    const receipt={version:1,series,point,column:details.valueColumn,group:details.group,coordinates:details.coordinates};
    if(operation==='raw')receipt.source=details.source;
    else{
     const count=counts.get(details.bucket);if(!natural(count)||!count)fail();receipt.members={offset:members.count,count};
     for(let at=0;at<count;at+=32){signal?.throwIfAborted();const keys=Array.from({length:Math.min(32,count-at)},(_,i)=>'member:'+details.bucket+':'+(at+i)),batch=await work.getMany(keys);for(const key of keys){const source=batch.get(key);if(!source)fail();await members.append(source);}}
    }
    // Each receipt occupies one sequence chunk, keeping long exact rationals
    // independent of the number of other plotted points.
    if(Buffer.byteLength(revisionText(receipt))>900000)fail('MATERIAL_ANALYSIS_LIMIT');
    await points.append(receipt);
   }
   return {plotPointsIndex:await points.finish(),...(members?{plotMembersIndex:await members.finish()}:{})};
  };
  return run({callbacks,flush,finish});
 },{signal});
}
function selectedPoint(content,receipt){return receipt&&content.figure?.series?.[receipt.series]?.points?.[receipt.point];}
function checkReceipt(content,receipt){
 const mapping=content.mapping,point=selectedPoint(content,receipt),operation=mapping.operation??'raw';
 if(!receipt||receipt.version!==1||!natural(receipt.series)||!natural(receipt.point)||!point||!receipt.coordinates||typeof receipt.coordinates!=='object'||Array.isArray(receipt.coordinates)||!(receipt.group===null||typeof receipt.group==='string')||operation==='count'&&receipt.column!==null||operation!=='count'&&!mapping.values.some(value=>value.column===receipt.column))fail();
 if(Object.keys(receipt).sort().join()!==['version','series','point','column','group','coordinates',operation==='raw'?'source':'members'].sort().join())fail();
 if(operation==='raw'){if(!receipt.source||Object.keys(receipt.source).sort().join()!=='page,row'||!natural(receipt.source.page)||!natural(receipt.source.row))fail();}
 else if(!receipt.members||Object.keys(receipt.members).sort().join()!=='count,offset'||!natural(receipt.members.offset)||!natural(receipt.members.count)||!receipt.members.count)fail();
 if(operation==='count'&&receipt.coordinates.y?.exact!==receipt.members.count+'/1')fail();
 const fields=['x','y','error',...INTERVAL_FIELDS].filter(field=>point[field]!==null&&point[field]!==undefined&&(field!=='x'&&field[0]!=='x'||mapping.xKind==='number'));
 if(Object.keys(receipt.coordinates).sort().join()!==fields.sort().join())fail();
 for(const field of fields){
  const value=receipt.coordinates[field];if(!value||Object.keys(value).sort().join()!=='error,exact')fail();
  const result=projectTransformedValue(rational(value.exact),mapping.projection[field[0]==='x'?'x':'y'],{policy:mapping.numericPolicy??'safe',delta:field==='error'});
  if(result.coordinate!==point[field]||!same(result.error,value.error))fail();
 }
 return point;
}
async function context(materials,doc){
 const content=doc.content;
 if(content.tool!=='Observanda table mapping'||content.version!=='8'||!validMeasurementProjection(content.mapping?.projection)||!same(content.mapping.projection,content.figure?.projection)||content.parameters!==JSON.stringify(content.mapping)||!same(content.inputs,[content.denominator?.dataset])||!same(content.numericTransform?.projection,content.mapping.projection)||content.numericTransform?.algorithm!=='exact-affine-rational-to-binary64'||content.numericTransform?.version!==1||content.numericTransform?.errorUnits!=='source'||content.numericTransform?.policy!==(content.mapping.numericPolicy??'safe'))fail();
 const source=await materials.read(content.inputs[0]),selection=await datasetPlotSelection(materials,source,content.mapping);assertPlotProjectionUnits(selection.mapping,selection.columns);
 const points=materials.sequences.validate(content.plotPointsIndex),count=content.figure.series.reduce((n,s)=>n+s.points.length,0);
 if(points.kind!=='plot-points'||points.count!==count||count>10000)fail();
 const members=content.plotMembersIndex;if((content.mapping.operation??'raw')==='raw'){if(members!==undefined)fail();}else{materials.sequences.validate(members);if(members.kind!=='plot-members'||members.count>source.content.rowCount*Math.max(1,content.mapping.values.length))fail();}
 return {content,source,selection,points,members,cachedPage:null,cachedData:null};
}
async function rowAt(materials,ctx,position){
 if(!position||Object.keys(position).sort().join()!=='page,row'||!natural(position.page)||!natural(position.row)||position.page>=materials.datasetPageCount(ctx.source))fail();
 if(ctx.cachedPage!==position.page){ctx.cachedData=await materials.retainedDatasetPage(ctx.source,position.page,ctx.selection.indices?{columns:ctx.selection.indices}:undefined);ctx.cachedPage=position.page;}
 const row=ctx.cachedData.rows[position.row];if(!row||row.excluded)fail();return assertDatasetScalars(row);
}
function checkSource(ctx,receipt,row){
 const mapping=ctx.content.mapping,at=column=>ctx.selection.indices?ctx.selection.indices.indexOf(column):column;
 const raw=column=>row.cells[at(column)],missing=column=>['null','absent'].includes(row.valueKinds?.[at(column)])||ctx.selection.columns[at(column)].missing.some(item=>item.value===raw(column))||raw(column).trim()==='';
 if(mapping.group===null?receipt.group!==null:raw(mapping.group).trim()!==receipt.group)fail();
 if(mapping.xKind==='number'){
  const column=ctx.selection.columns[at(mapping.x)],exact=exactRational(raw(mapping.x),column.representation,column.radix);
  if(!same({numerator:String(exact.numerator),denominator:String(exact.denominator)},(()=>{const value=rational(receipt.coordinates.x.exact);return {numerator:String(value.numerator),denominator:String(value.denominator)};})()))fail();
 }else if(raw(mapping.x).trim()!==selectedPoint(ctx.content,receipt).x)fail();
 if((mapping.operation??'raw')!=='raw')return;
 for(const [field,index]of Object.entries(refColumns(mapping,receipt.column))){
  if(field==='group')continue;
  const point=selectedPoint(ctx.content,receipt);
  if(field==='count'){
   if(missing(index)){if(point.count!=null)fail();continue;}
   const column=ctx.selection.columns[at(index)],exact=exactRational(raw(index),column.representation,column.radix);
   if(!Number.isSafeInteger(point.count)||point.count<0||exact.denominator!==1n||exact.numerator!==BigInt(point.count))fail();continue;
  }
  if(field[0]==='x'&&mapping.xKind!=='number'){if((point[field]??null)!==(missing(index)?null:raw(index).trim()))fail();continue;}
  const coordinate=receipt.coordinates[field];if(missing(index)){if(coordinate)fail();continue;}if(!coordinate)fail();
  const column=ctx.selection.columns[at(index)],exact=exactRational(raw(index),column.representation,column.radix),stored=rational(coordinate.exact);if(exact.numerator!==stored.numerator||exact.denominator!==stored.denominator)fail();
 }
}
export async function verifyPlotProjection(materials,doc,{signal}={}){
 if(doc.content.version!=='8'||doc.content.tool!=='Observanda table mapping')return;
 try{
  await materials.workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresNativeNumericalModels}=await import('./catalogue-format.js');if(!catalogueRequiresNativeNumericalModels(await catalogueFormat(store.db)))fail();});
  const ctx=await context(materials,doc);let index=0,memberOffset=0;
  for(const [series,s]of ctx.content.figure.series.entries())for(let point=0;point<s.points.length;point++){
   signal?.throwIfAborted();const receipt=await materials.sequences.item(ctx.points,index++);checkReceipt(ctx.content,receipt);if(receipt.series!==series||receipt.point!==point)fail();
   if(receipt.source)checkSource(ctx,receipt,await rowAt(materials,ctx,receipt.source));
   else{if(receipt.members.offset!==memberOffset||receipt.members.count>ctx.members.count-memberOffset)fail();let previous=null;for(let at=0;at<receipt.members.count;at+=64){signal?.throwIfAborted();const page=await materials.sequences.page(ctx.members,{offset:memberOffset+at,limit:Math.min(64,receipt.members.count-at)});for(const position of page.items){if(previous&&(position.page<previous.page||position.page===previous.page&&position.row<=previous.row))fail();checkSource(ctx,receipt,await rowAt(materials,ctx,position));previous=position;}}memberOffset+=receipt.members.count;}
  }
  if(ctx.members&&memberOffset!==ctx.members.count)fail();
 }catch(error){if(['ACCESS_LOCKED','WORKSPACE_CHANGED'].includes(error.code)||error.name==='AbortError')throw error;fail('CATALOGUE_DAMAGED');}
}
export async function plotPointPage(materials,ref,{offset=0,limit=16,signal}={}){
 if(!natural(offset)||!Number.isInteger(limit)||limit<1||limit>16)fail('INVALID');
 return materials.readSnapshot(async()=>{signal?.throwIfAborted();const doc=await materials.read(ref),ctx=await context(materials,doc),page=await materials.sequences.page(ctx.points,{offset,limit});return {...page,items:page.items.map((receipt,i)=>{const point=checkReceipt(ctx.content,receipt);return {index:offset+i,series:receipt.series,seriesName:ctx.content.figure.series[receipt.series].name,point:receipt.point,x:point.x,y:point.y};})};});
}
export async function inspectPlotPoint(materials,ref,index,{offset=0,signal}={}){
 if(!natural(index)||!natural(offset))fail('INVALID');
 return materials.readSnapshot(async()=>{
  signal?.throwIfAborted();const doc=await materials.read(ref),ctx=await context(materials,doc),receipt=await materials.sequences.item(ctx.points,index),point=checkReceipt(ctx.content,receipt),fields=refColumns(ctx.content.mapping,receipt.column),members=[],limit=16;
  if(receipt.members&&offset>receipt.members.count)fail('INVALID');
  const positions=receipt.source?(offset?fail('INVALID'):[receipt.source]):offset===receipt.members.count?[]:(await materials.sequences.page(ctx.members,{offset:receipt.members.offset+offset,limit:Math.min(limit,receipt.members.count-offset)})).items;
  for(const position of positions){signal?.throwIfAborted();const row=await rowAt(materials,ctx,position);checkSource(ctx,receipt,row);members.push({position,cells:Object.entries(fields).map(([field,column])=>({field,source:{ref:ctx.content.inputs[0],selector:{kind:'cell',...position,column}}}))});}
  const total=receipt.members?.count??1;
  return {index,seriesName:ctx.content.figure.series[receipt.series].name,point:receipt.point,coordinate:point,coordinates:receipt.coordinates,projection:ctx.content.mapping.projection,operation:ctx.content.mapping.operation??'raw',members,offset,total,previous:offset?Math.max(0,offset-limit):null,next:offset+positions.length<total?offset+positions.length:null};
 });
}
