import {AppError} from './errors.js';
import {validLocator,rationalIdentity} from './web/measurement-model.js';
import {selectedJSON} from './structured-selection.js';
import {inspectAggregation} from './dataset-aggregation.js';
const fail=()=>{throw new AppError('MEASUREMENT_INVALID');};
export const INSPECTION_BYTES=4096;
export async function inspectMeasurementSource(service,source,{offset=0,signal}={}){
 if(!validLocator(source)||!Number.isSafeInteger(offset)||offset<0)fail();
 signal?.throwIfAborted();const store=service.materials,s=source.selector;
 if(s.kind==='cell'){
  const cell=await service.cell(source),surrounding=[];
  for(let p=Math.max(0,s.page-1);p<=Math.min(store.datasetPageCount(cell.doc)-1,s.page+1);p++){
   if(p!==s.page&&!(s.row<2&&p<s.page||s.row>=cell.pageRows-2&&p>s.page))continue;
   const data=await store.retainedDatasetPage(cell.doc,p);
   for(const [i,r] of data.rows.entries()){
    const distance=p<s.page?i-data.rows.length-s.row:p>s.page?cell.pageRows-s.row+i:i-s.row;
    const kind=r.valueKinds?.[s.column],presence=['null','absent'].includes(kind)?kind:cell.column.missing.some(m=>m.value===r.cells[s.column])?'missing':'value';
    if(Math.abs(distance)<=2)surrounding.push({page:p,row:i,id:r.id,order:r.order??r.line,value:r.cells[s.column],presence,excluded:r.excluded});
   }
  }
  const artifact=cell.doc.content.inputs[0],l=cell.row.locator;
  let original={ref:artifact,selector:{kind:'whole'}};
  if(l?.byteOffset!==undefined)original={ref:artifact,selector:{kind:'bytes',offset:l.byteOffset,length:l.byteLength}};
  else if(l?.format==='json')original={ref:artifact,selector:{kind:'json-pointer',pointer:cell.row.cellPointers?.[s.column]??l.pointer+(cell.doc.content.sourceMapping.fields[s.column]?.path??'')}};
  if(!validLocator(original))original={ref:artifact,selector:{kind:'whole'}};
  const derivedSources=cell.row.cellSources?.[s.column];
  const aggregation=cell.doc.content.aggregation?await inspectAggregation(store,cell,s,{offset,signal}):null;
  return {kind:'cell',...cell,doc:undefined,exact:rationalIdentity(cell.value),surrounding,original:aggregation?null:derivedSources?.[0]??original,...(derivedSources?{derivedSources,calculation:cell.doc.content.calculation}:{}),...(aggregation?{aggregation,previous:aggregation.previous,next:aggregation.next}:{}),native:cell.row.nativeSelector?{ref:cell.doc.content.nativeMapping.artifact,selector:cell.row.nativeSelector}:null};
 }
 const doc=await store.read(source.ref);
 if(source.ref.kind!=='artifact')return {kind:'reference',title:doc.title,ref:source.ref};
 if(s.kind==='native-record')return {kind:'unresolved',nativeId:s.nativeId,original:source.ref};
 const {content}=await store.artifact(source.ref,{signal});
 if(s.kind==='json-pointer')return {kind:'json-pointer',pointer:s.pointer,text:await selectedJSON(content.read(0,content.size-1,{signal}),s.pointer,{signal,maximum:60000}),original:source.ref};
 const start=s.kind==='bytes'?s.offset:0,length=s.kind==='bytes'?s.length:content.size;
 if(start+length>content.size||offset>Math.max(0,length-1))fail();
 const from=start+offset,to=Math.min(start+length,from+INSPECTION_BYTES),contextFrom=Math.max(0,from-64),contextTo=Math.min(content.size,to+64),parts=[];
 for await(const b of content.read(contextFrom,contextTo-1,{signal}))parts.push(b);
 const bytes=Buffer.concat(parts),selected=bytes.subarray(from-contextFrom,to-contextFrom);
 return {kind:'bytes',offset:from,length:to-from,total:length,next:to<start+length?offset+INSPECTION_BYTES:null,previous:offset?Math.max(0,offset-INSPECTION_BYTES):null,contextOffset:contextFrom,hex:bytes.toString('hex').match(/.{1,32}/g)?.join('\n')??'',text:bytes.toString('utf8'),base64:selected.toString('base64'),sha256:content.sha256,original:source.ref};
}
