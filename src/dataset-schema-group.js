import {AppError} from './errors.js';
import {exact} from './modules/validation.js';
import {validColumns} from './research-materials.js';
import {validMaterialReference} from './web/material-reference.js';
import {revisionText} from './web/revision-model.js';
import {schemaReferences} from './web/measurement-model.js';
import {scratchInterpretations} from './dataset-profile-review.js';
import {interpretDatasetCell} from './dataset-cell-interpretation.js';
import {projectDatasetRows} from './dataset-storage.js';
import {withScratch} from './scratch-work.js';
import {verifyCalibrationReview} from './scientific-calibrations.js';
import {verifyScientificUnitSource} from './scientific-unit-library.js';
import {scalarDefinitionEntries} from './measurement-scalar-storage.js';

const invalid=()=>{throw new AppError('MATERIAL_INVALID');};
const groups={
 number:['representation','radix','resourcePolicy','domain'],
 quantity:['unit','quantity'],
 missing:['missing'],
 time:['time']
};
const protectedResult=column=>!!(column.weightedFit||column.cusum||column.spectrum||column.coordinateAlignment||column.coordinateAxis||column.computation);
const rejected=new Set(['MATERIAL_INVALID','MATERIAL_DATASET_LIMIT','MEASUREMENT_DOMAIN_INVALID','MEASUREMENT_SEQUENCE_INPUT','MEASUREMENT_TOPOLOGY_INPUT','DATASET_CALCULATION_RESOURCE']);
const integer=v=>Number.isSafeInteger(v)&&v>=0;

async function planGroup(materials,command,{signal,check}){
 if(!exact(command,['ref','sourceIndex','sourceColumn','properties','ranges','pending'])||!validMaterialReference(command.ref)||command.ref.kind!=='dataset'||
  !integer(command.sourceIndex)||!Array.isArray(command.properties)||!command.properties.length||
  new Set(command.properties).size!==command.properties.length||command.properties.some(key=>!Object.hasOwn(groups,key))||
  !Array.isArray(command.ranges)||!command.ranges.length||!Array.isArray(command.pending))invalid();
 await check?.(command.ref);
 const doc=await materials.read(command.ref);await materials.assertOwner(doc.recordId);
 const width=doc.content.schemaIndex?.count??doc.content.columns.length,original=await materials.datasetColumn(doc,command.sourceIndex);
 if(command.sourceIndex>=width)invalid();
 let end=0,selected=0;
 for(const range of command.ranges){
  if(!exact(range,['offset','count'])||!integer(range.offset)||range.offset<end||!integer(range.count)||!range.count||range.count>width-range.offset)invalid();
  end=range.offset+range.count;selected+=range.count;
 }
 const donor=command.sourceColumn??original;
 if(!validColumns([donor],1))invalid();
 for(const entry of scalarDefinitionEntries(donor)){
  if(typeof entry.scalar.spelling==='string')continue;
  const prior=entry.path.reduce((value,key)=>value?.[key],original);
  if(revisionText(prior)!==revisionText(entry.scalar.spelling))invalid();
 }
 for(const ref of schemaReferences(donor))await check?.(ref);
 await verifyScientificUnitSource(materials,donor.quantity,{signal});
 if(donor.quantity?.calibrationReview)await verifyCalibrationReview(materials,donor.quantity,{signal});
 const fields=command.properties.flatMap(key=>groups[key]);
 const pending=new Map();
 for(const change of command.pending){
  if(!exact(change,['index','column'])||!integer(change.index)||change.index>=width||pending.has(change.index)||
   !validColumns([change.column],1))invalid();
  pending.set(change.index,change.column);
 }
 function change(before){
  const after={...before};
  for(const key of fields){if(donor[key]===undefined)delete after[key];else after[key]=donor[key];}
  return after;
 }
 async function* windows(){
  for(const range of command.ranges)for(let start=range.offset;start<range.offset+range.count;start+=16){
   signal?.throwIfAborted();
   const page=await materials.retainedSchemaPage(doc,{offset:start,limit:Math.min(16,range.offset+range.count-start)});
   const items=[];
   for(const [position,original] of page.items.entries()){
    const index=start+position,before=pending.get(index)??original,after=change(before);
    for(const entry of scalarDefinitionEntries(before)){
     if(typeof entry.scalar.spelling==='string')continue;
     const prior=entry.path.reduce((value,key)=>value?.[key],original);
     if(revisionText(prior)!==revisionText(entry.scalar.spelling))invalid();
    }
    if(before!==original)for(const ref of schemaReferences(before))await check?.(ref);
    items.push({index,before,after,valid:validColumns([after],1)&&!protectedResult(original),changed:revisionText(before)!==revisionText(after)});
   }
   yield items;
  }
 }
 return {doc,selected,fields,windows};
}

