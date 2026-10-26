import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {randomUUID} from 'node:crypto';
import {catalogueContext} from '../src/catalogue-context.js';

const names=['PublicationOperations','PagedResearchTables','ReferencedCalculations','NativeNumericalModels','NativeClockModels','NativeDomainValues','ClockDerivations','IntervalUncertainty','WindowCalculations','FigureProjectionPolicies','AxisPermutation','StatisticalUncertainty','MeasurementScalarPolicies','DatasetResourcePolicies','StructuredCalculator','ApproximateCalculator','PairedStatistics','QuantileAggregation','WeightedFit','CoordinateAlignment','SpectralMethods','TopologyValues','SequenceValues','TensorValues','NumericalExecution','DatasetCusum','DatasetSpectra','ComputedCells','CoordinateFrames','SegmentedClockSynchronization','ClockSynchronization','DomainAlgebra','CalculatorDatasetResults','CalculationPolicies','ReviewFigurePackages'];
const unique=randomUUID(),spy='metadataFormat_'+unique,dispatcherURL=new URL('../src/metadata-catalogue-format.js',import.meta.url).href+'?test='+unique,storageURL=new URL('../src/storage.js',import.meta.url).href+'?metadata-format-test='+unique,formatURL='metadata-format-spy:'+unique;
let dispatcherResolutions=0;
globalThis[spy]=(name,db)=>{db.calls.push(name);if(db.reject===name)throw db.failure;};
const hooks=registerHooks({
 resolve(specifier,context,next){
  if(context.parentURL===storageURL&&specifier==='./metadata-catalogue-format.js'){dispatcherResolutions++;return {url:dispatcherURL,shortCircuit:true};}
  if(context.parentURL===dispatcherURL&&specifier==='./catalogue-format.js')return {url:formatURL,shortCircuit:true};
  return next(specifier,context);
 },
 load(url,context,next){return url===formatURL?{format:'module',shortCircuit:true,source:names.map(name=>'export const require'+name+'=async db=>globalThis['+JSON.stringify(spy)+']('+JSON.stringify(name)+',db);').join('\n')}:next(url,context);}
});
const {requireMetadataCatalogueFormat:dispatch}=await import(dispatcherURL),{Workspace}=await import(storageURL);
after(()=>{hooks.deregister();delete globalThis[spy];});
const object='.observanda/materials/objects/revision.json',chunk='.observanda/materials/sequences/chunks/chunk.json',job='.observanda/jobs/job.json',draft='.observanda/module-drafts/11111111-1111-4111-8111-111111111111.json';
const admitted=new Set();
async function expect(relative,value,expected){const db={calls:[]};await dispatch(db,relative,JSON.stringify(value));assert.deepEqual(db.calls,expected,relative+' '+JSON.stringify(value));for(const name of db.calls)admitted.add(name);}

test('real metadata predicates preserve every admission family and overlapping requirement order',async()=>{
 const cases=[
  [job,{type:'publication.prepare',input:{request:{version:1}}},['PublicationOperations']],
  [job,{type:'publication.analysis-review'},['PublicationOperations']],
  ['.observanda/publication-analysis-operations/'+ 'a'.repeat(64)+'.json',{version:1},['PublicationOperations']],
  [object,{content:{datasetFormat:3}},['PagedResearchTables']],
  [chunk,{kind:'cells',items:[{value:'source text',kind:'string'}]},['PagedResearchTables']],
  [chunk,{kind:'cell-text',items:['source text']},['PagedResearchTables']],
  [object,{content:{tool:'Observanda calculation graph',graphVersion:1}},['ReferencedCalculations']],
  [job,{type:'dataset.prepare',input:{command:{calculation:{version:3}}}},['NativeNumericalModels']],
  [chunk,{kind:'columns',items:[{time:{clock:{definition:{}}}}]},['NativeClockModels']],
  [chunk,{kind:'columns',items:[{representation:'domain'}]},['NativeDomainValues']],
  [object,{content:{tool:'Observanda calculation graph',graphVersion:3}},['ReferencedCalculations','ClockDerivations']],
  [object,{content:{tool:'Observanda calculation graph',graphVersion:4}},['ReferencedCalculations','IntervalUncertainty']],
  [object,{content:{tool:'Observanda calculation graph',graphVersion:6}},['ReferencedCalculations','WindowCalculations','DatasetResourcePolicies']],
  ['.observanda/materials/figures/value/'+'a'.repeat(64)+'.json',{type:'property',name:'resourcePolicy'},['FigureProjectionPolicies']],
  [chunk,{kind:'calculation-nodes',items:[{kind:'domain-permute'}]},['ReferencedCalculations','AxisPermutation','TensorValues']],
  [chunk,{kind:'uncertainty-inputs',items:[]},['NativeNumericalModels','MeasurementScalarPolicies','DatasetResourcePolicies','StructuredCalculator','ApproximateCalculator','StatisticalUncertainty']],
  [object,{content:{aggregation:{version:7}}},['MeasurementScalarPolicies','DatasetResourcePolicies','QuantileAggregation','PairedStatistics','MeasurementScalarPolicies','DatasetResourcePolicies','QuantileAggregation','WeightedFit','ComputedCells','MeasurementScalarPolicies','DatasetResourcePolicies']],
  [chunk,{kind:'columns',items:[{coordinateAlignment:{}}]},['CoordinateAlignment']],
  [chunk,{kind:'columns',items:[{spectrum:{version:3}}]},['SpectralMethods','NumericalExecution','DatasetSpectra']],
  [chunk,{kind:'topology-vertices',items:[]},['TopologyValues']],
  [chunk,{kind:'calculation-nodes',items:[{kind:'domain-sequence'}]},['ReferencedCalculations','SequenceValues']],
  ['.observanda/materials/numerical-work/job.json',{kind:'ordinary'},['NumericalExecution']],
  [chunk,{kind:'columns',items:[{cusum:{version:1}}]},['NumericalExecution','DatasetCusum']],
  [chunk,{kind:'columns',items:[{computation:{version:2}}]},['ComputedCells','ApproximateCalculator']],
  [chunk,{kind:'coordinate-frame-axes',items:[]},['CoordinateFrames']],
  [chunk,{kind:'clock-sync-segments',items:[]},['MeasurementScalarPolicies','DatasetResourcePolicies','ClockSynchronization','SegmentedClockSynchronization']],
  [chunk,{kind:'calculation-nodes',items:[{kind:'domain-arithmetic'}]},['ReferencedCalculations','DomainAlgebra']],
  [object,{content:{calculatorResult:{version:2}}},['StructuredCalculator','CalculatorDatasetResults']],
  [draft,{drafts:[{type:'calculation',operation:{values:{engine:4}}}]},['StructuredCalculator','CalculationPolicies']],
  ['.observanda/reviews/parts/part.json',{},['ReviewFigurePackages']]
 ];
 for(const [relative,value,expected]of cases)await expect(relative,value,expected);
 assert.deepEqual([...admitted].sort(),names.slice().sort());
});

