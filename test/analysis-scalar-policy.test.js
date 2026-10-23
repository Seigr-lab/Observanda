import {blankUnitDefinition,exactUnitScalar} from '../src/web/measurement-unit-model.js';
import {blankQuantity} from '../src/web/measurement-model.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AnalysisComparisons} from '../src/analysis-comparisons.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {retainDatasetCell} from '../src/dataset-cell-storage.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {blankAnalysisMethod,blankAnalysisSource,addressedComparisonInputs,validComparison} from '../src/web/analysis-model.js';
import {analysisObservations} from '../src/analysis-observations.js';
import {comparisonColumns} from '../src/analysis-scalar-policy.js';
import {comparisonAccumulator} from '../src/analysis-comparison-accumulator.js';
import {createComparisonInputReader} from '../src/comparison-input-reader.js';
import {ComparisonIndex} from '../src/analysis-comparison-index.js';
import {digest,serialize} from '../src/storage-format.js';
const policy=resources=>({...defaultDatasetResourcePolicy(),resources:{...defaultDatasetResourcePolicy().resources,maxOperations:200000,maxScalarCharacters:16384,...resources}});
const column=(name,resources)=>({...defaultColumn({label:name}),representation:'integer',...(resources?{resourcePolicy:policy(resources)}:{})});
function fixture(){
 const objects=new Map(),docs=new Map(),tables=new Map(),heads=new Map(),workspaceId=randomUUID(),recordId=randomUUID();
 const workspace={storageKind:async()=>'memory',outline:async()=>({metadata:{id:workspaceId}}),withLock:fn=>fn(),readMetadata:async key=>objects.get(key)??null,writeMetadata:async(key,text)=>objects.set(key,text),removeMetadata:async key=>objects.delete(key)};
 const m={workspace,sequences:new MaterialSequence(workspace),assertOwner:async()=>{},current:async id=>heads.get(id)??null,read:async ref=>{const doc=docs.get(ref.revision);if(!doc)throw Error('Unknown retained input');return doc;},datasetColumn:async(doc,index)=>doc.content.columns[index],datasetPageCount:doc=>doc.content.pages.length,
  retainedDatasetPage:async(doc,page,{columns}={})=>({rows:tables.get(doc.content.pages[page]).map(row=>({...row,cells:columns.map(index=>row.cells[index]),valueKinds:row.valueKinds?columns.map(index=>row.valueKinds[index]):undefined,columnIndices:columns}))}),
  async *iterateDataset(ref,options){const doc=await this.read(ref);for(let page=0;page<this.datasetPageCount(doc);page++)yield*(await this.retainedDatasetPage(doc,page,options)).rows;},
  async commit({kind,recordId,title,id=randomUUID(),expectedRevision=null,content}){const doc={kind,recordId,title,id,content,previous:expectedRevision},revision=digest(serialize(doc));docs.set(revision,{...doc,revision});const ref={kind,id,revision};heads.set(id,ref);return ref;}
 };
 m.assertReferenceWorkspace=async()=>{};m.comparisons=new AnalysisComparisons(m);
 async function dataset(columns,values){const id=randomUUID(),rows=[];for(const [i,value] of values.entries()){const cells=[];for(const cell of value.cells??value)cells.push((await retainDatasetCell(m,{kind:'string',value:cell},fn=>fn())).value);rows.push({id:'row-'+i,order:i,cells,excluded:value.excluded??'',...(value.valueKinds?{valueKinds:value.valueKinds}:{})});}const page=randomUUID();tables.set(page,rows);const ref=await m.commit({kind:'dataset',id,recordId,title:'Owned source',content:{columns,pages:[page],rowCount:rows.length}});return {...ref,workspaceId};}
 function command(ref,resources){const source=blankAnalysisSource(ref);source.columns.value=0;return {recordId,title:'Policy comparison',tool:'Retained observations',version:'test',method:{...blankAnalysisMethod(),unavailable:'No external tool',uncertainty:'Declared exact spelling',limitations:'Synthetic values'},comparison:{version:3,resourcePolicy:policy(resources),sources:[source],ordering:'source',expected:null}};}
 return {m,workspaceId,recordId,objects,docs,dataset,command};
}

