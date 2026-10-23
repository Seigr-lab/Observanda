import {comparisonColumns,comparisonBudget,comparisonOperation} from './analysis-scalar-policy.js';
import {verifyPolicyExpected} from './analysis-policy-expected.js';
import {datasetColumnCount,selectedDatasetColumns,assertDatasetScalars} from './dataset-selected-columns.js';
import {datasetColumnPosition,datasetCell} from './web/dataset-column-selection.js';
import {materialReference,materialReferenceKey} from './web/material-reference.js';
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {revisionText} from './web/revision-model.js';
import {validAnalysisMethod,validComparison,analysisMethodReferences,analysisSourceReferences,analysisIdentity,ANALYSIS_CATEGORIES,analysisTextValue,analysisRational,rationalCompare,sameAnalysisUnitDeclaration} from './web/analysis-model.js';
import {analysisObservation,analysisObservations,analysisSelectedColumns} from './analysis-observations.js';
import messages from './web/locales/en/analyses.json' with {type:'json'};
import {ComparisonIndex} from './analysis-comparison-index.js';
import {calculateComparison} from './analysis-comparison-calculation.js';
import {verifyComparisonIntegrity} from './analysis-comparison-integrity.js';
import {comparisonSourceIdentities} from './analysis-comparison-identities.js';
import {MaterialSequence} from './material-sequence.js';
import {withScratch} from './scratch-work.js';
import {researchId} from './web/research-reference.js';
import {CatalogueReadCache} from './catalogue-read-cache.js';
const fail=code=>{throw new AppError(code??'ANALYSIS_INVALID');};
const counts=()=>Object.fromEntries(ANALYSIS_CATEGORIES.map(k=>[k,0]));
const ref=materialReference;
const key=o=>JSON.stringify([analysisIdentity(o.investigation),analysisIdentity(o.run),o.condition,o.operation,o.profile,analysisIdentity(o.calibration),o.unit,o.membership,o.window,o.windowRelation,o.evidence]);
const pick=o=>Object.fromEntries(['investigation','run','condition','operation','profile','calibration','unit','membership','window','windowRelation','evidence'].map(k=>[k,o[k]]));
export class AnalysisComparisons{
 constructor(materials,{inputs=materials}={}){this.materials=materials;this.inputs=inputs;}
 async verifyInputs(){if(this.inputs!==this.materials)await this.inputs.verify();}
 async snapshot(operation){
  const workspace=this.materials.workspace;if(await workspace.storageKind()!=='catalogue')return operation();
  return workspace.catalogue(async store=>{
   if(store.readCache)return operation();
   const cache=new CatalogueReadCache({maxRows:16384,maxBytes:16*1024*1024});store.readCache=cache;
   try{return await operation();}finally{cache.clear();store.readCache=null;}
  });
 }
 references(method,comparison){return [...new Map([...analysisMethodReferences(method),...comparison.sources.flatMap(analysisSourceReferences),...(comparison.expected?[comparison.expected.dataset]:[])].map(r=>[materialReferenceKey(r),ref(r)])).values()];}
 async validateOutput(command,{retained=false}={}){
  if(!analysisTextValue(command.title,300,true)||!analysisTextValue(command.tool,200,true)||!analysisTextValue(command.version,200,true)||!validAnalysisMethod(command.method)||!validComparison(command.comparison))fail();
  if(command.comparison.version>=2&&!this.references(command.method,command.comparison).every(r=>researchId(r.workspaceId)))fail();
  if(!retained)await this.materials.assertOwner(command.recordId);
  if(command.id){const head=await this.materials.current(command.id);if((head?.revision??null)!==(command.expectedRevision??null)||head&&(head.recordId!==command.recordId||head.kind!=='analysis'))fail('MATERIAL_CHANGED');}
 }
 async validate(command,options={}){
  await this.validateOutput(command,options);
  const addressed=command.comparison.version>=2,resolved=new Map(),namespace=addressed&&this.inputs===this.materials?(await this.materials.workspace.outline()).metadata.id:null;
  for(const r of this.references(command.method,command.comparison)){const doc=await this.inputs.read(r);if(addressed)resolved.set(materialReferenceKey(r),this.inputs===this.materials?{...r,workspaceId:namespace}:this.inputs.reference(doc));}
  const identities=addressed?comparisonSourceIdentities(command.comparison,r=>resolved.get(materialReferenceKey(r))):null;
  const expected=command.comparison.expected,values=[],labels=new Map();
  const sameUnits=(a,b)=>{const budget=comparisonBudget(command.comparison);return comparisonOperation(budget,()=>{if(!sameAnalysisUnitDeclaration(a,b,budget))fail('ANALYSIS_MAPPING');});};

  for(const [index,s] of command.comparison.sources.entries()){
   const doc=await this.inputs.read(s.dataset),count=datasetColumnCount(doc);
   if(Object.values(s.columns).some(i=>i!==null&&i>=count))fail();
   if(expected?.source===index&&expected.actualKey>=count)fail();
   const selected=await comparisonColumns(this.inputs,doc,[...new Set([...analysisSelectedColumns(s),...(expected?.source===index?[expected.actualKey]:[])])],command.comparison,options),value=selected.columns[selected.indices.indexOf(s.columns.value)];values.push(value);
   if(command.comparison.version===3){
    if(labels.has(value.unit))sameUnits(labels.get(value.unit),value);else labels.set(value.unit,value);
    for(const key of ['lower','upper'])if(s.columns[key]!==null){const bound=selected.columns[selected.indices.indexOf(s.columns[key])];if(bound.unit!==value.unit)fail('ANALYSIS_MAPPING');sameUnits(value,bound);}
   }
  }
  if(expected){const doc=await this.inputs.read(expected.dataset),count=datasetColumnCount(doc);if(expected.value>=count||expected.key>=count)fail();const selected=await comparisonColumns(this.inputs,doc,[...new Set([expected.key,expected.value])],command.comparison,options);if(command.comparison.version===3)sameUnits(values[expected.source],selected.columns[selected.indices.indexOf(expected.value)]);}
  await this.verifyInputs();return identities;
 }
 async prepare(command,options={}){
  const sourceIdentities=await this.validate(command,options);options.signal?.throwIfAborted();
  if(options.retained)return this.snapshot(()=>withScratch(async scratch=>{
   const temporary={readMetadata:async name=>(await scratch.get(name))?.text??null,writeMetadata:(name,text)=>scratch.put(name,{text})};
   return calculateComparison(this,command,{...options,sourceIdentities,sequences:new MaterialSequence(temporary),checkpoint:false,writePage:fn=>fn()});
  },{signal:options.signal}));
  return calculateComparison(this,command,{...options,sourceIdentities});
 }
 async prepareLegacy(command,{signal,progress=async()=>{},retained=false}={}){
  if(command.comparison?.version!==1)fail();
  await this.validate(command,{retained});const {comparison,method}=command,groups=new Map(),distribution=new Map(),transitions=new Map(),previous=new Map(),runs=new Set();let rows=0;
  const summary={version:1,algorithm:'observanda-exception-comparison',algorithmVersion:'1',ordering:comparison.ordering,rows:0,raw:counts(),aggregate:counts(),runs:0,unknownRunRows:0,groups:[],distribution:[],transitions:[],verification:null};
  let total=0;for(const s of comparison.sources)total+=(await this.inputs.read(s.dataset)).content.rowCount;
  for await(const o of analysisObservations(this.inputs,comparison,{signal})){
   rows++;for(const k of ['condition','operation','profile','window'])if(o[k].length>300)fail('ANALYSIS_LIMIT');
   if(o.run)runs.add(o.run.id);else summary.unknownRunRows++;
   summary[o.evidence][o.category]++;const k=key(o);
   if(!groups.has(k)){if(groups.size>=2048)fail('ANALYSIS_LIMIT');groups.set(k,{...pick(o),rows:0,categories:counts(),boundaries:{unknown:0,below:0,above:0,'on-boundary':0,inside:0},assessed:0,successful:0});}
   const g=groups.get(k);g.rows++;g.categories[o.category]++;g.boundaries[o.boundary]++;
   if(o.evidence==='raw'&&['correct','mismatched'].includes(o.category)){g.assessed++;if(o.category==='correct')g.successful++;}
   if(o.available){const value=o.exact?o.exact.numerator+'/'+o.exact.denominator:o.value;if(value.length>8192)fail('ANALYSIS_LIMIT');const d=JSON.stringify([k,value,o.category]);if(!distribution.has(d)){if(distribution.size>=4096)fail('ANALYSIS_LIMIT');distribution.set(d,{group:k,value:o.value,exact:o.exact,category:o.category,count:0,locator:o.locator});}distribution.get(d).count++;}
   if(comparison.ordering==='source'){
    // Each declared source/window/run/profile is its own sequence. Missing,
    // unresolved and excluded observations remain states, never skipped gaps.
    const stream=JSON.stringify([o.source,k]),before=previous.get(stream);
    if(before){const t=JSON.stringify([stream,before.category,o.category]);if(!transitions.has(t)){if(transitions.size>=4096)fail('ANALYSIS_LIMIT');transitions.set(t,{source:o.source,group:k,from:before.category,to:o.category,count:0,before:before.locator,after:o.locator});}transitions.get(t).count++;}
    previous.set(stream,{category:o.category,locator:o.locator});
   }
   if(rows%256===0)await progress({stage:messages.comparingStage,done:rows,total});
  }
  signal?.throwIfAborted();summary.rows=rows;summary.runs=runs.size;summary.groups=[...groups].map(([key,value])=>({key,...value}));summary.distribution=[...distribution.values()];summary.transitions=[...transitions.values()];
  if(comparison.expected)summary.verification=await this.verifyExpected(comparison,{signal});
  await progress({stage:messages.retainingStage,done:rows,total});
  const content={inputs:this.references(method,comparison),tool:command.tool,version:command.version,parameters:'',method,comparison,summary};
  if(Buffer.byteLength(JSON.stringify(content))>12*1024*1024)fail('ANALYSIS_LIMIT');
  return {commandHash:digest(revisionText(command)),content};
 }
 async verifyExpected(comparison,{signal}={}){
  if(comparison.version===3)return verifyPolicyExpected(this.inputs,comparison,{signal});
  const e=comparison.expected,s=comparison.sources[e.source],actualDoc=await this.inputs.read(s.dataset),expectedDoc=await this.inputs.read(e.dataset),actual=await selectedDatasetColumns(this.inputs,actualDoc,[...new Set([...analysisSelectedColumns(s),e.actualKey])]),expected=await selectedDatasetColumns(this.inputs,expectedDoc,[...new Set([e.key,e.value])]),ac=actual.columns,ec=expected.columns;
  const av=ac[actual.indices.indexOf(s.columns.value)],ev=ec[expected.indices.indexOf(e.value)];
  const ai=this.inputs.iterateDataset(s.dataset,{columns:actual.indices})[Symbol.asyncIterator](),ei=this.inputs.iterateDataset(e.dataset,{columns:expected.indices})[Symbol.asyncIterator](),out={algorithm:'ordered-exact-fixture-comparison',version:'1',correct:0,mismatched:0,unavailable:0,excluded:0,unmatched:0,rows:0,examples:[],expected:e.dataset,rationale:e.rationale};
  const available=(r,i,c)=>!['null','absent'].includes(r.valueKinds?.[datasetColumnPosition(r,i)])&&!c.missing.some(m=>m.value===datasetCell(r,i));
  try{for(;;){signal?.throwIfAborted();const [a,b]=await Promise.all([ai.next(),ei.next()]);if(a.done&&b.done)break;if(!a.done)assertDatasetScalars(a.value);if(!b.done)assertDatasetScalars(b.value);out.rows++;let state;
   if(a.done||b.done||datasetCell(a.value,e.actualKey)!==datasetCell(b.value,e.key))state='unmatched';
   else if(analysisObservation(a.value,ac,s,e.source,0,0).category==='excluded'||b.value.excluded)state='excluded';
   else if(!available(a.value,s.columns.value,av)||!available(b.value,e.value,ev))state='unavailable';
   else{const x=datasetCell(a.value,s.columns.value),y=datasetCell(b.value,e.value),ar=analysisRational(x,av),br=analysisRational(y,ev);state=av.unit===ev.unit&&(ar&&br?rationalCompare(ar,br)===0:!ar&&!br&&x===y)?'correct':'mismatched';}
   out[state]++;if(state!=='correct'&&out.examples.length<20)out.examples.push({order:out.rows,state,actual:a.done?null:a.value.id,expected:b.done?null:b.value.id});
  }}finally{await ai.return?.();await ei.return?.();}return out;
 }
 async commit(command,prepared){
  if(prepared.commandHash!==digest(revisionText(command)))fail('MATERIAL_CHANGED');
  await this.verifyInputs();await this.validateOutput(command);
  // Foreign manifests were authenticated during prepare; committing only checks
  // access and the result owner, never opens a source read inside this writer.
  if(this.inputs===this.materials)await this.validate(command);
  await this.verifyInputs();const result=await this.materials.commit({kind:'analysis',recordId:command.recordId,title:command.title,id:command.id,expectedRevision:command.expectedRevision,content:prepared.content});
  if(prepared.workId){if(!researchId(prepared.workId))fail('INVALID');await this.materials.workspace.removeMetadata('.observanda/materials/comparison-work/'+prepared.workId+'.json');}
  await this.verifyInputs();return result;
 }
 async save(command,options={}){const prepared=await this.prepare(command,options);return this.materials.workspace.withLock(()=>this.commit(command,prepared));}
 index(summary){if(summary.version!==2||summary.index?.version!==1)fail('MATERIAL_MISSING');return new ComparisonIndex(this.materials.sequences,summary.index.root);}
 async verifyIntegrity(doc,options={}){return this.snapshot(()=>verifyComparisonIntegrity(this,doc,options));}
 async verify(command,summary){
  if(summary.algorithm!=='observanda-exception-comparison'||(summary.version===1?summary.algorithmVersion!=='1'||command.comparison?.version!==1:summary.version!==2||summary.algorithmVersion!==(command.comparison?.version===3?'4':command.comparison?.version===2?'3':'2')))fail('CATALOGUE_DAMAGED');
  return this.snapshot(async()=>{
  const prepared=await (summary.version===1?this.prepareLegacy(command,{retained:true}):this.prepare(command,{retained:true}));
  if(revisionText(prepared.content.summary)!==revisionText(summary))fail('CATALOGUE_DAMAGED');
  if(summary.version===2)await this.index(summary).verify();
  });
 }
 async group(summary,id){return summary.version===2?(await this.index(summary).get('groups',id))?.value:summary.groups.find(g=>g.key===id);}
 async *items(doc,view,options={}){
  const summary=doc.content.summary;
  if(summary.version===2){
   const index=this.index(summary);let offset=0;
   for(;;){
    const page=await this.snapshot(async()=>{
     const page=await index.page(view,{offset,limit:32,signal:options.signal});
     if(['distribution','transitions'].includes(view))for(const item of page.items){const group=await index.get('groups',item.group);if(!group)fail('MATERIAL_MISSING');item.groupDetails=group.value;}
     return page;
    });
    yield* page.items;if(page.next===null)return;offset=page.next;
   }
  }
  if(view==='observations')yield* analysisObservations(this.inputs,doc.content.comparison,options);
  else yield* summary[view];
 }
 async page(command,options={}){return this.snapshot(()=>this.pageSnapshot(command,options));}
 async pageSnapshot({ref:reference,offset=0,limit=20,category='',group='',view='all',backward=false},{signal}={}){
  if(reference?.kind!=='analysis'||!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>50||typeof backward!=='boolean'||!['groups','distribution','transitions','all','exceptions','boundary','timeline'].includes(view)||category&&!ANALYSIS_CATEGORIES.includes(category)||!analysisTextValue(group,6000))fail();
  const doc=await this.materials.read(reference),c=doc.content;if(!c.comparison||!validComparison(c.comparison))fail();
  if(c.summary.version===2||['groups','distribution','transitions'].includes(view)){
   const table=['groups','distribution','transitions'].includes(view)?view:'observations';let result;
   if(c.summary.version===2)result=await this.index(c.summary).page(table,{offset,limit,view:table==='groups'?'':view==='timeline'?'all':view,category,group,backward,signal});
   else{if(backward)offset=Math.max(0,offset-limit);const rows=c.summary[view].filter(r=>(!group||view==='groups'||r.group===group)&&(!category||view==='groups'||r.category===category||r.from===category||r.to===category));result={items:rows.slice(offset,offset+limit),offset,total:rows.length,next:offset+limit<rows.length?offset+limit:null};}
   if(['distribution','transitions'].includes(view))result.items=await Promise.all(result.items.map(async item=>{const groupDetails=await this.group(c.summary,item.group);if(!groupDetails)fail('MATERIAL_MISSING');return {...item,groupDetails};}));
   if(group){result.groupDetails=await this.group(c.summary,group);if(!result.groupDetails)fail('INVALID');}
   return result;
  }
  if(backward)offset=Math.max(0,offset-limit);
  const items=[];let matched=0,next=null,bytes=0;
  for await(const o of analysisObservations(this.inputs,c.comparison,{signal})){
   if(category&&o.category!==category||group&&key(o)!==group||view==='exceptions'&&o.category==='correct'||view==='boundary'&&o.boundary==='unknown')continue;
   if(matched++<offset)continue;if(items.length===limit){next=offset+items.length;break;}
   bytes+=Buffer.byteLength(JSON.stringify(o));if(bytes>1024*1024)fail('ANALYSIS_LIMIT');items.push(o);
  }
  return {items,offset,next,...(group?{groupDetails:await this.group(c.summary,group)}:{})};
 }
}
