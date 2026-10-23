import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {calculateComparison} from '../src/analysis-comparison-calculation.js';
import {comparisonComputation} from '../src/analysis-comparison-computation.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {ComparisonIndex} from '../src/analysis-comparison-index.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {blankAnalysisMethod,blankAnalysisSource} from '../src/web/analysis-model.js';
const marker={version:1,kind:'approximate-inputs'};
function fixture(){
 const files=new Map(),ref={workspaceId:randomUUID(),kind:'dataset',id:randomUUID(),revision:'b'.repeat(64)},recipe={kind:'analysis',id:randomUUID(),revision:'c'.repeat(64)};
 const columns=[0,1,2].map(index=>({...defaultColumn({label:'Column '+index}),representation:'decimal',missing:[]}));columns[0].computation={version:1,kind:'approximate',recipe};
 const doc={content:{columns,rowCount:2}},rows=['1.414','2.718'].map((value,index)=>({id:'r'+index,order:index,cells:[value,'0','0'],excluded:''}));
 const workspace={readMetadata:async key=>files.get(key)??null,writeMetadata:async(key,value)=>files.set(key,value)},materials={workspace,sequences:new MaterialSequence(workspace)};
 const inputs={read:async value=>{assert.deepEqual(value,ref);return doc;},datasetColumn:async(_,index)=>structuredClone(columns[index]),datasetPageCount:()=>1,retainedDatasetPage:async(_,page,{columns:indices})=>{assert.equal(page,0);return {rows:rows.map(row=>({...row,columnIndices:indices,cells:indices.map(index=>row.cells[index])}))};}};
 const source=blankAnalysisSource(ref);source.columns.value=0;
 const command={recordId:randomUUID(),title:'Retained finite comparison',tool:'test',version:'1',method:blankAnalysisMethod(),comparison:{version:3,resourcePolicy:defaultDatasetResourcePolicy(),sources:[source],ordering:'source',expected:null}};
 const owner={materials,inputs,references:()=>[ref],verifyInputs:async()=>{},verifyExpected:async()=>null},options={sourceIdentities:[{dataset:ref,run:null}],writePage:fn=>fn()};
 return {files,columns,doc,ref,owner,command,options};
}
test('comparison summary preserves approximation while retained finite identities and distribution remain unchanged',async()=>{
 const f=fixture(),marked=await calculateComparison(f.owner,f.command,f.options),index=new ComparisonIndex(f.owner.materials.sequences,marked.content.summary.index.root),values=await index.page('distribution');
 assert.deepEqual(marked.content.summary.computation,marker);assert.deepEqual(values.items.map(item=>item.exact),[{numerator:'707',denominator:'500'},{numerator:'1359',denominator:'500'}]);
 delete f.columns[0].computation;f.columns[2].computation=marker;
 const exact=await calculateComparison(f.owner,f.command,f.options);assert.equal(Object.hasOwn(exact.content.summary,'computation'),false);assert.deepEqual(exact.content.summary.index,marked.content.summary.index);
 f.command.comparison.sources[0].columns.lower=2;assert.deepEqual(await comparisonComputation(f.owner.inputs,f.command.comparison),{computation:marker});
 f.command.comparison.sources[0].columns.lower=null;f.command.comparison.expected={dataset:f.ref,key:1,value:2,actualKey:1,source:0,rationale:'Retained finite fixture'};assert.deepEqual(await comparisonComputation(f.owner.inputs,f.command.comparison),{computation:marker});
});
test('comparison retry retains checkpoint interpretation and rejects a changed declaration instead of silently dropping provenance',async()=>{
 const f=fixture(),jobId=randomUUID();let interrupted=false;
 await assert.rejects(calculateComparison(f.owner,f.command,{...f.options,jobId,writePage:async fn=>{const value=await fn();if(!interrupted){interrupted=true;throw Error('Interrupted after checkpoint');}return value;}}),/Interrupted after checkpoint/);
 const file='.observanda/materials/comparison-work/'+jobId+'.json',checkpoint=JSON.parse(f.files.get(file));assert.equal(checkpoint.complete,false);assert.deepEqual(checkpoint.summary.computation,marker);
 delete f.columns[0].computation;await assert.rejects(calculateComparison(f.owner,f.command,{...f.options,jobId}),{code:'MATERIAL_MISSING'});
 f.columns[0].computation=marker;const resumed=await calculateComparison(f.owner,f.command,{...f.options,jobId});assert.equal(resumed.content.summary.rows,2);assert.deepEqual(resumed.content.summary.computation,marker);assert.equal(JSON.parse(f.files.get(file)).complete,true);
 const fresh=await calculateComparison(f.owner,f.command,f.options);assert.deepEqual(fresh.content.summary,resumed.content.summary);
});