test('versioned comparison policies preserve addressed identity and refuse legacy policy input even without rows',async()=>{
 const f=fixture(),ref=await f.dataset([column('Value',{})],[]),command=f.command(ref),old={...command.comparison,version:2};delete old.resourcePolicy;
 assert.equal(validComparison(command.comparison),true);assert.equal(!!validComparison({...command.comparison,resourcePolicy:undefined}),false);assert.equal(validComparison({...old,resourcePolicy:policy()}),false);
 assert.equal(addressedComparisonInputs(command,f.workspaceId).comparison.version,3);
 await assert.rejects(f.m.comparisons.validate({...command,comparison:old}),{code:'ANALYSIS_SCALAR_POLICY'});
 await f.m.comparisons.validate(command);assert.equal((await f.m.comparisons.prepare(command,{writePage:fn=>fn()})).content.summary.algorithmVersion,'4');
});

test('complete long source spelling and canonical values survive indexed retention, paging and exact expected matching',async()=>{
 const f=fixture(),spelling='9'.repeat(9001),ref=await f.dataset([column('Value',{})],[[spelling]]),expected=await f.dataset([column('Value',{})],[[spelling]]),command=f.command(ref);
 command.comparison.expected={dataset:expected,source:0,key:0,actualKey:0,value:0,rationale:'The exact retained integer'};
 const result=await f.m.comparisons.save(command,{writePage:fn=>fn()}),doc=await f.m.read(result),page=await f.m.comparisons.page({ref:result,view:'all'}),distribution=await f.m.comparisons.page({ref:result,view:'distribution'});
 assert.equal(page.items[0].value,spelling);assert.equal(page.items[0].exact.numerator,spelling);assert.equal(distribution.items[0].exact.numerator,spelling);assert.equal(doc.content.summary.verification.correct,1);assert.equal(doc.content.summary.verification.version,'2');
 assert.ok(Buffer.byteLength(serialize(page.items))<1048576);await f.m.comparisons.index(doc.content.summary).verify();
 const again=await f.m.comparisons.prepare(command,{jobId:randomUUID(),writePage:fn=>fn()});assert.deepEqual(again.content.summary,doc.content.summary);
});

test('owner and consumer resource failures cannot become lexical matches; malformed declared numbers refuse',async()=>{
 const f=fixture(),large='1'+ '0'.repeat(30),ownerLow=await f.dataset([column('Value',{maxBits:64})],[[large]]),ref=await f.dataset([column('Value',{})],[[large]]);
 await assert.rejects(Array.fromAsync(analysisObservations(f.m,f.command(ownerLow).comparison)),{code:'DATASET_CALCULATION_RESOURCE'});
 await assert.rejects(Array.fromAsync(analysisObservations(f.m,f.command(ref,{maxBits:64}).comparison)),{code:'DATASET_CALCULATION_RESOURCE'});
 const command=f.command(ref,{maxBits:64});command.comparison.expected={dataset:ref,source:0,key:0,actualKey:0,value:0,rationale:'Same lexical spelling cannot bypass limits'};
 await assert.rejects(f.m.comparisons.verifyExpected(command.comparison),{code:'DATASET_CALCULATION_RESOURCE'});
 const invalid=await f.dataset([column('Value')],[['not-a-number']]),bad=f.command(invalid);bad.comparison.expected={...command.comparison.expected,dataset:invalid};
 await assert.rejects(f.m.comparisons.verifyExpected(bad.comparison),{code:'ANALYSIS_MAPPING'});
 const low=f.command(ref,{maxOperations:1});await assert.rejects(f.m.comparisons.prepare(low),{code:'DATASET_CALCULATION_RESOURCE'});
});

