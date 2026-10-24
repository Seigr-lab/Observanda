import {derivedComputation} from './web/measurement-computation.js';
import {measurementScalarPolicies} from './measurement-scalar-storage.js';
import {GraphCalculations} from './calculation-graph-evaluation.js';
import {CalculationGraphs} from './calculation-graphs.js';
import {validGraphCalculation} from './web/dataset-calculation-graph-model.js';
import {ArithmeticBudget} from './tools/exact-arithmetic.js';
import {calculateExactStep,exactCalculationCondition,exactCalculationKey,validateExactCondition,validateExactStep,validateExactComparison} from './dataset-exact-calculation.js';
import {selectedDatasetColumns,assertDatasetScalars} from './dataset-selected-columns.js';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {scratchIterator} from './scratch-iterator.js';
import {defaultColumn} from './web/dataset-schema.js';
import {numericalKey} from './web/measurement-keys.js';
import {sameUnitDefinition} from './web/measurement-unit-model.js';
import {resultContext} from './web/numeral-context.js';
import {ExactFormatError} from './web/measurement-format.js';
import {validCalculation,validCalculationProjection,validOperand,validCondition,calculateStep,calculationCondition,calculationQuantities,rationalText} from './web/dataset-calculation-model.js';
import {researchId} from './web/research-reference.js';
import {revisionId,revisionText} from './web/revision-model.js';
import messages from './web/locales/en/datasetCalculations.json' with {type:'json'};
const fail=code=>{throw new AppError(code??'DATASET_CALCULATION');};
const column=(name,representation='text',unit='')=>({...defaultColumn({label:name}),representation,unit});
const numeric=name=>column(name,'rational');
const contextKeys=['condition','operation','profile','membership','window','windowRelation','evidence'];
const contextColumns=()=>[...contextKeys.map(k=>column(messages[k+'Name'])),...['run','investigation','calibration'].flatMap(k=>[column(messages[k+'Id']),column(messages[k+'Revision'])])];
const contextValues=o=>[...contextKeys.map(k=>o[k]??''),...['run','investigation','calibration'].flatMap(k=>[o[k]?.id??'',o[k]?.revision??''])];
export class DatasetCalculations{
 constructor(materials){this.materials=materials;}
 async schema(source,view='observations',{columns:selection,version=1}={}){
  if(selection!==undefined&&!validCalculationProjection(selection))fail();
  const doc=await this.materials.read(source);if(source.kind==='dataset')return selection===undefined?this.materials.datasetColumns(doc):(await selectedDatasetColumns(this.materials,doc,selection)).columns;
  const selected=columns=>{columns=columns.map(column=>({...column,...derivedComputation(doc.content.summary)}));if(selection===undefined)return columns;if(selection.some(i=>i>=columns.length))fail();return selection.map(i=>columns[i]);};
  if(source.kind!=='analysis'||!doc.content.comparison)fail();
  const units=new Set();let computation={},unitDefinition,first=true;for(const source of doc.content.comparison.sources){const column=await this.materials.datasetColumn(await this.materials.read(source.dataset),source.columns.value);units.add(column.unit);computation={...computation,...derivedComputation(column)};if(version===3&&view!=='transitions'){const next=column.quantity?.unitDefinition;if(!first&&(!!unitDefinition!==!!next||next&&!sameUnitDefinition(unitDefinition,next)))fail();if(first)unitDefinition=next;first=false;}}
  if(units.size!==1)fail();const valueColumn={...numeric(messages.valueName),...computation,unit:[...units][0],...(unitDefinition?{quantity:{origin:'derived',conversion:null,calibration:null,unitDefinition}}:{})};
  if(view==='distribution')return selected([valueColumn,column(messages.spellingName),column(messages.categoryName),column(messages.countName,'integer'),...contextColumns()]);
  if(view==='transitions')return selected([column(messages.fromName),column(messages.toName),column(messages.countName,'integer'),...contextColumns()]);
  if(view!=='observations')fail();
  return selected([valueColumn,column(messages.spellingName),column(messages.unitName),column(messages.categoryName),column(messages.beforeName),column(messages.afterName),column(messages.exclusionName),column(messages.sequenceName),column(messages.rowName),...contextColumns()]);
 }
 async schemaPage(source,view='observations',{offset=0,limit=16}={}){
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>256)fail();
  if(source.kind==='dataset'){const {items,...page}=await this.materials.retainedSchemaPage(await this.materials.read(source),{offset,limit});return {...page,columns:items};}
  const columns=await this.schema(source,view);return {columns:columns.slice(offset,offset+limit),offset,total:columns.length,next:offset+limit<columns.length?offset+limit:null};
 }
 async legacyPolicies(c,columns){if(columns.some(measurementScalarPolicies)||[...calculationQuantities(c)].some(quantity=>measurementScalarPolicies({quantity})))fail('DATASET_SCALAR_POLICY_VERSION');}
 async recipeColumns(c){
  let columns=[...await this.schema(c.source,c.view,{columns:c.projection,version:c.version})];await this.legacyPolicies(c,columns);
  for(const j of c.joins){const right=await this.schema(j.dataset,undefined,{columns:j.projection});await this.legacyPolicies(c,right);if(j.keys.some(k=>k.left>=columns.length||k.right>=right.length)||j.where&&!validCondition(j.where,right.length,c.version))fail();if(j.keys.some(k=>k.semantics==='numeric'&&[columns[k.left],right[k.right]].some(c=>['text','unsupported'].includes(c.representation))))fail();if(c.version===3){try{validateExactCondition(j.where,right);for(const k of j.keys)if(k.semantics==='numeric')validateExactComparison({...columns[k.left],numeric:true},{...right[k.right],numeric:true});}catch{fail();}}columns.push(...right);}
  if(columns.some(column=>column.representation==='domain'))fail();
  if(c.where&&!validCondition(c.where,columns.length,c.version))fail();if(c.version===3){try{validateExactCondition(c.where,columns);}catch{fail();}}
  const names=new Set(columns.map(c=>c.name));
  for(const s of c.steps){if(!validOperand(s.left,columns.length,c.version)||s.right&&!validOperand(s.right,columns.length,c.version)||s.condition&&!validCondition(s.condition,columns.length,c.version)||names.has(s.name))fail();if(c.version===3){try{validateExactStep(s,columns);}catch{fail();}}names.add(s.name);const {representation,radix}=resultContext(s.output);columns.push({...numeric(s.name),...derivedComputation(...[s.left,s.right,s.condition?.left,s.condition?.right].filter(value=>value?.column!==undefined).map(value=>columns[value.column])),representation,radix,unit:s.unit,quantity:s.quantity??{origin:'derived',conversion:null,calibration:c.calibration}});}
  if(columns.length>256)fail();for(const ref of calculationReferences(c))await this.materials.read(ref);
  return columns;
 }
 async validate(command){
  if([4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19].includes(command.calculation?.version))return new GraphCalculations(this.materials).validate(command);
  const c=command.calculation;if(!validCalculation(c)||typeof command.title!=='string'||!command.title.trim()||command.title.length>300||command.id!==undefined&&!researchId(command.id)||command.expectedRevision!==undefined&&command.expectedRevision!==null&&!revisionId(command.expectedRevision)||command.baseDataset||command.columns||command.exclusions||command.columnChanges)fail();
  await this.materials.assertOwner(command.recordId);const columns=await this.recipeColumns(c);
  if(command.id){const head=await this.materials.current(command.id);if((head?.revision??null)!==(command.expectedRevision??null)||head&&(head.recordId!==command.recordId||head.kind!=='dataset'))fail('MATERIAL_CHANGED');}
  return columns;
 }
 async *sourceRows(ref,view,options={}){
  const m=this.materials,doc=await m.read(ref);
  if(ref.kind==='dataset'){
   for(let page=0;page<m.datasetPageCount(doc);page++){options.signal?.throwIfAborted();const data=await m.retainedDatasetPage(doc,page,{columns:options.columns});
    for(const [row,r] of data.rows.entries()){assertDatasetScalars(r);const {columnIndices,...retained}=r;yield {...retained,cellSources:r.cells.map((_,column)=>[{ref,selector:{kind:'cell',page,row,column:columnIndices?.[column]??column}}])};}
   }return;
  }
  const selected=row=>{if(options.columns===undefined)return row;const keys=['cells','valueKinds','cellSources'];return {...row,...Object.fromEntries(keys.map(k=>[k,options.columns.map(i=>row[k][i])]))};};
  if(view==='observations'){
   for await(const o of m.comparisons.items(doc,'observations',options)){
    const values=[o.exact?rationalText({numerator:BigInt(o.exact.numerator),denominator:BigInt(o.exact.denominator)}):'',o.value,o.unit,o.category,o.before,o.after,o.exclusion,o.sequence,o.id,...contextValues(o)];
    yield selected({cells:values,valueKinds:values.map((_,i)=>i===0&&!o.exact?'absent':'string'),excluded:o.exclusion||null,cellSources:values.map(()=>[o.locator,{ref,selector:{kind:'whole'}}])});
   }return;
  }
  const summary=doc.content.summary;
  for await(const v of m.comparisons.items(doc,view,options)){
   options.signal?.throwIfAborted();const group=v.groupDetails??await m.comparisons.group(summary,v.group);if(!group)fail('MATERIAL_MISSING');
   const values=[...(view==='distribution'?[v.exact?v.exact.numerator+'/'+v.exact.denominator:'',v.value,v.category,String(v.count)]:[v.from,v.to,String(v.count)]),...contextValues(group)],sources=view==='distribution'?[v.locator]:[v.before,v.after];
   yield selected({cells:values,valueKinds:values.map((_,i)=>view==='distribution'&&i===0&&!v.exact?'absent':'string'),excluded:null,cellSources:values.map(()=>[...sources,{ref,selector:{kind:'whole'}}])});
  }
 }
 rows(command,columns,options={}){
  const self=this,c=command.calculation,condition=c.version===3?exactCalculationCondition:calculationCondition,calculate=c.version===3?calculateExactStep:calculateStep;
  return scratchIterator(async function*(store){
   const baseSchema=await self.schema(c.source,c.view,{columns:c.projection,version:c.version});
   const joinSchemas=[],key=(row,cols,keys,side)=>{
    const values=keys.map(k=>{const i=k[side];return ['absent','null'].includes(row.valueKinds?.[i])||cols[i].missing.some(m=>m.value===row.cells[i])?null:k.semantics==='numeric'?(c.version===3?exactCalculationKey:numericalKey)(row.cells[i],cols[i]):[row.cells[i],cols[i].representation,cols[i].radix];});
    return values.includes(null)?null:JSON.stringify(values);
   };
   for(const [index,j] of c.joins.entries()){
    const right=await self.schema(j.dataset,undefined,{columns:j.projection});joinSchemas.push(right);
    for await(const row of self.sourceRows(j.dataset,'observations',{...options,columns:j.projection})){
     if(row.excluded||j.where&&!condition(j.where,row,right))continue;
     const k=key(row,right,j.keys,'right');if(k===null)fail('DATASET_JOIN_KEY');if(!await store.add(index+':'+k,row))fail('DATASET_JOIN_DUPLICATE');
    }
   }
   yield {columns:columns.map(c=>c.name),sourceMapping:{format:'calculated',version:c.version===3?2:1}};
   let order=0;
   for await(const original of self.sourceRows(c.source,c.view,{...options,columns:c.projection})){
    options.signal?.throwIfAborted();const {id:originalId,line:originalLine,aggregation:sourceAggregation,aggregationMembers:sourceMembers,...values}=original;let row={...values,cells:[...original.cells],valueKinds:[...(original.valueKinds??original.cells.map(()=> 'string'))],cellSources:[...original.cellSources]},used=[...baseSchema];
    for(const [index,j] of c.joins.entries()){
     const k=key(row,used,j.keys,'left'),match=k===null?null:await store.get(index+':'+k),right=joinSchemas[index];
     if(!match&&!row.excluded&&j.unmatched==='error')fail('DATASET_JOIN_MISSING');
     row.cells.push(...(match?.cells??right.map(()=>'')));row.valueKinds.push(...(match?.valueKinds??right.map(()=>match?'string':'absent')));row.cellSources.push(...(match?.cellSources??right.map(()=>[])));used.push(...right);
    }
    const budget=c.version===3?new ArithmeticBudget():undefined;
    if(!row.excluded&&c.where&&!condition(c.where,row,used,budget))row.excluded=c.selectionReason;
    for(const step of c.steps){const value=row.excluded?{value:'',kind:'absent',sources:[]}:calculate(step,row,used,budget);row.cells.push(value.value);row.valueKinds.push(value.kind);row.cellSources.push(value.sources);used.push(columns[used.length]);}
    if(row.cellSources.some(s=>s.length>32))fail();
    yield {...row,order:++order,locator:{format:'calculated',order}};
    if(order%256===0)await options.progress?.({stage:'Calculating retained rows',done:order,total:order});
   }
  },options);
 }
 async prepare(command,options={}){
  if([4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19].includes(command.calculation?.version))return new GraphCalculations(this.materials).prepare(command,options);
  const columns=await this.validate(command),id=command.id??randomUUID(),c=command.calculation;
  try{return await this.materials.prepareDatasetRows(command,{...options,source:{doc:{id}},rows:this.rows(command,columns,options),calculatedColumns:columns,inputReferences:calculationReferences(c)});}
  catch(error){if(options.signal?.aborted)throw options.signal.reason;if(error instanceof AppError)throw error;if(error instanceof ExactFormatError)fail(error.code);fail();}
 }
 async preview(command,options={}){
  if([4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19].includes(command.calculation?.version))return new GraphCalculations(this.materials).preview(command,{...options,columnOffset:command.columnOffset??0});
  const columns=await this.validate(command),rows=[];
  try{for await(const row of this.rows(command,columns,options)){if(row.columns)continue;rows.push(row);if(rows.length===5)break;}}
  catch(error){if(options.signal?.aborted)throw options.signal.reason;if(error instanceof AppError)throw error;if(error instanceof ExactFormatError)fail(error.code);fail();}return {columns:columns.map(c=>c.name),rows};
 }
}

