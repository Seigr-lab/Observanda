import test from 'node:test';
import assert from 'node:assert/strict';
import {perCellComputation,validComputation,validCellComputation,hasApproximateComputation,resolveCellComputation,effectiveCellColumn,derivedComputation,derivedColumnComputation,derivedCellComputation} from '../src/web/measurement-computation.js';
import {defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {retainDatasetCell,validateDatasetCell} from '../src/dataset-cell-storage.js';
import {projectDatasetRows} from '../src/dataset-storage.js';
import {MaterialSequence} from '../src/material-sequence.js';
const capability={version:2,kind:'per-cell'},rounded=()=>({version:2,kind:'approximate',method:'pearson-centered-pairs-v1',engine:4,policy:defaultStructuredCalculationPolicy()}),column={name:'Coefficient',representation:'rational',radix:10,computation:capability};
test('per-value capability is not an approximation and exact null cannot be silently omitted',()=>{
 assert.equal(validComputation(capability),true);assert.equal(hasApproximateComputation(column),false);assert.equal(validCellComputation(capability),false);assert.equal(validCellComputation(null),true);
 assert.equal(resolveCellComputation(column,{computation:null}),null);assert.equal(Object.hasOwn(effectiveCellColumn(column,{computation:null}),'computation'),false);
 for(const cell of [{},{computation:undefined},{computation:capability},{computation:{...rounded(),method:'unknown'}}])assert.throws(()=>resolveCellComputation(column,cell),{code:'DATASET_CELL_COMPUTATION'});
 assert.throws(()=>derivedComputation(column),{code:'DATASET_CELL_COMPUTATION'});assert.deepEqual(derivedColumnComputation(column),{computation:capability});
});
test('selected rounded cells retain policy and only actual consumed approximations mark derived values',()=>{
 const value=rounded(),cell={value:'0.7',kind:'string',computation:value};assert.equal(hasApproximateComputation(cell),true);assert.deepEqual(effectiveCellColumn(column,cell).computation,value);
 assert.deepEqual(derivedCellComputation({computation:null}),{computation:null});assert.deepEqual(derivedCellComputation(cell,{computation:null}),{computation:{version:1,kind:'approximate-inputs'}});
 assert.deepEqual(derivedComputation(effectiveCellColumn(column,{computation:null})),{});assert.deepEqual(derivedComputation(effectiveCellColumn(column,cell)),{computation:{version:1,kind:'approximate-inputs'}});
 assert.equal(validComputation({...value,engine:3}),false);assert.equal(validComputation({...value,policy:{...value.policy,workingDigits:1}}),false);
 const historical={computation:{version:1,kind:'approximate-inputs'}};assert.deepEqual(resolveCellComputation(historical,{}),historical.computation);
});
test('native cell retention and selected projection preserve exact, rounded and historical field presence',async()=>{
 const values=new Map(),materials={sequences:new MaterialSequence({readMetadata:async key=>values.get(key)??null,writeMetadata:async(key,text)=>values.set(key,text)})},builder=materials.sequences.builder('cells',fn=>fn()),inputs=[{kind:'string',value:'1/1',computation:null},{kind:'string',value:'0.'+'7'.repeat(5000),computation:rounded()},{kind:'string',value:'2'}];
 for(const cell of inputs)await builder.append(await retainDatasetCell(materials,cell,fn=>fn()));const cellIndex=await builder.finish(),doc={content:{datasetFormat:3,schemaIndex:{count:3}}},row={id:'retained',cellIndex};
 const selected=(await projectDatasetRows(materials,doc,[row],[2,0,1])).rows[0];assert.equal(selected.cellComputations[0],undefined);assert.equal(selected.cellComputations[1],null);assert.deepEqual(selected.cellComputations[2],inputs[1].computation);assert.equal(selected.cells[2].format,'dataset-cell');
 assert.throws(()=>validateDatasetCell(materials,{kind:'string',value:'1',computation:capability}),{code:'MATERIAL_MISSING'});
});