test('policy observations preserve bounds, missing/absent values, exclusions and exact source locators',async()=>{
 const f=fixture(),columns=[column('Value',{}),column('Lower',{}),column('Upper',{})],ref=await f.dataset(columns,[['9007199254740993','9007199254740992','9007199254740994'],{cells:['','0','2'],valueKinds:['null','string','string']},{cells:['','0','2'],valueKinds:['absent','string','string']},{cells:['1','0','2'],excluded:'Warmup'}]),command=f.command(ref);Object.assign(command.comparison.sources[0].columns,{lower:1,upper:2});
 const rows=await Array.fromAsync(analysisObservations(f.m,command.comparison));assert.equal(rows[0].boundary,'inside');assert.deepEqual(rows[0].margin,{numerator:'1',denominator:'1'});assert.deepEqual(rows.map(row=>row.category),['unresolved','unavailable','unavailable','excluded']);assert.equal(rows[3].exclusion,'Warmup');assert.deepEqual(rows[0].locator,{ref,selector:{kind:'cell',page:0,row:0,column:0}});
});

test('missing retained text and unauthorized source reads fail before a result is retained',async()=>{
 const f=fixture(),ref=await f.dataset([column('Value',{})],[['0'.repeat(9000)+'1']]),doc=await f.m.read(ref),row=(await f.m.retainedDatasetPage(doc,0,{columns:[0]})).rows[0],text=row.cells[0],node=await f.m.sequences.tree().node(text.parts.root),file='.observanda/materials/sequences/chunks/'+node.revision+'.json',original=f.objects.get(file);f.objects.delete(file);
 await assert.rejects(f.m.comparisons.prepare(f.command(ref)),{code:'MATERIAL_MISSING'});f.objects.set(file,original);
 row.cells[0]={...text,sha256:'0'.repeat(64)};const {resolveComparisonRow}=await import('../src/analysis-scalar-policy.js');await assert.rejects(resolveComparisonRow(f.m,row,doc.content.columns,f.command(ref).comparison),{code:'MATERIAL_MISSING'});
 const denied={...f.m,comparisonColumn:async()=>{throw Object.assign(Error('Locked'),{code:'ACCESS_LOCKED'});}};await assert.rejects(comparisonColumns(denied,doc,[0],f.command(ref).comparison),{code:'ACCESS_LOCKED'});
});

test('new comparison payload limits refuse oversized retained observations without truncating them',async()=>{
 const f=fixture(),ref=await f.dataset([column('Value')],[['1']]),command=f.command(ref),[o]=await Array.fromAsync(analysisObservations(f.m,command.comparison)),index=new ComparisonIndex(f.m.sequences),summary={rows:0,runs:0,unknownRunRows:0,raw:{unresolved:0},aggregate:{},counts:{groups:0,distribution:0,transitions:0,observations:0}},append=comparisonAccumulator(index,{summary,last:null},command.comparison);
 await assert.rejects(append({...o,sequence:'x'.repeat(1048576)}),{code:'ANALYSIS_LIMIT'});
 assert.equal(summary.counts.observations,0);
});


test('source access is rechecked after complete scalar reading and before a row leaves its source scope',async()=>{
 const f=fixture(),ref=await f.dataset([column('Value',{})],[['0'.repeat(9000)+'1']]);let allowed=true,visits=0;
 const access={verify:async()=>{if(!allowed)throw Object.assign(Error('Source locked'),{code:'ACCESS_LOCKED'});},use:async(ref,consume)=>{visits++;return consume(f.m.workspace,ref);},close:async()=>{}};
 const reader=createComparisonInputReader(f.m,{workspaceId:f.workspaceId,access}),doc=await reader.read(ref),page=await reader.retainedDatasetPage(doc,0,{columns:[0]}),command=f.command(ref);
 const original=f.m.workspace.readMetadata;f.m.workspace.readMetadata=async(...args)=>{const result=await original(...args);allowed=false;return result;};
 await assert.rejects(reader.comparisonRow(doc,page.rows[0],doc.content.columns,command.comparison),{code:'ACCESS_LOCKED'});assert.ok(visits>=3);await reader.close();
});


