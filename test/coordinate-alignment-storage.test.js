import {safeError} from '../src/errors.js';
import {CoordinateAlignmentError} from '../src/coordinate-alignment-kernel.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {MaterialSequence} from '../src/material-sequence.js';
import {retainDatasetCell} from '../src/dataset-cell-storage.js';
import {projectDatasetRows,storedDatasetCells} from '../src/dataset-storage.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {alignmentContextSet,alignmentDecisionSet} from '../src/coordinate-alignment.js';
import {defaultColumn} from '../src/web/dataset-schema.js';

function fixture(){
 const objects=new Map(),workspace={readMetadata:async key=>objects.get(key)??null,writeMetadata:async(key,value)=>objects.set(key,value)},sequences=new MaterialSequence(workspace),materials={workspace,sequences,datasetPageCount:()=>1};
 materials.retainedSchemaPage=(doc,options)=>ResearchMaterials.prototype.retainedSchemaPage.call(materials,doc,options);
 materials.iterateDatasetCells=(doc,row)=>storedDatasetCells(materials,doc,row);
 const sequence=async(kind,items)=>{const builder=sequences.builder(kind,fn=>fn());for(const item of items)await builder.append(item);return builder.finish();};
 return {materials,sequence};
}

test('selected late columns preserve alignment decisions alongside complete cell spelling without annotating unrelated cells',async()=>{
 const {materials,sequence}=fixture(),marker={version:1,decisionsIndex:alignmentDecisionSet(materials).ref()},inputs=Array.from({length:20},(_,i)=>({kind:'string',value:String(i),...(i===17?{coordinateAlignment:marker}:{} )}));inputs[17].value='7'.repeat(17000);
 const saved=[];for(const input of inputs)saved.push(await retainDatasetCell(materials,input,fn=>fn()));const row={id:'selected-row',cellIndex:await sequence('cells',saved)},doc={content:{datasetFormat:3,schemaIndex:{count:20}}};
 const projected=(await projectDatasetRows(materials,doc,[row],[19,17,0])).rows[0];assert.deepEqual(projected.columnIndices,[19,17,0]);assert.deepEqual(projected.cellCoordinateAlignments,[undefined,marker,undefined]);assert.equal(projected.cells[1].characters,17000);assert.equal(projected.cells[1].parts.count,2);
 const unrelated=(await projectDatasetRows(materials,doc,[row],[19,0])).rows[0];assert.equal(Object.hasOwn(unrelated,'cellCoordinateAlignments'),false);
 await assert.rejects(retainDatasetCell(materials,{kind:'string',value:'1',coordinateAlignment:{...marker,contextsIndex:alignmentContextSet(materials).ref()}},fn=>fn()),{code:'MATERIAL_MISSING'});
});

test('selected schema reads require the dataset capability without traversing alignment context',async()=>{
 const {materials,sequence}=fixture(),marker={version:1,contextsIndex:alignmentContextSet(materials).ref()},columns=Array.from({length:20},(_,i)=>({...defaultColumn({label:'Column '+i}),...(i===19?{coordinateAlignment:marker}:{})})),doc={content:{datasetFormat:3,coordinateAlignments:1,schemaIndex:await sequence('columns',columns)}};
 materials.read=async()=>assert.fail('Schema paging must not traverse private graph inputs');const page=await materials.retainedSchemaPage(doc,{offset:19,limit:1});assert.deepEqual(page.items,[columns[19]]);assert.equal(page.total,20);
 const missing=structuredClone(doc);delete missing.content.coordinateAlignments;await assert.rejects(materials.retainedSchemaPage(missing,{offset:19,limit:1}),{code:'MATERIAL_MISSING'});assert.equal((await materials.retainedSchemaPage(missing,{offset:0,limit:1})).items.length,1);
});

test('dataset row verification rejects undeclared cell decisions and preserves an empty inactive-branch receipt set',async()=>{
 const {materials,sequence}=fixture(),column={...defaultColumn({label:'Optional result'}),coordinateAlignment:{version:1,contextsIndex:alignmentContextSet(materials).ref()}},cell={kind:'absent',value:'',coordinateAlignment:{version:1,decisionsIndex:alignmentDecisionSet(materials).ref()}},row={id:'inactive',cellIndex:await sequence('cells',[cell])},doc={content:{datasetFormat:3,coordinateAlignments:1,schemaIndex:await sequence('columns',[column])}};
 await ResearchMaterials.prototype.verifyDatasetRow.call(materials,doc,row,{});const stripped={...row,cellIndex:await sequence('cells',[{kind:'absent',value:''}])};await assert.rejects(ResearchMaterials.prototype.verifyDatasetRow.call(materials,doc,stripped,{}),{code:'MATERIAL_MISSING'});const missing=structuredClone(doc);delete missing.content.coordinateAlignments;await assert.rejects(ResearchMaterials.prototype.verifyDatasetRow.call(materials,missing,row,{}),{code:'MATERIAL_MISSING'});
 const {coordinateAlignment,...plain}=column,unscoped={content:{...doc.content,schemaIndex:await sequence('columns',[plain])}};await assert.rejects(ResearchMaterials.prototype.verifyDatasetRow.call(materials,unscoped,row,{}),{code:'MATERIAL_MISSING'});
});

test('coordinate alignment failures expose localized guidance without raw private error content',()=>{
 for(const suffix of ['INVALID','CONTEXT','ORDER','TIE']){const error=new CoordinateAlignmentError('DATASET_ALIGNMENT_'+suffix);error.message='private diagnostic';error.details=['private source'];const safe=safeError(error);assert.equal(safe.code,error.code);assert.deepEqual(safe.details,[]);assert.doesNotMatch(JSON.stringify(safe),/private diagnostic|private source/);assert.notEqual(safe.message,'IO');}
});
