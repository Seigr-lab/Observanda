import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MaterialSequence} from '../src/material-sequence.js';
import {retainedTable,retainedTableBlocks} from '../src/retained-tables.js';
import {retainedTableHTML,retainPublicationTables} from '../src/publication-retained-tables.js';
import {retainedTableView} from '../src/web/retained-table-model.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultDomain} from '../src/web/measurement-domain-model.js';
import {blankUnitDefinition} from '../src/web/measurement-unit-model.js';
const ref={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},analysis=()=>({kind:'analysis',id:randomUUID(),revision:'b'.repeat(64)});
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
async function fixture(){
 const values=new Map(),sequences=new MaterialSequence({readMetadata:async key=>values.get(key)??null,writeMetadata:async(key,text)=>values.set(key,text)}),builder=sequences.builder('coordinate-frame-axes',fn=>fn()),axes=Array.from({length:19},(_,index)=>({id:randomUUID(),name:'Axis '+(index+1)+(index===18?' <last>':'')}));for(const axis of axes)await builder.append(axis);
 const axesIndex=await builder.finish(),column={...defaultColumn({label:'Selected position'}),representation:'domain',domain:{...defaultDomain('vector'),namespace:'Declared target coordinates',shape:[19]},unit:'m',quantity:{origin:'measured',conversion:null,calibration:null,unitDefinition:blankUnitDefinition()},coordinateFrame:{version:1,frame:analysis(),sourceFrame:analysis(),transform:analysis(),axesIndex}},columns=[column],calls=[],page=sequences.page.bind(sequences);sequences.page=async(value,options)=>{calls.push(options);return page(value,options);};
 const materials={sequences,read:async requested=>{assert.deepEqual(requested,ref,'Public capture may read only the selected result');return {content:{rowCount:1}};},retainedSchemaPage:async(_,options)=>({items:columns.slice(options.offset,options.offset+options.limit),total:1}),datasetPageCount:()=>1,retainedDatasetPage:async(_,page,{columns:indices})=>({columnIndices:indices,rows:[{cells:['[7, 22, ...]'],valueKinds:['string']}]})};
 const table=await retainedTable(materials,{ref,selection:{columns:'all',offset:0,count:null,includeExcluded:false},version:3});return {materials,column,axes,calls,table};
}
test('public framed results stream every ordered axis from owned snapshots without private document access',async()=>{
 const f=await fixture();let block;for await(const value of retainedTableBlocks(f.materials,{ref,table:f.table}))block=value.table;
 const preview=retainedTableView(block,esc);assert.match(preview,/Declared target coordinates/);assert.match(preview,/affine/i);
 let html='';for await(const part of retainedTableHTML(f.materials,{source:ref,table:f.table}))html+=part;
 let last=-1;for(const axis of f.axes){const at=html.indexOf(esc(axis.name));assert.ok(at>last,'All axes must occur in declared order');last=at;assert.ok(!html.includes(axis.id));}
 for(const privateRef of [f.column.coordinateFrame.frame,f.column.coordinateFrame.sourceFrame,f.column.coordinateFrame.transform])for(const privateValue of [privateRef.id,privateRef.revision])assert.ok(!html.includes(privateValue));
 assert.ok(!html.includes(f.column.coordinateFrame.axesIndex.root.hash));assert.match(html,/Axis 19 &lt;last&gt;/);assert.deepEqual(f.calls,[{offset:0,limit:16},{offset:16,limit:16}]);
 const chunks=[],recordId=randomUUID();await retainPublicationTables({append:async(_collection,_id,value)=>chunks.push(value)},f.materials,{results:{statements:[{id:randomUUID(),source:ref,table:f.table}]}},recordId);
 assert.equal(chunks.slice(0,-1).map(value=>value.text).join(''),html);assert.ok(chunks.slice(0,-1).every(value=>value.text.length<=4096));assert.equal(chunks.at(-1).count,chunks.length-1);
});
test('public frame export refuses incomplete axis snapshots and honours cancellation between pages',async()=>{
 const f=await fixture(),descriptor=f.column.coordinateFrame.axesIndex;f.column.coordinateFrame.axesIndex={...descriptor,count:18};await assert.rejects(async()=>{for await(const chunk of retainedTableHTML(f.materials,{source:ref,table:f.table}))void chunk;},{code:'JOB_DAMAGED'});
 f.column.coordinateFrame.axesIndex=descriptor;const controller=new AbortController(),page=f.materials.sequences.page.bind(f.materials.sequences);f.materials.sequences.page=async(...args)=>{const result=await page(...args);controller.abort();return result;};
 await assert.rejects(async()=>{for await(const chunk of retainedTableHTML(f.materials,{source:ref,table:f.table},{signal:controller.signal}))void chunk;},{name:'AbortError'});assert.equal(f.calls.length,1);
});
