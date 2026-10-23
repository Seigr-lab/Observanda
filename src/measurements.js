import {materialReferenceKey} from './web/material-reference.js';
import {AppError} from './errors.js';
import {validMeasurement,measurementReferences,validLocator,blankQuantity} from './web/measurement-model.js';
import {inspectMeasurementSource} from './measurement-inspector.js';
import {revisionText} from './web/revision-model.js';
const fail=()=>{throw new AppError('MEASUREMENT_INVALID');};

// A measurement is an immutable, revision-addressed analysis. Existing evidence
// traversal, dependency review, backup and A4 criterion links use that same owner.
export class Measurements {
 constructor(materials){this.materials=materials;}
 async validate(value,{signal}={}){
  if(!validMeasurement(value))fail();
  for(const ref of measurementReferences(value)){signal?.throwIfAborted();await this.materials.read(ref);}
  for(const source of value.sources){
   const doc=await this.materials.read(source.ref),s=source.selector;
   if(s.kind==='bytes'&&s.offset+s.length>doc.content.size)fail();
   if(s.kind==='cell'){const cell=await this.cell(source);if(cell.quantity.origin==='raw-code'&&(value.value.unit||value.quantity.unitDefinition)&&!(value.quantity.origin==='derived'&&value.quantity.conversion))fail();}
   if(s.kind==='json-pointer')await this.inspect(source,{signal});
  }
 }
 async save({recordId,title,id,expectedRevision,measurement},{signal}={}){
  return this.materials.workspace.withLock(async()=>{
   await this.materials.assertOwner(recordId);await this.validate(measurement,{signal});signal?.throwIfAborted();
   if(id){const current=await this.materials.current(id);if(current&&current.kind==='analysis'&&current.recordId===recordId&&current.title===title){const doc=await this.materials.read(current);if(doc.content.measurement&&doc.previous===(expectedRevision??null)&&revisionText(doc.content.measurement)===revisionText(measurement))return {kind:current.kind,id:current.id,revision:current.revision};}}
   const inputs=[...new Map(measurementReferences(measurement).map(r=>[materialReferenceKey(r),r])).values()];
   return this.materials.commit({kind:'analysis',recordId,title,id,expectedRevision,content:{inputs,tool:'Observanda measurement provenance',version:'1',parameters:'',measurement}});
  });
 }
 async cell(source){
  if(!validLocator(source)||source.ref.kind!=='dataset')fail();
  const {page,row,column}=source.selector,doc=await this.materials.read(source.ref),data=await this.materials.retainedDatasetPage(doc,page,{columns:[column]}),selected=data.rows[row];
  const schema=await this.materials.retainedSchemaPage(doc,{offset:column,limit:1});
  if(!selected||schema.items.length!==1)fail();
  const col=schema.items[0],kind=selected.valueKinds?.[0],presence=['null','absent'].includes(kind)?kind:col.missing.some(m=>m.value===selected.cells[0])?'missing':'value';
  return {doc,pageRows:data.rows.length,row:selected,column:col,...(typeof selected.cells[0]==='string'?{}:{cellReference:selected.cells[0]}),value:{spelling:typeof selected.cells[0]==='string'?selected.cells[0]:'',representation:col.representation,...(col.domain?{domain:col.domain}:{}),radix:col.radix,unit:col.unit,presence},quantity:col.quantity??blankQuantity(),time:col.time};
 }
 inspect(source,options={}){const run=()=>inspectMeasurementSource(this,source,options),workspace=this.materials.workspace;return workspace.withCatalogueConnections?workspace.withCatalogueConnections(run):run();}
 async seed(source){
  if(!validLocator(source))fail();
  if(source.ref.kind==='dataset'){
   const c=await this.cell(source);if(c.cellReference)throw new AppError('DATASET_CELL_SCALAR_REQUIRED');return {value:c.value,quantity:c.quantity,time:c.time,sources:[source]};
  }
  await this.materials.read(source.ref);
  return {value:{spelling:'',representation:'unsupported',radix:10,unit:'',presence:'unknown'},quantity:blankQuantity(),time:{kind:'unknown',reference:'',resolution:'',uncertainty:''},sources:[source]};
 }
}
