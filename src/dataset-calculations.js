import {selectedDatasetColumns,assertDatasetScalars} from './dataset-selected-columns.js';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {scratchIterator} from './scratch-iterator.js';
import {defaultColumn} from './web/dataset-schema.js';
import {numericalKey} from './web/measurement-keys.js';
import {resultContext} from './web/numeral-context.js';
import {ExactFormatError} from './web/measurement-format.js';
import {validCalculation,validCalculationProjection,validOperand,validCondition,calculateStep,calculationCondition,rationalText} from './web/dataset-calculation-model.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import messages from './web/locales/en/datasetCalculations.json' with {type:'json'};
const fail=code=>{throw new AppError(code??'DATASET_CALCULATION');};
const column=(name,representation='text',unit='')=>({...defaultColumn({label:name}),representation,unit});
const numeric=name=>column(name,'rational');
const contextKeys=['condition','operation','profile','membership','window','windowRelation','evidence'];
const contextColumns=()=>[...contextKeys.map(k=>column(messages[k+'Name'])),...['run','investigation','calibration'].flatMap(k=>[column(messages[k+'Id']),column(messages[k+'Revision'])])];
const contextValues=o=>[...contextKeys.map(k=>o[k]??''),...['run','investigation','calibration'].flatMap(k=>[o[k]?.id??'',o[k]?.revision??''])];
export class DatasetCalculations{
 constructor(materials){this.materials=materials;}
 async schema(source,view='observations',{columns:selection}={}){
  if(selection!==undefined&&!validCalculationProjection(selection))fail();
  const doc=await this.materials.read(source);if(source.kind==='dataset')return selection===undefined?this.materials.datasetColumns(doc):(await selectedDatasetColumns(this.materials,doc,selection)).columns;
  const selected=columns=>{if(selection===undefined)return columns;if(selection.some(i=>i>=columns.length))fail();return selection.map(i=>columns[i]);};
  if(source.kind!=='analysis'||!doc.content.comparison)fail();
  const units=new Set();for(const source of doc.content.comparison.sources){const column=await this.materials.datasetColumn(await this.materials.read(source.dataset),source.columns.value);units.add(column.unit);}
  if(units.size!==1)fail();const valueColumn={...numeric(messages.valueName),unit:[...units][0]};
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
 async validate(command){
  const c=command.calculation;if(!validCalculation(c)||typeof command.title!=='string'||!command.title.trim()||command.title.length>300||command.id!==undefined&&!researchId(command.id)||command.expectedRevision!==undefined&&command.expectedRevision!==null&&!revisionId(command.expectedRevision)||command.baseDataset||command.columns||command.exclusions||command.columnChanges)fail();
  await this.materials.assertOwner(command.recordId);let columns=[...await this.schema(c.source,c.view,{columns:c.projection})];
  for(const j of c.joins){const right=await this.schema(j.dataset,undefined,{columns:j.projection});if(j.keys.some(k=>k.left>=columns.length||k.right>=right.length)||j.where&&!validCondition(j.where,right.length))fail();if(j.keys.some(k=>k.semantics==='numeric'&&[columns[k.left],right[k.right]].some(c=>['text','unsupported'].includes(c.representation))))fail();columns.push(...right);}
  if(c.where&&!validCondition(c.where,columns.length))fail();
  const names=new Set(columns.map(c=>c.name));
  for(const s of c.steps){if(!validOperand(s.left,columns.length)||s.right&&!validOperand(s.right,columns.length)||s.condition&&!validCondition(s.condition,columns.length)||names.has(s.name))fail();names.add(s.name);const {representation,radix}=resultContext(s.output);columns.push({...numeric(s.name),representation,radix,unit:s.unit,quantity:{origin:'derived',conversion:null,calibration:c.calibration}});}
  if(columns.length>256)fail();if(c.calibration)await this.materials.read(c.calibration);
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
  const self=this,c=command.calculation;
  return scratchIterator(async function*(store){
   const baseSchema=await self.schema(c.source,c.view,{columns:c.projection});
   const joinSchemas=[],key=(row,cols,keys,side)=>{
    const values=keys.map(k=>{const i=k[side];return ['absent','null'].includes(row.valueKinds?.[i])||cols[i].missing.some(m=>m.value===row.cells[i])?null:k.semantics==='numeric'?numericalKey(row.cells[i],cols[i]):[row.cells[i],cols[i].representation,cols[i].radix];});
    return values.includes(null)?null:JSON.stringify(values);
   };
   for(const [index,j] of c.joins.entries()){
    const right=await self.schema(j.dataset,undefined,{columns:j.projection});joinSchemas.push(right);
    for await(const row of self.sourceRows(j.dataset,'observations',{...options,columns:j.projection})){
     if(row.excluded||j.where&&!calculationCondition(j.where,row,right))continue;
     const k=key(row,right,j.keys,'right');if(k===null)fail('DATASET_JOIN_KEY');if(!await store.add(index+':'+k,row))fail('DATASET_JOIN_DUPLICATE');
    }
   }
   yield {columns:columns.map(c=>c.name),sourceMapping:{format:'calculated',version:1}};
   let order=0;
   for await(const original of self.sourceRows(c.source,c.view,{...options,columns:c.projection})){
    options.signal?.throwIfAborted();const {id:originalId,line:originalLine,aggregation:sourceAggregation,aggregationMembers:sourceMembers,...values}=original;let row={...values,cells:[...original.cells],valueKinds:[...(original.valueKinds??original.cells.map(()=> 'string'))],cellSources:[...original.cellSources]},used=[...baseSchema];
    for(const [index,j] of c.joins.entries()){
     const k=key(row,used,j.keys,'left'),match=k===null?null:await store.get(index+':'+k),right=joinSchemas[index];
     if(!match&&!row.excluded&&j.unmatched==='error')fail('DATASET_JOIN_MISSING');
     row.cells.push(...(match?.cells??right.map(()=>'')));row.valueKinds.push(...(match?.valueKinds??right.map(()=>match?'string':'absent')));row.cellSources.push(...(match?.cellSources??right.map(()=>[])));used.push(...right);
    }
    if(!row.excluded&&c.where&&!calculationCondition(c.where,row,used))row.excluded=c.selectionReason;
    for(const step of c.steps){const value=row.excluded?{value:'',kind:'absent',sources:[]}:calculateStep(step,row,used);row.cells.push(value.value);row.valueKinds.push(value.kind);row.cellSources.push(value.sources);used.push(columns[used.length]);}
    if(row.cellSources.some(s=>s.length>32))fail();
    yield {...row,order:++order,locator:{format:'calculated',order}};
    if(order%256===0)await options.progress?.({stage:'Calculating retained rows',done:order,total:order});
   }
  },options);
 }
 async prepare(command,options={}){
  const columns=await this.validate(command),id=command.id??randomUUID(),c=command.calculation;
  try{return await this.materials.prepareDatasetRows(command,{...options,source:{doc:{id}},rows:this.rows(command,columns,options),calculatedColumns:columns,inputReferences:[c.source,...c.joins.map(j=>j.dataset),...(c.calibration?[c.calibration]:[])]});}
  catch(error){if(options.signal?.aborted)throw options.signal.reason;if(error instanceof AppError)throw error;if(error instanceof ExactFormatError)fail(error.code);fail();}
 }
 async preview(command,options={}){
  const columns=await this.validate(command),rows=[];
  try{for await(const row of this.rows(command,columns,options)){if(row.columns)continue;rows.push(row);if(rows.length===5)break;}}
  catch(error){if(options.signal?.aborted)throw options.signal.reason;if(error instanceof AppError)throw error;if(error instanceof ExactFormatError)fail(error.code);fail();}return {columns:columns.map(c=>c.name),rows};
 }
}
