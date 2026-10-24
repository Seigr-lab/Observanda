import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Measurements} from '../src/measurements.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {retainDatasetCell} from '../src/dataset-cell-storage.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
const ref={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},locator=(row=9,column=17)=>({ref,selector:{kind:'cell',page:0,row,column}});

test('measurement reads project only the selected retained row and preserve its exact context',async()=>{
 const stored=new Map(),sequences=new MaterialSequence({readMetadata:async name=>stored.get(name)??null,writeMetadata:async(name,text)=>stored.set(name,text)}),rows=[],column={...defaultColumn({label:'Selected coordinate'}),representation:'radix',radix:6,unit:'declared ticks'},long='0'.repeat(9000)+'12';
 const retained=await retainDatasetCell({sequences},{kind:'string',value:long},fn=>fn());
 for(let row=0;row<18;row++){const cells=sequences.builder('cells',fn=>fn());for(let col=0;col<18;col++)await cells.append(row===9&&col===17?retained:{kind:'string',value:String(row*18+col)});rows.push({id:'row-'+row,order:row+1,excluded:row===9?'Selected for inspection':null,cellIndex:await cells.finish()});}
 const doc={kind:'dataset',content:{datasetFormat:3,schemaIndex:{count:18}}},reads=[],originalPage=sequences.page.bind(sequences);sequences.page=async(descriptor,options)=>{if(descriptor.kind==='cells'){reads.push({root:descriptor.root.hash,...options});assert.equal(descriptor.root.hash,rows[9].cellIndex.root.hash,'An unrelated row must not be projected');}return originalPage(descriptor,options);};
 const materials={sequences,read:async selected=>{assert.deepEqual(selected,ref);return doc;},retainedDatasetPage:async(selected,page,options)=>{assert.equal(selected,doc);assert.equal(page,0);assert.deepEqual(options,{metadataOnly:true});return {rows};},retainedSchemaPage:async(selected,options)=>{assert.equal(selected,doc);assert.deepEqual(options,{offset:17,limit:1});return {items:[column]};}};
 const result=await new Measurements(materials).cell(locator());assert.equal(result.pageRows,18);assert.equal(result.row.id,'row-9');assert.equal(result.row.excluded,'Selected for inspection');assert.deepEqual(result.cellReference,retained.value);assert.deepEqual(result.value,{spelling:'',representation:'radix',radix:6,unit:'declared ticks',presence:'value'});assert.deepEqual(result.row.columnIndices,[17]);assert.equal(reads.length,1);assert.equal(reads[0].offset,16);assert.equal(reads[0].limit,16);
 await assert.rejects(new Measurements(materials).cell(locator(18)),{code:'MEASUREMENT_INVALID'});assert.equal(reads.length,1);
 const denied=Object.assign(new Error('Unavailable'),{code:'ACCESS_DENIED'});materials.read=async()=>{throw denied;};await assert.rejects(new Measurements(materials).cell(locator()),error=>error===denied);
});

test('earlier retained rows preserve explicit missing/null semantics through the existing reader',async()=>{
 const column=defaultColumn({label:'Observation'}),rows=[{id:'null',cells:[''],valueKinds:['null']},{id:'missing',cells:[''],valueKinds:['string']}],doc={content:{datasetFormat:2}},materials={read:async()=>doc,retainedDatasetPage:async(_,page,options)=>{assert.equal(page,0);assert.deepEqual(options,{columns:[17]});return {rows};},retainedSchemaPage:async()=>({items:[column]})},measurements=new Measurements(materials);
 assert.equal((await measurements.cell(locator(0))).value.presence,'null');assert.equal((await measurements.cell(locator(1))).value.presence,'missing');assert.equal((await measurements.cell(locator(1))).pageRows,2);
});
