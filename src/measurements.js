import {projectDatasetRows} from './dataset-storage.js';
import {derivedComputation,effectiveCellColumn} from './web/measurement-computation.js';
import {retainScalarDefinitions,resolveScalarDefinitions,scalarDefinitionEntries,measurementScalarPolicies} from './measurement-scalar-storage.js';
import {isScalarRepresentation} from './web/measurement-model.js';
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
 async validate(value,{signal,semantic=true}={}){
  if(!validMeasurement(value))fail();
  if(semantic&&measurementScalarPolicies(value))await resolveScalarDefinitions(this.materials,value,{signal});
  for(const ref of measurementReferences(value)){signal?.throwIfAborted();await this.materials.read(ref);}
  for(const source of value.sources){
   const doc=await this.materials.read(source.ref),s=source.selector;
   if(s.kind==='bytes'&&s.offset+s.length>doc.content.size)fail();
   if((doc.content?.measurement?.computation||doc.content?.summary?.computation)&&!value.computation)fail();
   if(s.kind==='cell'){const cell=await this.cell(source);if(cell.column.computation&&!value.computation)fail();if(cell.column.statisticalUncertainty&&(revisionText(value.statisticalUncertainty)!==revisionText(cell.column.statisticalUncertainty)||revisionText(value.time)!==revisionText(cell.time)||revisionText(value.quantity)!==revisionText(cell.quantity)||revisionText(value.resourcePolicy??null)!==revisionText(cell.column.resourcePolicy??null)||value.value.unit!==cell.value.unit||value.value.representation!==cell.value.representation||value.value.radix!==cell.value.radix))fail();if(cell.column.synchronization&&(revisionText(value.synchronization)!==revisionText(cell.column.synchronization)||revisionText(value.time)!==revisionText(cell.time)||revisionText(value.quantity)!==revisionText(cell.quantity)||value.value.unit!==cell.value.unit||value.value.representation!==cell.value.representation||value.value.radix!==cell.value.radix))fail();if(cell.quantity.origin==='raw-code'&&(value.value.unit||value.quantity.unitDefinition)&&!(value.quantity.origin==='derived'&&value.quantity.conversion))fail();}
   if(s.kind==='json-pointer')await this.inspect(source,{signal});
  }
 }
 async save({recordId,title,id,expectedRevision,measurement},{signal}={}){
  return this.materials.workspace.withLock(async()=>{
   await this.materials.assertOwner(recordId);if(!validMeasurement(measurement))fail();
   for(const source of measurement.sources){const doc=source.ref.kind==='dataset'?await this.cell(source):await this.materials.read(source.ref),origin=doc.column??doc.content?.measurement??doc.content?.summary;measurement={...measurement,...derivedComputation(origin),...(origin?.statisticalUncertainty?{statisticalUncertainty:structuredClone(origin.statisticalUncertainty)}:{}),...(origin?.synchronization?{synchronization:structuredClone(origin.synchronization)}:{})};}
   await this.validate(measurement,{signal,semantic:false});signal?.throwIfAborted();
   const m=this.materials,previous=id&&expectedRevision?(await m.read({kind:'analysis',id,revision:expectedRevision})):null;
   if(previous&&previous.recordId!==recordId)fail();
   const selected=(value,path)=>path.reduce((v,key)=>v?.[key],value),entries=scalarDefinitionEntries(measurement),bases=[previous?.content.measurement];
   if(entries.some(entry=>typeof entry.scalar.spelling!=='string'))for(const source of measurement.sources)if(source.ref.kind==='dataset')bases.push(await this.seed(source));
   for(const entry of entries)if(typeof entry.scalar.spelling!=='string'&&!bases.some(base=>revisionText(selected(base,entry.path))===revisionText(entry.scalar.spelling)))fail();
   measurement=await retainScalarDefinitions(m,measurement,fn=>fn(),{signal,base:measurement});
   if(id){const current=await this.materials.current(id);if(current&&current.kind==='analysis'&&current.recordId===recordId&&current.title===title){const doc=await this.materials.read(current);if(doc.content.measurement&&doc.previous===(expectedRevision??null)&&revisionText(doc.content.measurement)===revisionText(measurement))return {kind:current.kind,id:current.id,revision:current.revision};}}
   const inputs=[...new Map(measurementReferences(measurement).map(r=>[materialReferenceKey(r),r])).values()];
   return this.materials.commit({kind:'analysis',recordId,title,id,expectedRevision,content:{inputs,tool:'Observanda measurement provenance',version:'1',parameters:'',measurement}});
  });
 }
 async cell(source){
  if(!validLocator(source)||source.ref.kind!=='dataset')fail();
  const {page,row,column}=source.selector,doc=await this.materials.read(source.ref),indexed=doc.content.datasetFormat===3,data=await this.materials.retainedDatasetPage(doc,page,indexed?{metadataOnly:true}:{columns:[column]});
  let selected=data.rows[row];if(!selected)fail();if(indexed)selected=(await projectDatasetRows(this.materials,doc,[selected],[column])).rows[0];
  const schema=await this.materials.retainedSchemaPage(doc,{offset:column,limit:1});
  if(!selected||schema.items.length!==1)fail();
  const declaredColumn=schema.items[0],col=effectiveCellColumn(declaredColumn,{...(selected.cellComputations?.[0]!==undefined?{computation:selected.cellComputations[0]}:{})}),kind=selected.valueKinds?.[0],presence=['null','absent'].includes(kind)?kind:col.missing.some(m=>m.value===selected.cells[0])?'missing':'value';
  return {doc,pageRows:data.rows.length,row:selected,column:col,...(typeof selected.cells[0]==='string'?{}:{cellReference:selected.cells[0]}),value:{spelling:typeof selected.cells[0]==='string'?selected.cells[0]:'',representation:col.representation,...(col.domain?{domain:col.domain}:{}),radix:col.radix,unit:col.unit,presence},quantity:col.quantity??blankQuantity(),time:col.time,...(col.statisticalUncertainty?{statisticalUncertainty:col.statisticalUncertainty}:{}),...(col.synchronization?{synchronization:col.synchronization}:{})};
 }
 inspect(source,options={}){const run=()=>inspectMeasurementSource(this,source,options),workspace=this.materials.workspace;return workspace.withCatalogueConnections?workspace.withCatalogueConnections(run):run();}
 async seed(source){
  if(!validLocator(source))fail();
  if(source.ref.kind==='dataset'){
   const c=await this.cell(source);if(c.cellReference&&(!c.column.resourcePolicy||!isScalarRepresentation(c.value)))throw new AppError('DATASET_CELL_SCALAR_REQUIRED');return {...(c.column.resourcePolicy?{version:2,resourcePolicy:c.column.resourcePolicy}:{}),value:{...c.value,...(c.cellReference?{spelling:c.cellReference}:{})},quantity:c.quantity,time:c.time,...(c.column.synchronization?{synchronization:structuredClone(c.column.synchronization)}:{}),...(c.column.statisticalUncertainty?{statisticalUncertainty:structuredClone(c.column.statisticalUncertainty)}:{}),...derivedComputation(c.column),sources:[source]};
  }
  const doc=await this.materials.read(source.ref);
  return {...derivedComputation(doc.content?.measurement??doc.content?.summary),value:{spelling:'',representation:'unsupported',radix:10,unit:'',presence:'unknown'},quantity:blankQuantity(),time:{kind:'unknown',reference:'',resolution:'',uncertainty:''},sources:[source]};
 }
}