test('canonical and margin formatting obey the saved scalar character limit rather than only input length',async()=>{
 const f=fixture(),decimal={...column('Value'),representation:'decimal'},ref=await f.dataset([decimal],[['1e9000']]),command=f.command(ref,{maxScalarCharacters:8192,maxExponent:12000});
 await assert.rejects(Array.fromAsync(analysisObservations(f.m,command.comparison)),{code:'DATASET_CALCULATION_RESOURCE'});
 const lower={...decimal,name:'Lower'},margin=await f.dataset([decimal,lower],[['0','-1e9000']]),bounded=f.command(margin,{maxScalarCharacters:8192,maxExponent:12000});bounded.comparison.sources[0].columns.lower=1;
 await assert.rejects(Array.fromAsync(analysisObservations(f.m,bounded.comparison)),{code:'DATASET_CALCULATION_RESOURCE'});
});


test('historical comparisons keep lexical fallback and page-scoped reading for legacy untyped inputs',async()=>{
 const f=fixture(),ref=await f.dataset([column('Legacy')],[['not-a-number']]),command=f.command(ref);delete command.comparison.resourcePolicy;command.comparison.version=2;command.comparison.expected={dataset:ref,source:0,key:0,actualKey:0,value:0,rationale:'Historical lexical interpretation'};
 f.m.comparisonRow=()=>assert.fail('Legacy comparisons must keep their existing page-scoped reads');
 const rows=await Array.fromAsync(analysisObservations(f.m,command.comparison));assert.equal(rows[0].exact,null);assert.equal((await f.m.comparisons.verifyExpected(command.comparison)).correct,1);
 const prepared=await f.m.comparisons.prepare(command,{writePage:fn=>fn()});assert.equal(prepared.content.summary.algorithmVersion,'3');assert.equal(prepared.content.summary.verification.version,'1');
});


test('new comparisons refuse conflicting typed units while accepting equivalent declared spellings without conversion',async()=>{
 const f=fixture(),typed=scale=>({...column('Value',{}),unit:'declared',quantity:{...blankQuantity(),unitDefinition:{...blankUnitDefinition(),version:2,resourcePolicy:policy(),dimensions:[{axis:'length',exponent:1}],scale:exactUnitScalar(scale,'rational')}}}),actual=await f.dataset([typed('1/100')],[['1']]),different=await f.dataset([typed('1/1')],[['1']]),same=await f.dataset([typed('2/200')],[['1']]),command=f.command(actual);
 command.comparison.expected={dataset:different,source:0,key:0,actualKey:0,value:0,rationale:'The same label does not establish equal scale'};
 await assert.rejects(f.m.comparisons.verifyExpected(command.comparison),{code:'ANALYSIS_MAPPING'});
 await assert.rejects(f.m.comparisons.validate(command),{code:'ANALYSIS_MAPPING'});
 command.comparison.expected.dataset=same;assert.equal((await f.m.comparisons.verifyExpected(command.comparison)).correct,1);
 const bounds=await f.dataset([typed('1/100'),typed('1/1')],[['1','0']]),bounded=f.command(bounds);bounded.comparison.sources[0].columns.lower=1;
 await assert.rejects(Array.fromAsync(analysisObservations(f.m,bounded.comparison)),{code:'ANALYSIS_MAPPING'});
 const mixed=f.command(actual),other=blankAnalysisSource(different);other.columns.value=0;mixed.comparison.sources.push(other);await assert.rejects(f.m.comparisons.validate(mixed),{code:'ANALYSIS_MAPPING'});
 const undeclared=await f.dataset([{...column('Value'),unit:'declared'}],[]);mixed.comparison.sources[1].dataset=undeclared;await assert.rejects(f.m.comparisons.validate(mixed),{code:'ANALYSIS_MAPPING'});
});
