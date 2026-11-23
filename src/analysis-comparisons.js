import {comparisonColumns,comparisonBudget,comparisonOperation} from './analysis-scalar-policy.js';
import {verifyPolicyExpected} from './analysis-policy-expected.js';
import {datasetColumnCount} from './dataset-selected-columns.js';
import {materialReference,materialReferenceKey} from './web/material-reference.js';
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {revisionText} from './web/revision-model.js';
import {validAnalysisMethod,validComparison,analysisMethodReferences,analysisSourceReferences,ANALYSIS_CATEGORIES,analysisTextValue,sameAnalysisUnitDeclaration} from './web/analysis-model.js';
import {analysisSelectedColumns} from './analysis-observations.js';
import {ComparisonIndex} from './analysis-comparison-index.js';
import {calculateComparison} from './analysis-comparison-calculation.js';
import {verifyComparisonIntegrity} from './analysis-comparison-integrity.js';
import {comparisonSourceIdentities} from './analysis-comparison-identities.js';
import {MaterialSequence} from './material-sequence.js';
import {withScratch} from './scratch-work.js';
import {researchId} from './web/research-reference.js';
import {CatalogueReadCache} from './catalogue-read-cache.js';
const fail=code=>{throw new AppError(code??'ANALYSIS_INVALID');};
const ref=materialReference;
export class AnalysisComparisons{
 constructor(materials,{inputs=materials}={}){this.materials=materials;this.inputs=inputs;}
 async verifyInputs(){if(this.inputs!==this.materials)await this.inputs.verify();}
 async snapshot(operation){
  const workspace=this.materials.workspace;
  return workspace.catalogue(async store=>{
   if(store.readCache)return operation();
   const cache=new CatalogueReadCache({maxRows:16384,maxBytes:16*1024*1024});store.readCache=cache;
   try{return await operation();}finally{cache.clear();store.readCache=null;}
  });
 }
 references(method,comparison){return [...new Map([...analysisMethodReferences(method),...comparison.sources.flatMap(analysisSourceReferences),...(comparison.expected?[comparison.expected.dataset]:[])].map(r=>[materialReferenceKey(r),ref(r)])).values()];}
 async validateOutput(command,{retained=false}={}){
  if(!analysisTextValue(command.title,300,true)||!analysisTextValue(command.tool,200,true)||!analysisTextValue(command.version,200,true)||!validAnalysisMethod(command.method)||!validComparison(command.comparison))fail();
  if(!this.references(command.method,command.comparison).every(r=>researchId(r.workspaceId)))fail();
  if(!retained)await this.materials.assertOwner(command.recordId);
  if(command.id){const head=await this.materials.current(command.id);if((head?.revision??null)!==(command.expectedRevision??null)||head&&(head.recordId!==command.recordId||head.kind!=='analysis'))fail('MATERIAL_CHANGED');}
 }
 async validate(command,options={}){
  await this.validateOutput(command,options);
  const resolved=new Map(),namespace=this.inputs===this.materials?(await this.materials.workspace.outline()).metadata.id:null;
  for(const r of this.references(command.method,command.comparison)){const doc=await this.inputs.read(r);resolved.set(materialReferenceKey(r),this.inputs===this.materials?{...r,workspaceId:namespace}:this.inputs.reference(doc));}
  const identities=comparisonSourceIdentities(command.comparison,r=>resolved.get(materialReferenceKey(r)));
  const expected=command.comparison.expected,values=[],labels=new Map();
  const sameUnits=(a,b)=>{const budget=comparisonBudget(command.comparison);return comparisonOperation(budget,()=>{if(!sameAnalysisUnitDeclaration(a,b,budget))fail('ANALYSIS_MAPPING');});};

  for(const [index,s] of command.comparison.sources.entries()){
   const doc=await this.inputs.read(s.dataset),count=datasetColumnCount(doc);
   if(Object.values(s.columns).some(i=>i!==null&&i>=count))fail();
   if(expected?.source===index&&expected.actualKey>=count)fail();
   const selected=await comparisonColumns(this.inputs,doc,[...new Set([...analysisSelectedColumns(s),...(expected?.source===index?[expected.actualKey]:[])])],command.comparison,options),value=selected.columns[selected.indices.indexOf(s.columns.value)];values.push(value);
   if(labels.has(value.unit))sameUnits(labels.get(value.unit),value);else labels.set(value.unit,value);
   for(const key of ['lower','upper'])if(s.columns[key]!==null){const bound=selected.columns[selected.indices.indexOf(s.columns[key])];if(bound.unit!==value.unit)fail('ANALYSIS_MAPPING');sameUnits(value,bound);}
  }
  if(expected){const doc=await this.inputs.read(expected.dataset),count=datasetColumnCount(doc);if(expected.value>=count||expected.key>=count)fail();const selected=await comparisonColumns(this.inputs,doc,[...new Set([expected.key,expected.value])],command.comparison,options);sameUnits(values[expected.source],selected.columns[selected.indices.indexOf(expected.value)]);}
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
 async verifyExpected(comparison,{signal}={}){return verifyPolicyExpected(this.inputs,comparison,{signal});}
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
  if(summary.algorithm!=='observanda-exception-comparison'||summary.version!==2||summary.algorithmVersion!=='4'||command.comparison?.version!==3)fail('CATALOGUE_DAMAGED');
  return this.snapshot(async()=>{
  const prepared=await this.prepare(command,{retained:true});
  if(revisionText(prepared.content.summary)!==revisionText(summary))fail('CATALOGUE_DAMAGED');
  await this.index(summary).verify();
  });
 }
 async group(summary,id){return (await this.index(summary).get('groups',id))?.value;}
 async *items(doc,view,options={}){
  const index=this.index(doc.content.summary);let offset=0;
  for(;;){
   const page=await this.snapshot(async()=>{
    const page=await index.page(view,{offset,limit:32,signal:options.signal});
    if(['distribution','transitions'].includes(view))for(const item of page.items){const group=await index.get('groups',item.group);if(!group)fail('MATERIAL_MISSING');item.groupDetails=group.value;}
    return page;
   });
   yield* page.items;if(page.next===null)return;offset=page.next;
  }
 }
 async page(command,options={}){return this.snapshot(()=>this.pageSnapshot(command,options));}
 async pageSnapshot({ref:reference,offset=0,limit=20,category='',group='',view='all',backward=false},{signal}={}){
  if(reference?.kind!=='analysis'||!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>50||typeof backward!=='boolean'||!['groups','distribution','transitions','all','exceptions','boundary','timeline'].includes(view)||category&&!ANALYSIS_CATEGORIES.includes(category)||!analysisTextValue(group,6000))fail();
  const doc=await this.materials.read(reference),c=doc.content;if(!c.comparison||!validComparison(c.comparison))fail();
  const table=['groups','distribution','transitions'].includes(view)?view:'observations';
  const result=await this.index(c.summary).page(table,{offset,limit,view:table==='groups'?'':view==='timeline'?'all':view,category,group,backward,signal});
  if(['distribution','transitions'].includes(view))result.items=await Promise.all(result.items.map(async item=>{const groupDetails=await this.group(c.summary,item.group);if(!groupDetails)fail('MATERIAL_MISSING');return {...item,groupDetails};}));
  if(group){result.groupDetails=await this.group(c.summary,group);if(!result.groupDetails)fail('INVALID');}
  return result;
 }
}
