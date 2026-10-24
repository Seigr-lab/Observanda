import {retainScalarDefinitions,measurementScalarPolicies,resolveScalarOperand} from './measurement-scalar-storage.js';
import {calculatorResultScalar} from './calculator-results.js';
import {policyScalarText} from './dataset-resource-values.js';
import {clockScalarText,intervalScalarText} from './dataset-scalar-text.js';
import {retainDomainValue,domainValueReference,validateDomainValue} from './measurement-domain-storage.js';
import {DATASET_ROWS_PER_PAGE} from './dataset-row-position.js';
import {withDatasetPreparationWrites} from './dataset-preparation-writes.js';
// Current retained datasets separate schema, row identities and cell values.
// All content uses the existing immutable material metadata and sequence index.
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {revisionText} from './web/revision-model.js';
import {schemaReferences,supportedValue} from './web/measurement-model.js';
import {materialReferenceKey} from './web/material-reference.js';
import {defaultColumn} from './web/dataset-schema.js';
import {readPagedDataset} from './dataset-paged-reader.js';
import {retainDatasetCell,validateDatasetCell,datasetCellReference} from './dataset-cell-storage.js';
import {withScratch} from './scratch-work.js';
import {nativeRowLocator} from './native-mapping.js';
const fail=(code='MATERIAL_INVALID')=>{throw new AppError(code);};
export async function* datasetColumns(materials,doc){
 if(doc.content.datasetFormat===2||doc.content.datasetFormat===3){materials.sequences.validate(doc.content.schemaIndex);yield* materials.sequences.items(doc.content.schemaIndex);}else yield* doc.content.columns;
}
export async function* storedDatasetCells(materials,doc,row){
 if(doc.content.datasetFormat===3){materials.sequences.validate(row.cellIndex);if(row.cellIndex.kind!=='cells'||row.cellIndex.count!==doc.content.schemaIndex.count)fail('MATERIAL_MISSING');for await(const cell of materials.sequences.items(row.cellIndex))yield validateDatasetCell(materials,cell);}
 else for(let i=0;i<row.cells.length;i++)yield {value:row.cells[i],kind:row.valueKinds?.[i]??'string',...(row.cellPointers?{pointer:row.cellPointers[i]}:{}),...(row.cellSources?.[i]?{sources:row.cellSources[i]}:{})};
}
export async function preparePagedDataset(materials,command,{source,base=null,signal,progress=async()=>{},writePage,columnDefaults=defaultColumn,nativeSize:declaredNativeSize,rows:preparedRows,calculatedColumns,inputReferences,validColumns,preparedWrites=false}={}){
 const prepare=materials=>withScratch(async scratch=>{
 const save=fn=>fn(),pages=materials.sequences.builder('pages',save),schemaInputs=materials.sequences.builder('references',save);
 const nativeMapping=command.nativeMapping??base?.content.nativeMapping,nativeSize=nativeMapping?(declaredNativeSize??(await materials.read(nativeMapping.artifact)).content.size):null;
 const nativeColumns=nativeMapping?[...new Set(['offsetColumn','lengthColumn','pointerColumn','idColumn'].map(k=>nativeMapping[k]).filter(v=>v!==null))]:[];
 const changes=new Map((command.columnChanges??[]).map(c=>[c.index,c.column])),exclusions=command.exclusions??{},seen=new Set();let schemaIndex,width=0,count=0,included=0,pageIncluded=0,page=[],sourceMapping,aggregationMembersIndex=base?.content.aggregationMembersIndex;
 const flush=async()=>{if(!page.length)return;const hash=digest(revisionText(page)),rows=page;await save(()=>materials.put(materials.metadataFile('tables/'+hash+'.json'),rows));await pages.append({hash,count:rows.length,start:count-rows.length,includedStart:included-pageIncluded,included:pageIncluded});page=[];pageIncluded=0;};
 async function* retained(){yield {columnCount:base.content.schemaIndex?.count??base.content.columns.length,columns:()=>datasetColumns(materials,base),sourceMapping:base.content.sourceMapping,retained:true};
  let order=0;for(let index=0;index<materials.datasetPageCount(base);index++){const data=await materials.retainedDatasetPage(base,index,{metadataOnly:true});for(const row of data.rows){signal?.throwIfAborted();yield {...row,order:++order,cells:()=>storedDatasetCells(materials,base,row)};}await progress({stage:'validating dataset rows',done:order,total:base.content.rowCount});}}
 let hasTensors=false,hasDomains=false,hasScalarPolicies=false,hasApproximateComputations=false,hasClockSynchronization=false;
 const input=preparedRows??(base?retained():readPagedDataset(source.content.read(0,source.content.size-1,{signal}),command.sourceMapping,{signal,progress,size:source.content.size}));
 for await(const item of input){
  signal?.throwIfAborted();
  if(item.columnCount!==undefined||Array.isArray(item.columns)){
   if(schemaIndex)fail();width=item.columnCount??item.columns.length;if(!Number.isSafeInteger(width)||width<1)fail();
   const definitions=typeof item.columns==='function'?item.columns():item.columns.map(name=>({name}));let index=0;
   for await(const definition of definitions){let column=changes.get(index)??calculatedColumns?.[index]??command.columns?.[index]??(item.retained?definition:columnDefaults({label:definition.name}));if(item.retained&&definition.computation)column={...column,computation:structuredClone(definition.computation)};if(item.retained&&definition.synchronization)column={...column,synchronization:structuredClone(definition.synchronization),time:structuredClone(definition.time),quantity:structuredClone(definition.quantity),unit:definition.unit,representation:definition.representation,radix:definition.radix};hasClockSynchronization||=!!column.synchronization;hasApproximateComputations||=!!column.computation;if(!validColumns([column],1))fail();if(column.representation==='domain')hasDomains=true;if(column.domain?.version===3)hasTensors=true;const declared=measurementScalarPolicies(column),authored=changes.has(index)||command.columns?.[index]!==undefined,retainedColumn=declared?await retainScalarDefinitions(materials,column,save,{signal,base:item.retained?definition:undefined,allowRetained:!authored&&(item.retained||!!preparedRows)}):column;hasScalarPolicies||=declared;await scratch.put('schema-column:'+index,{...retainedColumn,...(definition.sourceField?{sourceField:definition.sourceField}:{})});
    for(const ref of schemaReferences(column))if(await scratch.add('schema-ref:'+materialReferenceKey(ref)))await schemaInputs.append(ref);index++;
   }
   if(index!==width||command.columns&&command.columns.length!==width||[...changes.keys()].some(i=>i>=width))fail();const schema=materials.sequences.builder(hasScalarPolicies?'columns-policy':'columns',save);for(let at=0;at<width;at++){signal?.throwIfAborted();await schema.append(await scratch.get('schema-column:'+at));await scratch.remove('schema-column:'+at);}schemaIndex=await schema.finish();if(nativeMapping&&!await scratch.has('schema-ref:'+materialReferenceKey(nativeMapping.artifact)))await schemaInputs.append(nativeMapping.artifact);
   const {fields,...mapping}=item.sourceMapping??{};sourceMapping={...mapping,...(fields||base?.content.sourceMapping?.fieldsInSchema?{fieldsInSchema:true}:{})};aggregationMembersIndex=item.aggregationMembersIndex??aggregationMembersIndex;continue;
  }
  if(!schemaIndex)fail();const order=item.order??count+1,id=item.id??source.doc.id+':'+(item.locator.format==='delimited'?item.line:order),excluded=Object.hasOwn(exclusions,id)?exclusions[id]:item.excluded??null;
  if(Object.hasOwn(exclusions,id))seen.add(id);
  const native={columnIndices:nativeColumns,cells:[],valueKinds:[]},builder=materials.sequences.builder('cells',save);let index=0,cached=[],cachedOffset=0;
  async function* supplied(){if(typeof item.cells==='function')yield* item.cells();else for(let i=0;i<item.cells.length;i++)yield {value:item.cells[i],kind:item.valueKinds?.[i]??'string',...(item.cellPointers?{pointer:item.cellPointers[i]}:{}),...(item.cellSources?.[i]?{sources:item.cellSources[i]}:{})};}
  for await(const raw of supplied()){
   if(index>=width)fail();if(index%16===0){cachedOffset=index;cached=(await materials.sequences.page(schemaIndex,{offset:index,limit:16})).items;}
   const column=cached[index-cachedOffset],supplied=domainValueReference(raw.value)&&(column.representation!=='domain'||revisionText(raw.value.definition)!==revisionText(column.domain))?{...raw,value:raw.value.original}:raw;let cell=await retainDatasetCell(materials,supplied,save);
   if(column.representation==='domain'&&!['null','absent'].includes(cell.kind)&&!column.missing.some(m=>m.value===cell.value))cell={...cell,value:await retainDomainValue(materials,cell,column.domain,save,{signal})};
   if(!['null','absent'].includes(cell.kind)){
    if(domainValueReference(cell.value)){if(column.representation!=='domain')fail();validateDomainValue(materials,cell.value,column.domain);}
    else if(column.resourcePolicy&&!column.missing.some(m=>m.value===cell.value))await resolveScalarOperand(materials,cell,column,{signal});
    else if(datasetCellReference(cell.value)){if(!['text','unsupported'].includes(column.representation)&&!await policyScalarText(materials,cell.value,column,command.calculation??base?.content.calculation,cell.lineage,{signal})&&!await clockScalarText(materials,cell.value,column,command.calculation??base?.content.calculation,cell.lineage,{signal})&&!await intervalScalarText(materials,cell.value,column,command.calculation??base?.content.calculation,cell.lineage,{signal})&&!await calculatorResultScalar(materials,cell.value,column,command.calculatorResult,{signal}))fail();}
    else if(!column.missing.some(m=>m.value===cell.value)&&!supportedValue(cell.value,column.representation,column.radix)&&!await policyScalarText(materials,cell.value,column,command.calculation??base?.content.calculation,cell.lineage,{signal})&&!await calculatorResultScalar(materials,cell.value,column,command.calculatorResult,{signal}))fail();
   }
   const nativeIndex=nativeColumns.indexOf(index);if(nativeIndex>=0){native.cells[nativeIndex]=cell.value;native.valueKinds[nativeIndex]=cell.kind;}
   await builder.append(cell);index++;
  }
  if(index!==width)fail();
  const row={id,line:item.line??order,excluded,order,locator:item.locator,cellIndex:await builder.finish(),...(item.calculationLineage?{calculationLineage:item.calculationLineage}:{}),...(item.aggregation?{aggregation:item.aggregation}:{}),...(item.aggregationMembers?{aggregationMembers:item.aggregationMembers}:{})};if(nativeMapping)row.nativeSelector=nativeRowLocator(nativeMapping,native,nativeSize).selector;
  page.push(row);count++;if(!row.excluded){included++;pageIncluded++;}if(!Number.isSafeInteger(count))fail('MATERIAL_DATASET_LIMIT');if(page.length===DATASET_ROWS_PER_PAGE)await flush();
 }
 await flush();if(!schemaIndex||Object.keys(exclusions).length!==seen.size)fail();signal?.throwIfAborted();
 const calculation=command.calculation??base?.content.calculation,aggregation=command.aggregation??base?.content.aggregation;
 return {commandHash:digest(revisionText(command)),content:{datasetFormat:3,...(hasClockSynchronization?{clockSynchronization:1}:{}),...(hasApproximateComputations?{approximateComputations:1}:{}),...(hasScalarPolicies?{scalarPolicies:1}:{}),...(hasDomains?{domainValues:1}:{}),...(hasTensors?{tensorValues:1}:{}),inputs:inputReferences??base?.content.inputs??[command.artifact],schemaInputsIndex:await schemaInputs.finish(),schemaIndex,pageIndex:await pages.finish(),rowCount:count,includedRowCount:included,sourceMapping,...(calculation?{calculation,algorithm:'observanda-retained-calculations',algorithmVersion:calculation.version>=4?calculation.version-1:calculation.version===3?2:1}:{}),...(aggregation?{aggregation,algorithm:'observanda-retained-aggregation',algorithmVersion:1}:{}),...(aggregationMembersIndex?{aggregationMembersIndex}:{}),...(nativeMapping?{nativeMapping}:{}),delimiter:sourceMapping.delimiter??null,encoding:'UTF-8',order:aggregation?'first-group-occurrence':'acquisition'}};
 },{signal});return preparedWrites?prepare(materials):withDatasetPreparationWrites(materials,{writePage,signal},prepare);
}
export async function projectDatasetRows(materials,doc,rows,columns){
 const width=doc.content.schemaIndex?.count??doc.content.columns.length;
 if(columns===undefined){if(width>256)throw new AppError('MATERIAL_DATASET_LIMIT');columns=Array.from({length:width},(_,i)=>i);}
 if(!Array.isArray(columns)||columns.length>256||new Set(columns).size!==columns.length||columns.some(i=>!Number.isSafeInteger(i)||i<0||i>=width))throw new AppError('INVALID');
 const result=[];
 for(const row of rows){const cells=[],valueKinds=[],cellPointers=[],cellSources=[],cellLineages=[];let cachedOffset=-1,cached=[];
  if(doc.content.datasetFormat===3){materials.sequences.validate(row.cellIndex);if(row.cellIndex.kind!=='cells'||row.cellIndex.count!==width)fail('MATERIAL_MISSING');}
  for(const index of columns){let cell;if(doc.content.datasetFormat===3){const start=index-index%16;if(start!==cachedOffset){cached=(await materials.sequences.page(row.cellIndex,{offset:start,limit:16})).items;cachedOffset=start;}cell=validateDatasetCell(materials,cached[index-start]);}
   else cell={value:row.cells[index],kind:row.valueKinds?.[index]??'string',pointer:row.cellPointers?.[index],sources:row.cellSources?.[index]};
   cells.push(cell.value);valueKinds.push(cell.kind);cellPointers.push(cell.pointer??null);cellSources.push(cell.sources??null);cellLineages.push(cell.lineage??null);
  }
  const {cellIndex,...metadata}=row;result.push({...metadata,cells,valueKinds,cellPointers,cellSources,cellLineages,columnIndices:columns});
 }
 return {rows:result,columnIndices:columns};
}