export async function reviewSchemaGroup(materials,command,{offset=0,limit=32,values=true,signal,check,verify}={}){
 if(!integer(offset)||!Number.isSafeInteger(limit)||limit<1||limit>64)invalid();
 const {doc,selected,fields,windows}=await planGroup(materials,command,{signal,check});
 const result={selected,changed:0,changedColumns:{items:[],offset,next:null},invalid:0,examples:[],issues:[]};
 await withScratch(async plan=>{
  let groupCount=0;
  for await(const group of windows()){
   await verify?.();await check?.(command.ref);
   const eligible=[];
   for(const item of group){
    if(!item.changed)continue;
    if(result.changed>=offset&&result.changedColumns.items.length<limit){
     result.changedColumns.items.push({index:item.index,column:item.after,fields:fields.filter(key=>revisionText(item.before[key])!==revisionText(item.after[key]))});
    }
    result.changed++;
    if(item.valid)eligible.push(item);
    else{result.invalid++;if(result.issues.length<32)result.issues.push({column:item.index,name:item.before.name,reason:'invalid-column'});}
   }
   if(values&&eligible.length)await plan.put('group:'+groupCount++,eligible.map(({index,after})=>({index,after})));
  }
  if(!groupCount)return;
  await withScratch(async work=>{
   const review=scratchInterpretations(materials,work);
   for(let page=0;page<materials.datasetPageCount(doc);page++){
    signal?.throwIfAborted();await verify?.();await check?.(command.ref);
    const source=await materials.retainedDatasetPage(doc,page,{metadataOnly:true});
    for(let groupIndex=0;groupIndex<groupCount;groupIndex++){
     const eligible=await plan.get('group:'+groupIndex);
     const {rows}=await projectDatasetRows(materials,doc,source.rows,eligible.map(item=>item.index));
     for(const row of rows)for(let index=0;index<eligible.length;index++){
      const {after,index:column}=eligible[index],cell={kind:row.valueKinds[index],value:row.cells[index],pointer:row.cellPointers[index]};
      const locator={...row.locator,column,...(cell.pointer!==null?{cellPointer:cell.pointer}:{})};
      let reason=null;
      try{await interpretDatasetCell(review,cell,after,fn=>fn(),{signal,calculation:doc.content.calculation,calculatorResult:doc.content.calculatorResult});}
      catch(error){if(!rejected.has(error.code)&&!(error instanceof RangeError))throw error;reason=error.code??'MATERIAL_INVALID';}
      if(work.size>=128)await work.clear();
      const destination=reason?result.issues:result.examples;
      if(reason)result.invalid++;
      if(destination.length<32){
       const preview=await materials.readDatasetCell(cell.value,{offset:0,limit:160,signal});
       destination.push({name:after.name,locator,spelling:preview.text,characters:preview.total,...(reason?{reason}:{})});
      }
     }
    }
   }
  },{signal});
 },{signal});
 if(offset+result.changedColumns.items.length<result.changed)result.changedColumns.next=offset+result.changedColumns.items.length;
 return result;
}
