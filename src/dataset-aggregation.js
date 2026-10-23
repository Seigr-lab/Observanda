import {derivedComputation} from './web/measurement-computation.js';
import {createHash} from 'node:crypto';
import {readDatasetCell} from './dataset-cell-storage.js';
import {revisionText} from './web/revision-model.js';
import {resolveScalarOperand,resolveScalarDefinitions,measurementScalarPolicies} from './measurement-scalar-storage.js';
import {DatasetResourceBudget,numericalOperation} from './dataset-resource-budget.js';
import {isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {plotRationalText} from './web/plot-resource-policy.js';
import {divideRationalText} from './web/measurement-reduction.js';
import {assertDomainColumn,domainColumnKey} from './measurement-domain-operations.js';
import {datasetColumnCount,selectedDatasetColumns} from './dataset-selected-columns.js';
import {datasetColumnPosition,datasetCell} from './web/dataset-column-selection.js';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {scratchIterator} from './scratch-iterator.js';
import {PagedMedian} from './paged-median.js';
import {aggregationMemberContext,aggregationMemberRows} from './dataset-aggregation-members.js';
import {defaultColumn} from './web/dataset-schema.js';
import {validAggregation,aggregationKey,aggregationPresence} from './web/dataset-aggregation-model.js';
import {exactRational,isScalarRepresentation} from './web/measurement-model.js';
import {resultContext} from './web/numeral-context.js';
import {ExactFormatError,formatExactResult} from './web/measurement-format.js';
import {rationalText} from './web/dataset-calculation-model.js';
import {compareRationalText as compare,sumRationalText as sum} from './web/measurement-reduction.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {AggregationWork,aggregationWorkFile} from './dataset-aggregation-work.js';
import messages from './web/locales/en/datasetAggregation.json' with {type:'json'};
const fail=(code='DATASET_AGGREGATION')=>{throw new AppError(code);};
const rational=v=>exactRational(v,'rational');
async function* sourceRows(m,ref,signal,start=null,columns,version=1){
 const doc=await m.read(ref);
 if(start&&start.page>=m.datasetPageCount(doc))fail('MATERIAL_MISSING');
 for(let page=start?.page??0;page<m.datasetPageCount(doc);page++){
  signal?.throwIfAborted();const data=await m.retainedDatasetPage(doc,page,{columns});
  if(start&&page===start.page&&start.row>=data.rows.length)fail('MATERIAL_MISSING');
  for(let row=start&&page===start.page?start.row+1:0;row<data.rows.length;row++)yield {value:data.rows[row],page,row};
 }
}
export function domainAggregationKey(materials,row,columns,indices,semantics=[],version=1){
 for(const [k,index]of indices.entries())if(semantics[k]==='numeric'&&typeof datasetCell(row,index)!=='string')fail('DATASET_CELL_SCALAR_REQUIRED');
 if(version===1)return aggregationKey(row,columns,indices,semantics);
 return JSON.stringify(indices.map((index,k)=>{const at=datasetColumnPosition(row,index),column=columns[at],presence=aggregationPresence(row,column,index);if(semantics[k]!=='domain')return JSON.parse(aggregationKey(row,columns,[index],[semantics[k]]))[0];if(presence!=='value')return [presence,'domain'];const key=domainColumnKey(materials,{value:row.cells[at],kind:row.valueKinds?.[at]??'string'},column);if(key===null)fail('MEASUREMENT_DOMAIN_INCOMPATIBLE');return key;}));
}
// New policies keep each canonical group key bounded in retained row metadata.
// Scratch retains the exact signature too, so a hash collision cannot merge groups.
export async function aggregationSourceKey(materials,row,columns,recipe,{signal,signature=false}={}){
 if(recipe.version!==3)return domainAggregationKey(materials,row,columns,recipe.keys,recipe.keySemantics,recipe.version);
 const values=[];for(const [k,index]of recipe.keys.entries()){
  signal?.throwIfAborted();const at=datasetColumnPosition(row,index),column=columns[at],presence=aggregationPresence(row,column,index),semantics=recipe.keySemantics?.[k]??'lexical';
  if(presence!=='value'||semantics==='lexical'){values.push([presence,row.cells[at]]);continue;}
  if(semantics==='domain'){const key=domainColumnKey(materials,{value:row.cells[at],kind:row.valueKinds?.[at]??'string'},column);if(key===null)fail('MEASUREMENT_DOMAIN_INCOMPATIBLE');values.push(key);continue;}
  const budget=new DatasetResourceBudget(recipe.resourcePolicy),cell=await resolveScalarOperand(materials,{value:row.cells[at],kind:row.valueKinds?.[at]??'string'},column,{signal,budget,policy:recipe.resourcePolicy});
  values.push(numericalOperation(budget,b=>{const exact=exactRational(cell.value,column.representation,column.radix,b),[numerator,denominator]=formatExactResult(exact,{version:1,representation:'rational',radix:10},b).split('/');return ['numeric',numerator,denominator,column.unit];}));
 }
 const text=JSON.stringify(values),key='policy:'+createHash('sha256').update(text).digest('hex');return signature?{key,text}:key;
}
export class DatasetAggregation{
 constructor(materials){this.materials=materials;}
 async validate(command,options={}){
  const a=command.aggregation;
  if(!validAggregation(a)||typeof command.title!=='string'||!command.title.trim()||command.title.length>300||command.id!==undefined&&!researchId(command.id)||command.expectedRevision!==undefined&&command.expectedRevision!==null&&!revisionId(command.expectedRevision)||['calculation','baseDataset','columns','exclusions','columnChanges','sourceMapping','nativeMapping','artifact'].some(k=>command[k]!==undefined))fail();
  await this.materials.assertOwner(command.recordId);const schema=await this.schema(a,options);
  if(command.id){const current=await this.materials.current(command.id);if((current?.revision??null)!==(command.expectedRevision??null)||current&&(current.recordId!==command.recordId||current.kind!=='dataset'))fail('MATERIAL_CHANGED');}
  return schema;
 }
 async schema(a,{signal}={}){
  const doc=await this.materials.read(a.source);if(!validAggregation(a,datasetColumnCount(doc)))fail();
  const selection=await selectedDatasetColumns(this.materials,doc,[...new Set([...a.keys,...a.values.map(v=>v.column)])]),source=selection.columns,column=i=>source[selection.indices.indexOf(i)];
  if(a.version<3&&[...a.keys.filter((index,k)=>a.keySemantics?.[k]==='numeric'),...a.values.filter(value=>value.operation!=='count').map(value=>value.column)].some(index=>measurementScalarPolicies(column(index))))fail('DATASET_SCALAR_POLICY_VERSION');
  if(a.version===3)for(const index of new Set([...a.keys.filter((index,k)=>a.keySemantics?.[k]==='numeric'),...a.values.filter(value=>value.operation!=='count').map(value=>value.column)])){
   const resolved=await resolveScalarDefinitions(this.materials,column(index),{signal,budget:new DatasetResourceBudget(a.resourcePolicy)});
   if(resolved.quantity?.unitDefinition?.kind==='absolute'&&a.values.some(value=>value.column===index&&value.operation==='sum'))fail();
  }
  const columns=a.keys.map(i=>column(i)),names=new Set(columns.map(c=>c.name));
  if(a.version===1&&source.some(c=>c.representation==='domain'))fail();for(const c of source)if(c.representation==='domain')assertDomainColumn(c);
  for(const [k,index]of a.keys.entries()){const c=column(index),semantics=a.keySemantics?.[k]??'lexical';if(c.representation==='domain'&&semantics!=='domain'||semantics==='domain'&&c.representation!=='domain'||semantics==='numeric'&&!isScalarRepresentation(c))fail();}
  for(const value of a.values){
   const c=column(value.column);if(names.has(value.name)||value.operation!=='count'&&!isScalarRepresentation(c))fail();names.add(value.name);
   const {representation,radix}=resultContext(value.output,value.operation);
   columns.push({...defaultColumn({label:value.name}),...derivedComputation(c,...a.keys.map(index=>column(index))),representation,radix,unit:value.operation==='count'?'':c.unit,quantity:{origin:'derived',conversion:null,calibration:c.quantity?.calibration??null,...(a.version===3&&value.operation!=='count'&&c.quantity?.unitDefinition?{unitDefinition:c.quantity.unitDefinition}:{})},...(a.version===3?{resourcePolicy:structuredClone(a.resourcePolicy)}:{})});
  }
  return {columns,source,indices:selection.indices};
 }
 rows(command,schema,options={}){
  const m=this.materials,a=command.aggregation,operate=fn=>a.version===3?numericalOperation(new DatasetResourceBudget(a.resourcePolicy),fn):fn(undefined),compareValues=(x,y)=>operate(b=>compare(x,y,b)),sumValues=(x,y,d=1n)=>operate(b=>sum(x,y,d,b));
  const calculate=async function*(work){
   let groups=work.saved?.groups??0,order=work.saved?.order??0,last=work.saved?.last??null,phase=work.saved?.phase??'input';
   const median=new PagedMedian({signal:options.signal,progress:options.progress,blockSize:128,compareValues,midpoint:(x,y)=>sumValues(x,y,2n),state:{read:name=>work.get('median-state:'+name),write:(name,value)=>work.put('median-state:'+name,value)},read:name=>work.get('median:'+name),write:(name,value)=>work.put('median:'+name,value),remove:names=>work.removeMany(names.map(name=>'median:'+name))});
   if(work.saved)median.restore(work.saved.median);
   const checkpoint=async(next,extra={})=>{
    if(work.save){await median.flush(true);await work.save({groups,order,last,phase:next,median:median.checkpoint(),...extra});}
    phase=next;
   };
   if(work.saved&&phase==='input')await options.progress?.({stage:messages.groupingStage,done:order,total:options.total});
   if(phase==='input')for await(const {value:row,page, row:sourceRow}of sourceRows(m,a.source,options.signal,last,schema.indices,a.version)){
    options.signal?.throwIfAborted();const identity=await aggregationSourceKey(m,row,schema.source,a,{signal:options.signal,signature:true}),key=a.version===3?identity.key:identity;
    let index=await work.get('key:'+key),group;
    if(index===undefined){if(!Number.isSafeInteger((groups+1)*a.values.length))fail('DATASET_AGGREGATION_LIMIT');index=groups++;await work.put('key:'+key,index);group={key,cells:a.keys.map(i=>datasetCell(row,i)),valueKinds:a.keys.map(i=>row.valueKinds?.[datasetColumnPosition(row,i)]??'string'),values:a.values.map(()=>({included:0,excluded:0,missing:0,total:0,value:null}))};}
    else group=await work.get('group:'+index);
    if(a.version===3){if(group.keySignature!==undefined&&group.keySignature!==identity.text)fail('MATERIAL_MISSING');group.keySignature=identity.text;}
    if(options.retainMembers){
     group.members??={count:0,buffer:[]};group.members.buffer.push({page,row:sourceRow});group.members.count++;
     if(group.members.buffer.length===64){await work.put('members:'+index+':'+(group.members.count/64-1),group.members.buffer);group.members.buffer=[];}
    }
    for(const [i,s]of a.values.entries()){
     const state=group.values[i];state.total++;
     if(row.excluded){state.excluded++;continue;}
     if(aggregationPresence(row,schema.source[schema.indices.indexOf(s.column)],s.column)!=='value'){state.missing++;if(a.missing==='error')fail('DATASET_AGGREGATION_MISSING');continue;}
     state.included++;if(s.operation==='count')continue;
     const column=schema.source[schema.indices.indexOf(s.column)];let value;if(a.version===3){const budget=new DatasetResourceBudget(a.resourcePolicy),at=datasetColumnPosition(row,s.column),cell=await resolveScalarOperand(m,{value:row.cells[at],kind:row.valueKinds?.[at]??'string'},column,{signal:options.signal,budget,policy:a.resourcePolicy});value=numericalOperation(budget,b=>plotRationalText(exactRational(cell.value,column.representation,column.radix,b),b));}else{if(typeof datasetCell(row,s.column)!=='string')fail('DATASET_CELL_SCALAR_REQUIRED');value=rationalText(exactRational(datasetCell(row,s.column),column.representation,column.radix));}
     if(s.operation==='median'){median.add(index*a.values.length+i,value);await median.flush();}
     else if(state.value===null)state.value=value;
     else if(['mean','sum'].includes(s.operation))state.value=sumValues(state.value,value);
     else if(s.operation==='min'?compareValues(value,state.value)<0:compareValues(value,state.value)>0)state.value=value;
    }
    await work.put('group:'+index,group);order++;last={page,row:sourceRow};
    if(order%128===0){await checkpoint('input');await options.progress?.({stage:messages.groupingStage,done:order,total:options.total??order});}
   }
   if(options.total!==undefined&&order!==options.total)fail('MATERIAL_MISSING');
   if(phase==='input')await checkpoint('median');
   if(phase==='median'){await median.finish();await checkpoint('members');}
   let aggregationMembersIndex=work.saved?.aggregationMembersIndex;
   if(options.retainMembers&&!aggregationMembersIndex){
    async function* members(){
     for(let index=0;index<groups;index++){
      options.signal?.throwIfAborted();const {members}=await work.get('group:'+index);
      for(let page=0;page<Math.floor(members.count/64);page++){options.signal?.throwIfAborted();yield* await work.get('members:'+index+':'+page);}
      yield* members.buffer;
     }
    }
    aggregationMembersIndex=await options.retainMembers(members());
   }
   if(phase!=='rows')await checkpoint('rows',aggregationMembersIndex?{aggregationMembersIndex}:{});
   yield {columns:schema.columns.map(c=>c.name),sourceMapping:{format:'aggregated',version:1},...(aggregationMembersIndex?{aggregationMembersIndex}:{})};
   let memberOffset=0;
   for(let index=0;index<groups;index++){
    options.signal?.throwIfAborted();const group=await work.get('group:'+index),counts=[];
    for(const [i,s]of a.values.entries()){
     const state=group.values[i];let value=state.value;
     if(s.operation==='count')value=String(state.included);
     else if(state.included&&s.operation==='median')value=await median.value(index*a.values.length+i);
     else if(state.included&&s.operation==='mean'){value=a.version===3?operate(b=>divideRationalText(value,state.included,b)):(()=>{const r=rational(value);return rationalText({...r,denominator:r.denominator*BigInt(state.included)});})();}
     if(value!==null&&s.output)value=operate(b=>formatExactResult(exactRational(value,s.operation==='count'?'integer':'rational',10,b),s.output,b));
     if(a.version===3&&value!==null&&value.length>a.resourcePolicy.resources.maxScalarCharacters)fail('DATASET_CALCULATION_RESOURCE');
     group.cells.push(value??'');group.valueKinds.push(value===null?'absent':'string');const {value:unused,...count}=state;counts.push(count);
    }
    let aggregationMembers;
    if(options.retainMembers){aggregationMembers={offset:memberOffset,count:group.members.count};memberOffset+=group.members.count;}
    yield {cells:group.cells,valueKinds:group.valueKinds,aggregation:counts,...(aggregationMembers?{aggregationMembers}:{}),excluded:null,order:index+1,locator:{format:'aggregated',order:index+1,key:group.key}};
    if((index+1)%128===0||index+1===groups)await options.progress?.({stage:messages.retainingGroupsStage,done:index+1,total:groups});
   }
  };
  return options.work?calculate(options.work):scratchIterator(calculate,options);
 }
 async prepare(command,options={}){
  const schema=await this.validate(command,options),id=command.id??options.jobId??randomUUID();
  const total=(await this.materials.read(command.aggregation.source)).content.rowCount;
  const work=options.jobId?await new AggregationWork(this.materials,command,options).open(total):null;
  if(work?.saved?.phase==='rows'){
   const members=this.materials.sequences.validate(work.saved.aggregationMembersIndex);
   if(members.kind!=='aggregation-members'||members.count!==total)fail('MATERIAL_MISSING');
  }
  const retainMembers=async rows=>{
   const sequence=this.materials.sequences.builder('aggregation-members',options.writePage??(write=>this.materials.workspace.withLock(write)));
   for await(const row of rows){options.signal?.throwIfAborted();await sequence.append(row);if(sequence.count%256===0||sequence.count===total)await options.progress?.({stage:messages.retainingMembersStage,done:sequence.count,total});}return sequence.finish();
  };
  try{
   const result=await this.materials.prepareDatasetRows(command,{...options,source:{doc:{id}},rows:this.rows(command,schema,{...options,work,total,retainMembers}),calculatedColumns:schema.columns,inputReferences:[command.aggregation.source]});
   return {...result,...(work?{aggregationWorkId:options.jobId}:{})};
  }
  catch(e){if(options.signal?.aborted)throw options.signal.reason;if(e instanceof AppError||isScalarResourceFailure(e))throw e;if(e instanceof ExactFormatError)fail(e.code);fail();}
 }
 async preview(command,options={}){
  const schema=await this.validate(command,options),rows=[];
  try{for await(const row of this.rows(command,schema,options)){if(row.columns)continue;rows.push(command.aggregation.version===3?{...row,cells:row.cells.map(value=>typeof value==='string'&&value.length>4096?{format:'scalar-preview',text:value.slice(0,4096),complete:false}:value)}:row);if(rows.length===5)break;}}
  catch(e){if(options.signal?.aborted)throw options.signal.reason;if(e instanceof AppError||isScalarResourceFailure(e))throw e;if(e instanceof ExactFormatError)fail(e.code);fail();}return {columns:schema.columns.map(c=>c.name),rows};
 }
}
export async function clearAggregationWork(workspace,id){
 try{await workspace.removeMetadata(aggregationWorkFile(id));}catch(error){if(error.code!=='ENOENT')throw error;}
}

// Membership is reconstructed from the immutable source revision and retained
// group keys, not today's data. Paging never truncates a group's provenance.
export async function inspectAggregation(materials,cell,selector,{offset=0,signal}={}){
 const a=cell.doc.content.aggregation,doc=await materials.read(a.source);if(!validAggregation(a,datasetColumnCount(doc)))fail('MATERIAL_MISSING');
 const selection=await selectedDatasetColumns(materials,doc,[...new Set([...a.keys,...a.values.map(v=>v.column)])]),source=selection.columns;
 const key=cell.row.locator?.key,metric=selector.column-a.keys.length,column=metric<0?a.keys[selector.column]:a.values[metric]?.column;
 if(typeof key!=='string')fail('MATERIAL_MISSING');
 if(column===undefined)fail();let matched=0;const members=[],limit=16;
 if(cell.row.aggregationMembers){
  const context=await aggregationMemberContext(materials,cell.doc);
  for await(const item of aggregationMemberRows(materials,context,cell.row,{offset,limit,signal})){
   const row=item.value,presence=aggregationPresence(row,source[selection.indices.indexOf(column)],column);
   members.push({source:{ref:a.source,selector:{kind:'cell',page:item.page,row:item.row,column}},value:datasetCell(row,column),presence,status:row.excluded?'excluded':presence!=='value'?'missing':'included',reason:row.excluded??null});
  }
  return {source:a.source,operation:metric<0?'key':a.values[metric].operation,note:a.note,counts:metric<0?null:cell.row.aggregation?.[metric],members,offset,previous:offset?Math.max(0,offset-limit):null,next:offset+members.length<cell.row.aggregationMembers.count?offset+members.length:null};
 }
 for await(const item of sourceRows(materials,a.source,signal,null,selection.indices,a.version)){
  signal?.throwIfAborted();if(await aggregationSourceKey(materials,item.value,source,a,{signal})!==key)continue;
  if(matched++<offset)continue;if(members.length===limit)break;
  const row=item.value,presence=aggregationPresence(row,source[selection.indices.indexOf(column)],column);
  members.push({source:{ref:a.source,selector:{kind:'cell',page:item.page,row:item.row,column}},value:datasetCell(row,column),presence,status:row.excluded?'excluded':presence!=='value'?'missing':'included',reason:row.excluded??null});
 }
 return {source:a.source,operation:metric<0?'key':a.values[metric].operation,note:a.note,counts:metric<0?null:cell.row.aggregation?.[metric],members,offset,previous:offset?Math.max(0,offset-limit):null,next:matched>offset+members.length?offset+members.length:null};
}

// Policy-bearing revisions replay from their pinned source with scratch-only state.
// The comparison streams long cells; neither a preview nor today's source is proof.
export async function verifyAggregationPolicy(materials,doc,{signal}={}){
 const aggregation=doc.content.aggregation;if(aggregation?.version!==3)return;
 if(doc.content.algorithm!=='observanda-retained-aggregation'||doc.content.algorithmVersion!==1||!doc.content.aggregationMembersIndex)fail('MATERIAL_MISSING');
 const engine=new DatasetAggregation(materials),schema=await engine.schema(aggregation,{signal});let source=false;
 for await(const ref of materials.references(doc.content))if(revisionText(ref)===revisionText(aggregation.source))source=true;
 if(!source||datasetColumnCount(doc)!==schema.columns.length)fail('MATERIAL_MISSING');
 for(let index=0;index<schema.columns.length;index++){const actual=await materials.datasetColumn(doc,index);if(revisionText(actual.computation??null)!==revisionText(schema.columns[index].computation??null))fail('MATERIAL_MISSING');}
 const iterator=engine.rows({aggregation},schema,{signal})[Symbol.asyncIterator]();
 try{
  const header=await iterator.next();if(header.done||header.value.columns.length!==schema.columns.length)fail('MATERIAL_MISSING');let count=0;
  for(let page=0;page<materials.datasetPageCount(doc);page++)for(const actual of (await materials.retainedDatasetPage(doc,page,{columns:schema.columns.map((_,i)=>i)})).rows){
   signal?.throwIfAborted();const next=await iterator.next();if(next.done)fail('MATERIAL_MISSING');const expected=next.value;
   if(actual.locator?.key!==expected.locator.key||actual.order!==expected.order||revisionText(actual.aggregation)!==revisionText(expected.aggregation)||actual.cells.length!==expected.cells.length||revisionText(actual.valueKinds)!==revisionText(expected.valueKinds))fail('MATERIAL_MISSING');
   for(let index=0;index<actual.cells.length;index++)for(let offset=0;offset!==null;){
    signal?.throwIfAborted();const a=await readDatasetCell(materials,actual.cells[index],{offset,limit:4096,signal}),b=await readDatasetCell(materials,expected.cells[index],{offset,limit:4096,signal});
    if(a.total!==b.total||a.text!==b.text||a.next!==b.next)fail('MATERIAL_MISSING');offset=a.next;
   }
   count++;
  }
  if(count!==doc.content.rowCount||!(await iterator.next()).done)fail('MATERIAL_MISSING');
 }catch(error){if(error instanceof AppError||isScalarResourceFailure(error)||error.name==='AbortError')throw error;fail('MATERIAL_MISSING');}finally{await iterator.return?.();}
}
