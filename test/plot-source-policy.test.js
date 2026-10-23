import test from 'node:test';
import assert from 'node:assert/strict';
import {MaterialSequence} from '../src/material-sequence.js';
import {retainDatasetCell} from '../src/dataset-cell-storage.js';
import {retainScalarDefinitions} from '../src/measurement-scalar-storage.js';
import {plotScalarOperation,plotComputationFailure} from '../src/plot-resource-policy.js';
import {AppError} from '../src/errors.js';
import {datasetPlotSelection} from '../src/dataset-plot-selection.js';
import {assertPlotProjectionUnits} from '../src/dataset-plot-provenance.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {blankUnitDefinition} from '../src/web/measurement-unit-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
const policy=patch=>{const value=defaultDatasetResourcePolicy();Object.assign(value.resources,patch);return value;};
const column=p=>({...defaultColumn({label:'Value'}),representation:'decimal',resourcePolicy:p});
function fixture(){const values=new Map(),reads=[],workspace={readMetadata:async key=>{reads.push(key);return values.get(key)??null;},writeMetadata:async(key,text)=>{values.set(key,text);}};return {values,reads,materials:{workspace,sequences:new MaterialSequence(workspace)}};}
const asText=(value,budget)=>{budget?.size(value.numerator,value.denominator);return value.numerator+'/'+value.denominator;};
const mapping=p=>({version:1,x:0,xKind:'number',group:null,values:[{column:1,error:null}],resourcePolicy:p});
test('plots cannot borrow larger exponent, text or bit limits from a source or mapping',async()=>{
 const high=policy({maxExponent:20}),low=policy({maxExponent:4});
 for(const [owner,operation] of [[low,high],[high,low]])await assert.rejects(plotScalarOperation({},'1e12',column(owner),mapping(operation),asText),{code:'DATASET_CALCULATION_RESOURCE'});
 const bits=policy({maxBits:64});for(const [owner,operation] of [[bits,high],[high,bits]])await assert.rejects(plotScalarOperation({},'184467440737095516160',column(owner),mapping(operation),asText),{code:'DATASET_CALCULATION_RESOURCE'});
 assert.equal(await plotScalarOperation({},'1e4',column(low),mapping(high),asText),'10000/1');assert.equal(await plotScalarOperation({},'',column(low),mapping(high),asText),null);
 const f=fixture(),long='0'.repeat(9000)+'1',text=(await retainDatasetCell(f.materials,{value:long,kind:'string'},fn=>fn())).value,wide=policy({maxScalarCharacters:12000});
 assert.equal(await plotScalarOperation(f.materials,text,column(wide),mapping(wide),asText),'1/1');assert.equal((await retainDatasetCell(f.materials,{value:long,kind:'string'},fn=>fn())).value.sha256,text.sha256);
 for(const [owner,operation] of [[low,wide],[wide,low]])await assert.rejects(plotScalarOperation(f.materials,text,column(owner),mapping(operation),asText),{code:'DATASET_CALCULATION_RESOURCE'});
 const stopped=new AbortController();stopped.abort();const before=f.reads.length;await assert.rejects(plotScalarOperation(f.materials,text,column(wide),mapping(wide),asText,{signal:stopped.signal}),{name:'AbortError'});assert.equal(f.reads.length,before);
});
test('selected plot columns resolve only their own declarations and retain exact source positions',async()=>{
 const f=fixture(),p=policy({maxScalarCharacters:12000}),u={...blankUnitDefinition(),version:2,resourcePolicy:p};u.scale.spelling='0'.repeat(9000)+'1';const stored=await retainScalarDefinitions(f.materials,{...column(p),quantity:{...column(p).quantity,unitDefinition:u}},fn=>fn());
 const unused={...stored,quantity:{...stored.quantity,unitDefinition:{...stored.quantity.unitDefinition,scale:{...stored.quantity.unitDefinition.scale,spelling:{}}}}},cols=[stored,column(p),unused];f.materials.datasetColumns=async()=>structuredClone(cols);
 const selected=await datasetPlotSelection(f.materials,{content:{datasetFormat:3,columns:cols}},mapping(p));assert.equal(selected.columns[0].quantity.unitDefinition.scale.spelling,u.scale.spelling);assert.deepEqual(selected.columns[2],unused);assert.equal(stored.quantity.unitDefinition.scale.spelling.format,'dataset-cell');
 const positions=[];f.materials.datasetColumn=async(doc,index)=>{positions.push(index);return structuredClone(index===299?stored:column(p));};const wide=await datasetPlotSelection(f.materials,{content:{datasetFormat:3,schemaIndex:{count:300}}},{...mapping(p),x:299,values:[{column:4,error:null}]});assert.deepEqual(positions,[299,4]);assert.deepEqual(wide.indices,[299,4]);assert.equal(wide.mapping.x,0);assert.equal(wide.mapping.values[0].column,1);assert.equal(wide.columns[0].quantity.unitDefinition.scale.spelling,u.scale.spelling);
});
test('projected uncertainty uses each declared unit policy without rewriting either declaration',()=>{
 const p=policy({maxScalarCharacters:12000}),unit={...blankUnitDefinition(),version:2,resourcePolicy:p};unit.scale.spelling='0'.repeat(9000)+'1';const a={...column(p),quantity:{...column(p).quantity,unitDefinition:unit}},b=structuredClone(a),projection={version:2,resourcePolicy:p,y:{origin:{spelling:'0',representation:'integer',radix:10},scale:{spelling:'1',representation:'integer',radix:10}}},m={...mapping(p),projection,values:[{column:1,error:2}]},before=JSON.stringify([a,b]);assert.doesNotThrow(()=>assertPlotProjectionUnits(m,[column(p),a,b]));assert.equal(JSON.stringify([a,b]),before);assert.doesNotThrow(()=>assertPlotProjectionUnits({...m,values:[{column:1,error:null},{column:2,error:null}]},[column(p),a,b]));
 assert.throws(()=>assertPlotProjectionUnits({...m,resourcePolicy:policy()},[column(p),a,b]),{code:'DATASET_CALCULATION_RESOURCE'});b.quantity.unitDefinition.resourcePolicy=policy();assert.throws(()=>assertPlotProjectionUnits(m,[column(p),a,b]),{code:'MATERIAL_INVALID'});
});

test('plot storage and authority failures keep their actionable classification',()=>{
 for(const code of ['MATERIAL_MISSING','CATALOGUE_DAMAGED','ACCESS_LOCKED','WORKSPACE_CHANGED','DATASET_CELL_SCALAR_REQUIRED']){const error=new AppError(code);assert.throws(()=>plotComputationFailure(error),actual=>actual===error);}
 assert.throws(()=>plotComputationFailure(RangeError('Cannot represent exact coordinate')),{code:'MATERIAL_PRECISION'});
});
