import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DATASET_TEXT_CHARS} from '../src/dataset-cell-storage.js';
import {datasetTextStream} from '../src/dataset-text-stream.js';
import {datasetExchangeSelection,delimitedDataset} from '../src/dataset-exchange-table.js';

async function text(stream){
 let result='';
 for await(const chunk of stream)result+=chunk;
 return result;
}

test('long source spelling preserves a surrogate crossing native parts and checks the original digest',async()=>{
 const spelling='x'.repeat(DATASET_TEXT_CHARS-1)+'🌿,quoted\n"field"';
 const parts=[spelling.slice(0,DATASET_TEXT_CHARS),spelling.slice(DATASET_TEXT_CHARS)];
 const cell={format:'dataset-cell',version:1,characters:spelling.length,sha256:createHash('sha256').update(Buffer.from(spelling,'utf16le')).digest('hex'),parts:{kind:'cell-text',count:parts.length}};
 const materials={sequences:{validate(){},async* items(){yield* parts;}}};
 const pieces=[];
 for await(const part of datasetTextStream(materials,cell))pieces.push(Buffer.from(part));
 assert.equal(Buffer.concat(pieces).toString('utf8'),spelling);
 parts[1]=parts[1].replace('quoted','edited');
 await assert.rejects(text(datasetTextStream(materials,cell)),{code:'MATERIAL_MISSING'});
});

test('delimited exchange seeks the chosen rows and columns and treats an excluded observation as its original position',async()=>{
 const source={kind:'dataset',content:{datasetFormat:3,schemaIndex:{count:3210},rowCount:1000000}};
 const request=datasetExchangeSelection(source,{offset:999997,count:3,columns:[{offset:3209,count:1}],includeExcluded:false});
 const read=[];
 const cells={kind:'cells',count:3210};
 const materials={
  datasetPageCount:()=>15625,
  datasetRowPosition:async(_doc,{offset})=>({ordinal:offset,page:15624,row:61}),
  retainedDatasetPage:async(_doc,page)=>{assert.equal(page,15624);return {rows:Array.from({length:64},(_,i)=>({excluded:i===62?'instrument offline':null,cellIndex:cells}))};},
  retainedSchemaPage:async(_doc,{offset,limit})=>{read.push([offset,limit]);return {items:[{name:'=formula'}]};},
  sequences:{validate(){},page:async(_index,{offset,limit})=>{read.push([offset,limit]);return {items:[{kind:'string',value:'9007199254740993'}]};}}
 };
 assert.equal(await text(delimitedDataset(materials,source,request,{format:'csv'})),'"\'=formula"\r\n"9007199254740993"\r\n"9007199254740993"\r\n');
 assert.deepEqual(read,[[3209,1],[3209,1],[3209,1]]);
 assert.throws(()=>datasetExchangeSelection(source,{...request,columns:[{offset:3209,count:2}]}),{code:'INVALID'});
});
