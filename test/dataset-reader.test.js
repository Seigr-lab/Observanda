import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readDataset,DATASET_LIMITS} from '../src/dataset-reader.js';
async function collect(text,mapping={},chunk=7){
 const bytes=Buffer.from(text);async function* source(){for(let i=0;i<bytes.length;i+=chunk)yield bytes.subarray(i,i+chunk);}
 const events=[];for await(const event of readDataset(source(),mapping))events.push(event);return events;
}
test('streamed delimited rows preserve quoted fields, UTF-8, line identities and explicit separators',async()=>{
 const events=await collect('\ufeffTake,Note,Counter\r\nOne,"A ""quiet""\nphrase \u266b",18446744073709551615\r\nTwo,,2\r\n');
 assert.deepEqual(events[0].columns,['Take','Note','Counter']);
 assert.deepEqual(events[1].cells,['One','A "quiet"\nphrase \u266b','18446744073709551615']);
 assert.equal(events[1].line,2);assert.equal(events[2].line,4);
 assert.deepEqual((await collect('a|b\n1|2',{delimiter:'|'}))[1].cells,['1','2']);
 assert.deepEqual((await collect('15\n20',{header:false})).map(e=>e.cells).filter(Boolean),[['15'],['20']]);
});
test('JSON mappings retain exact numeric lexemes, native strings, nulls, missing values and pointers',async()=>{
 const mapping={format:'json',rowsPath:'/acquisition/rows',fields:[{name:'Counter',path:'/counter'},{name:'Senary',path:'/native'},{name:'Level',path:'/level'},{name:'Escaped',path:'/a~1b/~0c'}]};
 const events=await collect('{"ignore":"unused","acquisition":{"rows":[{"counter":18446744073709551615,"native":"15","level":1.2300e+02,"a/b":{"~c":true}},{"counter":-0,"level":null}]}}',mapping,1);
 assert.deepEqual(events[1].cells,['18446744073709551615','15','1.2300e+02','true']);
 assert.deepEqual(events[2].valueKinds,['number','absent','null','absent']);
 assert.equal(events[1].locator.pointer,'/acquisition/rows/0');assert.equal(events[2].cells[0],'-0');
});
test('JSONL maps each physical line and rejects multiple values or blank lines',async()=>{
 const mapping={format:'jsonl',fields:[{name:'Value',path:'/v'}]};
 const rows=await collect('{"v":18446744073709551615}\r\n{"v":"15"}\n',mapping);
 assert.equal(rows[1].cells[0],'18446744073709551615');assert.deepEqual(rows[2].locator,{format:'jsonl',line:2});
 for(const source of ['{}\n\n{}','{} {}\n','{"v":1}\n{"v":'])await assert.rejects(collect(source,mapping),{code:'MATERIAL_TABLE'});
});
test('streaming rejects ambiguous, malformed and oversized mappings without partial success',async()=>{
 const mapping={format:'json',rowsPath:'/rows',fields:[{name:'Value',path:'/v'}]};
 for(const source of ['{"rows":[{"v":1,"v":2}]}','{"rows":[{"v":{}}]}','{"rows":[]}','{"rows":[{"v":1}]}x','{"other":[]}','{"rows":[{"v":1}],"rows":[]}'])
  await assert.rejects(collect(source,mapping),{code:'MATERIAL_TABLE'});
 for(const source of ['a,b\n"x,y','a,b\n1,2,3'])await assert.rejects(collect(source),{code:'MATERIAL_TABLE'});
 await assert.rejects(collect('a\n'+'x'.repeat(DATASET_LIMITS.rowChars+1),{},16384),{code:'MATERIAL_TABLE'});
 await assert.rejects(collect('['.repeat(65)+'0'+']'.repeat(65),{format:'json',fields:[{name:'Value',path:''}]}),{code:'MATERIAL_TABLE'});
});
test('large unselected JSON strings are skipped while rows remain bounded and cancellation stops input',async()=>{
 const mapping={format:'json',rowsPath:'/rows',fields:[{name:'Value',path:'/v'}]};
 async function* source(){yield Buffer.from('{"padding":"');for(let i=0;i<1100;i++)yield Buffer.alloc(16384,0x61);yield Buffer.from('","rows":[{"v":42}]}');}
 const rows=[];for await(const row of readDataset(source(),mapping))rows.push(row);assert.equal(rows[1].cells[0],'42');
 const controller=new AbortController();controller.abort();
 await assert.rejects(async()=>{for await(const row of readDataset(source(),mapping,{signal:controller.signal})){void row;}},{name:'AbortError'});
});

test('CRLF inside a quoted field stays byte-equivalent as a decoded value',async()=>{
 for(const chunk of [1,2,7,64])assert.deepEqual((await collect('Name,Text\r\nOne,"A\r\nB\rc"\r\n',{},chunk))[1].cells,['One','A\r\nB\rc']);
});
test('invalid UTF-8 and duplicate JSONL keys are rejected',async()=>{
 await assert.rejects(async()=>{for await(const item of readDataset([Buffer.from([0xc3,0x28])])){void item;}},{code:'MATERIAL_TABLE'});
 await assert.rejects(collect('{"v":1,"v":2}\n',{format:'jsonl',fields:[{name:'Value',path:'/v'}]}),{code:'MATERIAL_TABLE'});
});
