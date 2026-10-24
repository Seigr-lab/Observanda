import {validatePolicyScalar} from './web/measurement-scalar-policy.js';
import {domainValueReference,domainValuePage} from './measurement-domain-storage.js';
import {graphCellSources} from './calculation-graph-lineage.js';
import {AppError} from './errors.js';
import {validLocator,rationalIdentity} from './web/measurement-model.js';
import {inspectJSONValue} from './structured-inspection.js';
import {inspectAggregation} from './dataset-aggregation.js';
const fail=()=>{throw new AppError('MEASUREMENT_INVALID');};
export const INSPECTION_BYTES=4096;
export async function inspectMeasurementSource(service,source,{offset=0,lineageOffset=0,lineageLimit=16,sourceOffset=0,componentOffset=0,topologyCollection='vertices',signal}={}){
 if(!validLocator(source)||!Number.isSafeInteger(offset)||offset<0)fail();
 signal?.throwIfAborted();const store=service.materials,s=source.selector;
 if(s.kind==='cell'){
  const cell=await service.cell(source),surrounding=[];
  for(let p=Math.max(0,s.page-1);p<=Math.min(store.datasetPageCount(cell.doc)-1,s.page+1);p++){
   if(p!==s.page&&!(s.row<2&&p<s.page||s.row>=cell.pageRows-2&&p>s.page))continue;
   const data=await store.retainedDatasetPage(cell.doc,p,{columns:[s.column]});
   for(const [i,r] of data.rows.entries()){
    const distance=p<s.page?i-data.rows.length-s.row:p>s.page?cell.pageRows-s.row+i:i-s.row;
    const kind=r.valueKinds?.[0],presence=['null','absent'].includes(kind)?kind:cell.column.missing.some(m=>m.value===r.cells[0])?'missing':'value';
    if(Math.abs(distance)<=2)surrounding.push({page:p,row:i,id:r.id,order:r.order??r.line,value:typeof r.cells[0]==='string'?r.cells[0]:(await store.readDatasetCell(r.cells[0],{limit:128,signal})).text+'...',presence,excluded:r.excluded,computation:r.cellComputations?.[0]!==undefined?r.cellComputations[0]:cell.column.computation??null});
   }
  }
  const artifact=cell.doc.content.inputs?.[0]??cell.doc.content.calculation?.graph,l=cell.row.locator;
  let original={ref:artifact,selector:{kind:'whole'}};
  if(l?.byteOffset!==undefined)original={ref:artifact,selector:{kind:'bytes',offset:l.byteOffset,length:l.byteLength}};
  else if(l?.format==='json')original={ref:artifact,selector:{kind:'json-pointer',pointer:cell.row.cellPointers?.[0]??l.pointer+(cell.column.sourceField?.path??cell.doc.content.sourceMapping.fields?.[s.column]?.path??'')}};
  if(!validLocator(original))original={ref:artifact,selector:{kind:'whole'}};
  const derivedSources=cell.row.cellSources?.[0],lineage=cell.row.cellLineages?.[0]?await graphCellSources(store,cell.doc,cell.row,{lineage:cell.row.cellLineages[0]},{offset:lineageOffset,limit:lineageLimit,sourceOffset,signal}):null;
  const textPage=cell.cellReference?await store.readDatasetCell(cell.cellReference,{offset,limit:4096,signal}):null;
  const domain=domainValueReference(cell.cellReference)?await domainValuePage(store,cell.cellReference,{offset:componentOffset,limit:32,collection:topologyCollection,signal}):null;
  const aggregation=cell.doc.content.aggregation?await inspectAggregation(store,cell,s,{offset,signal}):null;
  return {kind:'cell',...cell,doc:undefined,...(domain?{domain}:{}),...(textPage?{textPage,previous:textPage.previous,next:textPage.next}:{}),exact:cell.cellReference?null:cell.column.resourcePolicy&&cell.value.presence==='value'?(()=>{const exact=validatePolicyScalar({spelling:cell.value.spelling,representation:cell.value.representation,radix:cell.value.radix},cell.column.resourcePolicy);return {numerator:String(exact.numerator),denominator:String(exact.denominator)};})():rationalIdentity(cell.value),surrounding,original:aggregation||lineage?null:derivedSources?.[0]??original,...(derivedSources?{derivedSources,calculation:cell.doc.content.calculation}:{}),...(aggregation?{aggregation,previous:aggregation.previous,next:aggregation.next}:{}),...(lineage?{lineage,calculation:cell.doc.content.calculation}:{}),native:cell.row.nativeSelector?{ref:cell.doc.content.nativeMapping.artifact,selector:cell.row.nativeSelector}:null};
 }
 const doc=await store.read(source.ref);
 if(source.ref.kind!=='artifact')return {kind:'reference',title:doc.title,ref:source.ref};
 if(s.kind==='native-record')return {kind:'unresolved',nativeId:s.nativeId,original:source.ref};
 const {content}=await store.artifact(source.ref,{signal});
 if(s.kind==='json-pointer'){const textPage=await inspectJSONValue(content.read(0,content.size-1,{signal}),s.pointer,{offset,signal});return {kind:'json-pointer',pointer:s.pointer,text:textPage.text,textPage,previous:textPage.previous,next:textPage.next,original:source.ref};}
 const start=s.kind==='bytes'?s.offset:0,length=s.kind==='bytes'?s.length:content.size;
 if(start+length>content.size||offset>Math.max(0,length-1))fail();
 const from=start+offset,to=Math.min(start+length,from+INSPECTION_BYTES),contextFrom=Math.max(0,from-64),contextTo=Math.min(content.size,to+64),parts=[];
 for await(const b of content.read(contextFrom,contextTo-1,{signal}))parts.push(b);
 const bytes=Buffer.concat(parts),selected=bytes.subarray(from-contextFrom,to-contextFrom);
 return {kind:'bytes',offset:from,length:to-from,total:length,next:to<start+length?offset+INSPECTION_BYTES:null,previous:offset?Math.max(0,offset-INSPECTION_BYTES):null,contextOffset:contextFrom,hex:bytes.toString('hex').match(/.{1,32}/g)?.join('\n')??'',text:bytes.toString('utf8'),base64:selected.toString('base64'),sha256:content.sha256,original:source.ref};
}