test('ordinary metadata, historical markers and arbitrary source strings do not acquire capabilities',async()=>{
 for(const [relative,value]of [[chunk,{kind:'nodes',items:[]}],[job,{type:'other',input:{command:{calculation:{version:3}}}}],[chunk,{kind:'cells',items:[{value:'Observanda calculation graph',kind:'string'}]}],[object,{content:{tool:'Observanda calculation graph',graphVersion:0}}],[draft,{drafts:[{type:'calculation',data:{engine:2}}]}]])await expect(relative,value,relative===chunk&&value.kind==='cells'?['PagedResearchTables']:[]);
 const review='.observanda/reviews/11111111-1111-4111-8111-111111111111.json';await expect(review,{request:{value:{version:1}}},[]);await expect(review,{request:{value:{version:2}}},['ReviewFigurePackages']);
 const db={calls:[]};await dispatch(db,'.observanda/unrelated.txt','not JSON');assert.deepEqual(db.calls,[]);
 for(const relative of [chunk,draft,review])await assert.rejects(dispatch(db,relative,'{'),SyntaxError);
});

test('workspace loads the resolved dispatcher once while checking each write against its current database',async()=>{
 const writes=[],workspace={root:'synthetic-metadata-format',metadataPath:relative=>relative,catalogue:operation=>operation({db:workspace.db,putObject:async(id,value)=>writes.push({id,value,db:workspace.db})})},write=(relative,value)=>catalogueContext.run({root:workspace.root},()=>Workspace.prototype.writeMetadata.call(workspace,relative,JSON.stringify(value)));
 for(let i=0;i<20;i++){workspace.db={calls:[]};await write(chunk,{kind:'cells',items:[]});assert.deepEqual(workspace.db.calls,['PagedResearchTables']);}
 assert.equal(dispatcherResolutions,1);assert.equal(writes.length,20);assert.equal(new Set(writes.map(value=>value.db)).size,20);
 const failure=Error('Synthetic capability failure');workspace.db={calls:[],reject:'PagedResearchTables',failure};await assert.rejects(write(chunk,{kind:'cells',items:[]}),error=>error===failure);assert.equal(writes.length,20);assert.equal(dispatcherResolutions,1);
 workspace.db={calls:[]};await write(chunk,{kind:'nodes',items:[]});assert.deepEqual(workspace.db.calls,[]);assert.equal(writes.length,21);assert.equal(dispatcherResolutions,1);
});

test('a failed prerequisite stops later requirements and publication instead of caching admission',async()=>{
 const failure=Error('Independent capability unavailable'),db={calls:[],reject:'DatasetResourcePolicies',failure};
 await assert.rejects(dispatch(db,chunk,JSON.stringify({kind:'uncertainty-inputs',items:[]})),error=>error===failure);
 assert.deepEqual(db.calls,['NativeNumericalModels','MeasurementScalarPolicies','DatasetResourcePolicies']);
 db.calls=[];db.reject=null;await dispatch(db,chunk,JSON.stringify({kind:'uncertainty-inputs',items:[]}));
 assert.deepEqual(db.calls,['NativeNumericalModels','MeasurementScalarPolicies','DatasetResourcePolicies','StructuredCalculator','ApproximateCalculator','StatisticalUncertainty']);
});