export function calculationReferences(c){
 return [...new Map([c.source,...c.joins.map(j=>j.dataset),c.calibration,...[...calculationQuantities(c)].flatMap(q=>[q.conversion,q.calibration])].filter(Boolean).map(ref=>[revisionText(ref),ref])).values()];
}

export async function verifyRetainedCalculation(materials,doc,{signal}={}){
 signal?.throwIfAborted();
 const calculation=doc.content.calculation;if(!calculation)return;
 if([4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19].includes(calculation.version)){if(!validGraphCalculation(calculation)||doc.content.algorithm!=='observanda-retained-calculations'||doc.content.algorithmVersion!==(calculation.version-1))fail('CATALOGUE_DAMAGED');const graphs=new CalculationGraphs(materials),graph=await graphs.read(calculation.graph);if(calculation.version>=11&&graph.content.graphVersion!==calculation.version-3)fail('CATALOGUE_DAMAGED');await graphs.verify(graph,{complete:true,signal});signal?.throwIfAborted();let found=false;for await(const ref of materials.references(doc.content))if(revisionText(ref)===revisionText(calculation.graph))found=true;if(!found)fail('CATALOGUE_DAMAGED');const {verifyGraphDataset}=await import('./calculation-graph-lineage.js');await verifyGraphDataset(materials,doc,{signal});return;}
 if(!validCalculation(calculation)||doc.content.algorithm!=='observanda-retained-calculations'||doc.content.algorithmVersion!==(calculation.version===3?2:1))fail('CATALOGUE_DAMAGED');
 if(calculation.version!==3){const engine=new DatasetCalculations(materials);await engine.legacyPolicies(calculation,await engine.schema(calculation.source,calculation.view,{columns:calculation.projection,version:calculation.version}));for(const join of calculation.joins)await engine.legacyPolicies(calculation,await engine.schema(join.dataset,undefined,{columns:join.projection}));return;}
 try{const columns=await new DatasetCalculations(materials).recipeColumns(calculation);for(let index=0;index<columns.length;index++){const actual=await materials.datasetColumn(doc,index);if(revisionText(actual.computation??null)!==revisionText(columns[index].computation??null))fail('CATALOGUE_DAMAGED');}}catch{fail('CATALOGUE_DAMAGED');}
 const required=new Set(calculationReferences(calculation).map(ref=>revisionText(ref)));for await(const ref of materials.references(doc.content))required.delete(revisionText(ref));if(required.size)fail('CATALOGUE_DAMAGED');
}
