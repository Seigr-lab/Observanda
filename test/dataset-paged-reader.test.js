import {inspectJSONValue} from '../src/structured-inspection.js';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {randomUUID} from 'node:crypto';
import {readPagedDataset} from '../src/dataset-paged-reader.js';
const source=text=>[Buffer.from(text)];
async function collect(text,mapping,reader=readPagedDataset,options={}){
 const rows=[];let columns=[];
 for await(const item of reader(source(text),mapping,options)){
  if(item.columns)columns=await Array.fromAsync(item.columns());
  else{const cells=[];for await(const value of item.cells()){let text='';for await(const chunk of value.read())text+=chunk;cells.push({kind:value.kind,value:text,pointer:value.pointer});}rows.push({...item,cells});}
 }
 return {columns,rows};
}
test('paged delimited ingestion retains wide schemas, long Unicode cells and source byte ranges',async()=>{
 const width=513,head=Array.from({length:width},(_,i)=>'column '+i),values=head.map((_,i)=>String(i));values[512]='start '+('\u{1f36f},line\r\n'.repeat(40000))+' finish';
 const csv=head.join(',')+'\r\n'+values.map(v=>'"'+v.replaceAll('"','""')+'"').join(',')+'\r\n';
 const result=await collect(csv,{format:'delimited',delimiter:',',header:true});
 assert.equal(result.columns.length,width);assert.equal(result.rows.length,1);assert.equal(result.rows[0].cells[512].value,values[512]);assert.equal(result.rows[0].cells[0].value,'0');assert.equal(result.rows[0].locator.line,2);
 assert.equal(result.rows[0].locator.byteOffset,Buffer.byteLength(head.join(',')+'\r\n'));assert.equal(result.rows[0].locator.byteLength,Buffer.byteLength(csv)-result.rows[0].locator.byteOffset-1);
});
test('paged JSON preserves wide missing/null semantics and structured values without scalar conversion',async()=>{
 const fields=Array.from({length:513},(_,i)=>({name:'f'+i,path:'/f'+i})),object=Object.fromEntries(fields.slice(0,-2).map((f,i)=>[f.name,i]));object.f510=null;object.f511={counter:'18446744073709551615',values:[true,null,'x'.repeat(300000)]};
 const result=await collect(JSON.stringify({rows:[object]}),{format:'json',rowsPath:'/rows',fields});
 assert.equal(result.columns.length,513);assert.equal(result.rows[0].cells[510].kind,'null');assert.equal(result.rows[0].cells[512].kind,'absent');assert.equal(result.rows[0].cells[511].kind,'object');assert.deepEqual(JSON.parse(result.rows[0].cells[511].value),object.f511);assert.equal(result.rows[0].cells[511].pointer,'/rows/0/f511');
});
test('nested packed joins retain wide per-cell pointers and reject late duplicate object keys',async()=>{
 const width=301,fields=[{name:'id',path:'/id'},...Array.from({length:width},(_,i)=>({name:'slot '+i,source:'packed',path:'/'+i})),{name:'context',source:'context',path:'/visits/*/note'}],mapping={format:'json-nested',rowsPath:'/visits/*/rows',fields,joins:[{name:'packed',mode:'position',rowsPath:'/visits/*/packed',packed:{offset:0,width,count:2}}]};
 const text=JSON.stringify({visits:[{note:'retained',rows:[{id:1},{id:2}],packed:Array.from({length:width*2},(_,i)=>i)}]}),result=await collect(text,mapping);
 assert.equal(result.rows.length,2);assert.equal(result.rows[1].cells[width].value,String(width*2-1));assert.equal(result.rows[1].cells[width].pointer,'/visits/0/packed/'+(width*2-1));assert.equal(result.rows[1].cells.at(-1).value,'retained');
 const keys=Array.from({length:4200},(_,i)=>'"p'+i+'":'+i).join(',');await assert.rejects(collect('{"rows":[{'+keys+',"p4199":0}]}',{format:'json',rowsPath:'/rows',fields:[{name:'last',path:'/p4199'}]}),{code:'MATERIAL_TABLE'});
});
test('paged JSONL validates physical records, deep selected locations and cancellation',async()=>{
 const mapping={format:'jsonl',fields:[{name:'value',path:'/v'}]};for(const text of ['{"v":1}\n\n{"v":2}','{"v":1} {}\n','{"v":\n1}\n'])await assert.rejects(collect(text,mapping),{code:'MATERIAL_TABLE'});
 const result=await collect('{"v":18446744073709551615}\r\n{"v":-0}\n',mapping);assert.equal(result.rows[0].cells[0].value,'18446744073709551615');assert.equal(result.rows[1].cells[0].value,'-0');assert.deepEqual(result.rows[1].locator,{format:'jsonl',line:2});
 const depth=80,deep=await collect('{"rows":['+'{"a":'.repeat(depth)+'42'+'}'.repeat(depth)+']}',{format:'json',rowsPath:'/rows',fields:[{name:'value',path:'/a'.repeat(depth)}]});assert.equal(deep.rows[0].cells[0].value,'42');
 const controller=new AbortController();controller.abort();await assert.rejects(async()=>{for await(const value of readPagedDataset(source('a\n1'),{}, {signal:controller.signal}))void value;},{name:'AbortError'});
});

test('automatic JSON schema discovery pages source keys without a schema-sized command',async()=>{
 const first=Object.fromEntries(Array.from({length:620},(_,i)=>['c'+i,i]));first.payload={nested:[null,true,'exact']};
 const result=await collect(JSON.stringify({rows:[first,{late:2,c619:null}]}),{format:'json',rowsPath:'/rows',fields:'all'});
 assert.equal(result.columns.length,622);assert.equal(result.rows[0].cells[621].kind,'absent');assert.equal(result.rows[1].cells[619].kind,'null');assert.equal(result.rows[1].cells[621].value,'2');assert.equal(result.rows[0].cells[620].kind,'object');
 const literal=await collect('{"*": [{"v":5}]}',{format:'json',rowsPath:'/*',fields:[{name:'v',path:'/v'}]});assert.equal(literal.rows[0].cells[0].value,'5');
});

test('nested lookup identity is independent of UTF-16 surrogate token boundaries',async()=>{
 const spelling='a'.repeat(16383)+'\u{1f36f}'+'z'.repeat(17000),escaped=spelling.replaceAll('\u{1f36f}','\\ud83c\\udf6f');
 const text='{"rows":[{"key":'+JSON.stringify(spelling)+'}],"lookup":[{"key":"'+escaped+'","value":42}]}';
 const mapping={format:'json-nested',rowsPath:'/rows',fields:[{name:'expected',source:'lookup',path:'/value'}],joins:[{name:'lookup',rowsPath:'/lookup',leftPath:'/key',rightPath:'/key'}]};
 const data=await collect(text,mapping);assert.equal(data.rows[0].cells[0].value,'42');
});


test('original JSON inspection bounds long structured values and retains exact numeric tokens',async()=>{
 const long='\u{1f36f}'.repeat(40000),json='{"value":{"number":18446744073709551615,"negative":-0,"long":'+JSON.stringify(long)+',"null":null}}',rendered=json.slice(9,-1);
 const page=await inspectJSONValue(source(json),'/value',{offset:4200,limit:4096});assert.equal(page.text,rendered.slice(4200,8296));assert.equal(page.total,rendered.length);assert.equal(page.next,8296);
 assert.equal((await inspectJSONValue(source(json),'/value/number')).text,'18446744073709551615');assert.equal((await inspectJSONValue(source(json),'/value/negative')).text,'-0');await assert.rejects(inspectJSONValue(source('{"value":1,"value":2}'),'/value'),{code:'MATERIAL_TABLE'});
 let closed=false;const controller=new AbortController();async function* interrupted(){try{yield Buffer.from('"long');controller.abort();yield Buffer.from('value",other\n');}finally{closed=true;}}
 await assert.rejects(async()=>{for await(const value of readPagedDataset(interrupted(),{format:'delimited',delimiter:'auto',header:false},{signal:controller.signal}))void value;},{name:'AbortError'});assert.equal(closed,true);
});

// Exercise the real parser with only its encrypted scratch transport replaced.
// These focused tests can run without opening a native PostgreSQL runtime.
const schemaModule=new URL('../src/dataset-paged-reader.js?schema-cache-test',import.meta.url).href,schemaKey='schemaWork_'+randomUUID().replaceAll('-','');
let currentSchemaWork;
globalThis[schemaKey]=async function*(create,{signal}={}){const work=currentSchemaWork;try{signal?.throwIfAborted();yield* create(work);}finally{work.closed=true;}};
const schemaHooks=registerHooks({resolve(specifier,context,next){return context.parentURL===schemaModule&&specifier==='./scratch-iterator.js'?{url:'schema-cache:scratch',shortCircuit:true}:next(specifier,context);},load(url,context,next){return url==='schema-cache:scratch'?{format:'module',shortCircuit:true,source:'export const scratchIterator=(create,options)=>globalThis['+JSON.stringify(schemaKey)+'](create,options);'}:next(url,context);}});
let schemaReader;try{({readPagedDataset:schemaReader}=await import(schemaModule));}finally{schemaHooks.deregister();}
after(()=>{delete globalThis[schemaKey];});
function schemaFixture({onGet,onPut,onGetMany,onPutMany,onPutManyComplete}={}){
 const stored=new Map(),reads=new Map(),writes=[],readBatches=[],writeBatches=[];
 const work={closed:false,async get(key){reads.set(key,(reads.get(key)??0)+1);const value=structuredClone(stored.get(key));await onGet?.(key,value);return value;},async getMany(keys){assert.ok(keys.length>0&&keys.length<=32);assert.equal(new Set(keys).size,keys.length);readBatches.push([...keys]);for(const key of keys)reads.set(key,(reads.get(key)??0)+1);const result=new Map([...keys].reverse().filter(key=>stored.has(key)).map(key=>[key,structuredClone(stored.get(key))]));await onGetMany?.(result,keys);return result;},async put(key,value){await onPut?.(key,value);writes.push(key);stored.set(key,structuredClone(value));},async putMany(entries){assert.ok(entries.length>0&&entries.length<=32);assert.equal(new Set(entries.map(([key])=>key)).size,entries.length);const bytes=entries.reduce((n,[key,value])=>n+Buffer.byteLength(key)+Buffer.byteLength(JSON.stringify(value)),0);assert.ok(bytes<=256*1024);await onPutMany?.(entries);writeBatches.push({keys:entries.map(([key])=>key),bytes});for(const [key,value]of entries)stored.set(key,structuredClone(value));await onPutManyComplete?.(entries);},async add(key,value=true){if(stored.has(key))return false;stored.set(key,structuredClone(value));return true;}};
 const reader=(bytes,mapping,options)=>{currentSchemaWork=work;return schemaReader(bytes,mapping,options);};
 return {work,stored,reads,writes,readBatches,writeBatches,reader,collect:(text,mapping,options)=>collect(text,mapping,reader,options)};
}

test('schema cache reuses metadata and misses across rows without retaining cell payloads',async()=>{
 const f=schemaFixture(),fields=Array.from({length:4},(_,i)=>({name:'c'+i,path:'/c'+i})),rows=Array.from({length:80},(_,row)=>Object.fromEntries(fields.map((field,col)=>[field.name,row*4+col]))),result=await f.collect(rows.map(row=>JSON.stringify(row)).join('\n'),{format:'jsonl',fields});
 assert.equal(result.rows.length,rows.length);assert.deepEqual(result.columns.map(c=>c.sourceField),fields);
 for(let row=0;row<rows.length;row++)for(let col=0;col<fields.length;col++){assert.deepEqual(result.rows[row].cells[col],{kind:'number',value:String(row*4+col),pointer:'/'+row+'/c'+col});assert.equal(f.reads.get('value:row:/'+row+':field:'+col),1);}
 for(let col=0;col<fields.length;col++){assert.equal(f.reads.get('field:row:/c'+col),1);assert.equal(f.reads.get('field-next:'+col)??0,0);assert.equal(f.reads.get('column:'+col)??0,0);}
 assert.equal(f.reads.get('field:row:'),1);assert.equal([...f.reads.keys()].some(key=>key.startsWith('field:context:')),false);assert.equal(f.work.closed,true);
});

test('schema cache updates aliases and discovered fields after cached misses',async()=>{
 const aliases=schemaFixture(),result=await aliases.collect('{"rows":[{"v":1},{"v":null},{}]}',{format:'json-nested',rowsPath:'/rows',fields:[{name:'first',path:'/v'},{name:'second',path:'/v'},{name:'third',path:'/v'}]});
 assert.deepEqual(result.rows.map(row=>row.cells.map(cell=>[cell.kind,cell.value])),[[['number','1'],['number','1'],['number','1']],[['null',''],['null',''],['null','']],[['absent',''],['absent',''],['absent','']]]);assert.equal(aliases.reads.get('field:row:/v'),1);
 const discovery=schemaFixture(),found=await discovery.collect('{"rows":[{"a":1},{"late":2,"a":null},{"late":3}]}',{format:'json',rowsPath:'/rows',fields:'all'});
 assert.deepEqual(found.columns.map(column=>column.name),['a','late']);assert.deepEqual(found.rows.map(row=>row.cells.map(cell=>[cell.kind,cell.value])),[[['number','1'],['absent','']],[['null',''],['number','2']],[['absent',''],['number','3']]]);
 assert.equal(discovery.reads.get('field:row:/late'),1);
});

test('schema cache keeps row, context, keyed and packed join fields distinct',async()=>{
 const f=schemaFixture(),mapping={format:'json-nested',rowsPath:'/visits/*/rows',fields:[{name:'row',path:'/value'},{name:'lookup',source:'lookup',path:'/value'},{name:'packed',source:'packed',path:'/1'},{name:'note',source:'context',path:'/visits/*/note'}],joins:[{name:'lookup',rowsPath:'/visits/*/lookup',leftPath:'/id',rightPath:'/id'},{name:'packed',mode:'position',rowsPath:'/visits/*/packed',packed:{offset:0,width:2,count:2}}]},visits=Array.from({length:2},(_,i)=>({note:'visit '+i,rows:[{id:1,value:'row '+i},{id:2,value:null}],lookup:[{id:2,value:'second '+i},{id:1,value:'first '+i}],packed:[0,i+10,1,i+20]})),result=await f.collect(JSON.stringify({visits}),mapping);
 assert.deepEqual(result.rows.map(row=>row.cells.map(cell=>cell.value)),[['row 0','first 0','10','visit 0'],['','second 0','20','visit 0'],['row 1','first 1','11','visit 1'],['','second 1','21','visit 1']]);
 assert.equal(result.rows[3].cells[2].pointer,'/visits/1/packed/3');assert.equal(result.rows[3].cells[3].pointer,'/visits/1/note');assert.equal(f.reads.get('context:/visits/1/note'),2);
 assert.ok([...f.reads.keys()].some(key=>key.startsWith('field:context:')));
});

test('schema cache refreshes active fields during churn and rereads evicted wide schemas',async()=>{
 const hot=schemaFixture(),fields=Array.from({length:20},(_,i)=>({name:'c'+i,path:'/c'+i})),rows=Array.from({length:100},(_,i)=>({c0:i,['extra'+i]:i})),result=await hot.collect(JSON.stringify({rows}),{format:'json',rowsPath:'/rows',fields});
 assert.deepEqual(result.rows.map(row=>row.cells[0].value),rows.map(row=>String(row.c0)));assert.equal(hot.reads.get('field:row:/c0'),1);assert.equal(hot.reads.get('field-next:0')??0,0);
 const wide=schemaFixture(),wideFields=Array.from({length:70},(_,i)=>({name:'f'+i,path:'/f'+i})),iterator=wide.reader(source('{"rows":[{}]}'),{format:'json',rowsPath:'/rows',fields:wideFields});
 try{const {value:schema}=await iterator.next(),first=await Array.fromAsync(schema.columns()),second=await Array.fromAsync(schema.columns());assert.deepEqual(first,second);assert.equal(first.length,70);assert.equal(wide.reads.get('column:0'),2);}finally{await iterator.return();}
 assert.equal(wide.work.closed,true);
});

test('schema cache includes UTF-8 keys in its byte bound and isolates returned columns',async()=>{
 const bounded=schemaFixture(),fields=Array.from({length:21},(_,i)=>({name:'名'.repeat(196)+i,path:'/'+'観'.repeat(2040)+i})),iterator=bounded.reader(source('{"rows":[{}]}'),{format:'json',rowsPath:'/rows',fields});
 try{const {value:schema}=await iterator.next(),columns=await Array.fromAsync(schema.columns());assert.equal(columns.length,21);assert.deepEqual(columns.map(column=>column.sourceField),fields);assert.equal(bounded.reads.get('column:0'),1,'key bytes must cause eviction before the 64-entry bound');}finally{await iterator.return();}
 const isolated=schemaFixture(),reader=isolated.reader(source('{"rows":[{"v":42}]}'),{format:'json',rowsPath:'/rows',fields:[{name:'value',path:'/v'}]});
 try{const {value:schema}=await reader.next(),first=await Array.fromAsync(schema.columns());first[0].name='changed';first[0].sourceField.path='/wrong';const second=await Array.fromAsync(schema.columns());assert.equal(second[0].name,'value');assert.equal(second[0].sourceField.path,'/v');const {value:row}=await reader.next(),cells=await Array.fromAsync(row.cells());assert.equal(cells[0].value,'42');assert.equal(cells[0].pointer,'/rows/0/v');}finally{await reader.return();}
});

test('schema cache cancellation covers hits and completed scratch reads',async()=>{
 const controller=new AbortController(),reason=Error('cancel schema traversal'),f=schemaFixture(),iterator=f.reader(source('{"rows":[{"v":1}]}'),{format:'json',rowsPath:'/rows',fields:[{name:'v',path:'/v'}]},{signal:controller.signal});
 try{const {value:schema}=await iterator.next();await Array.fromAsync(schema.columns());controller.abort(reason);await assert.rejects(Array.fromAsync(schema.columns()),error=>error===reason);assert.equal(f.reads.get('column:0')??0,0);}finally{await iterator.return();}
 assert.equal(f.work.closed,true);
 const stopped=new AbortController(),interrupted=schemaFixture({onGet:key=>{if(key==='field:row:/v')stopped.abort(reason);}});
 await assert.rejects(interrupted.collect('{"v":1}',{format:'jsonl',fields:[{name:'v',path:'/v'}]},{signal:stopped.signal}),error=>error===reason);assert.equal(interrupted.writes.length,0);assert.equal(interrupted.work.closed,true);
});

test('schema cache write failures stop aliases before exposing a partial dataset',async()=>{
 const reason=Error('schema write failed');let aliases=0;
 const f=schemaFixture({onPut:key=>{if(key==='field:row:/v'&&++aliases===2)throw reason;}});
 await assert.rejects(f.collect('{"rows":[{"v":1}]}',{format:'json-nested',rowsPath:'/rows',fields:[{name:'first',path:'/v'},{name:'second',path:'/v'}]}),error=>error===reason);
 assert.equal(f.writes.includes('column:1'),false);assert.equal(f.writes.some(key=>key.startsWith('row:')),false);assert.equal(f.work.closed,true);
});

test('scratch batching flushes all JSONL values before publishing schema and reads one cell window per row',async()=>{
 const notes='Synthetic acquired detail. '.repeat(165),fields=['reading','counter','native','notes'].map(name=>({name,path:'/'+name})),rows=Array.from({length:67},(_,i)=>({reading:i%4,counter:'18446744073709551615',native:'105',notes})),f=schemaFixture(),iterator=f.reader(source(rows.map(row=>JSON.stringify(row)).join('\n')),{format:'jsonl',fields});
 const {value:schema}=await iterator.next();assert.equal(schema.columnCount,4);assert.equal(f.stored.has('row:66'),true);assert.equal(f.stored.get('value:row:/66:field:3').value,notes);
 assert.equal(f.writeBatches.length,Math.ceil((rows.length*5+2)/32));assert.ok(f.writeBatches.slice(0,-1).every(batch=>batch.keys.length===32));assert.equal(f.writes.some(key=>/^(row|value|text):/.test(key)),false);
 let order=0;for await(const row of iterator){const cells=await Array.fromAsync(row.cells());assert.deepEqual(cells.map(cell=>cell.value),[String(order%4),'18446744073709551615','105',notes]);assert.deepEqual(row.locator,{format:'jsonl',line:++order});}
 assert.equal(order,rows.length);assert.equal(f.readBatches.length,rows.length);assert.ok(f.readBatches.every(keys=>keys.length===4));assert.equal(f.work.closed,true);
});

test('scratch batching bounds UTF-8 write bytes while retaining long scalar and structured chunks',async()=>{
 const fields=Array.from({length:20},(_,i)=>({name:'c'+i,path:'/c'+i})),row=Object.fromEntries(fields.map(field=>[field.name,'\u754c'.repeat(12000)]));row.c19={exact:'18446744073709551615',nested:[null,true,'\u{1f41d}'.repeat(40000)]};
 const f=schemaFixture(),result=await f.collect(JSON.stringify({rows:[row]}),{format:'json',rowsPath:'/rows',fields});
 assert.equal(result.rows.length,1);for(let i=0;i<19;i++)assert.equal(result.rows[0].cells[i].value,row['c'+i]);assert.deepEqual(JSON.parse(result.rows[0].cells[19].value),row.c19);assert.equal(result.rows[0].cells[19].kind,'object');
 assert.ok(f.writeBatches.some(batch=>batch.keys.length<32&&batch.bytes>200000));assert.ok(f.writeBatches.flatMap(batch=>batch.keys).some(key=>key.startsWith('text:')));assert.equal(f.writes.some(key=>key.startsWith('text:')),false);assert.deepEqual(f.readBatches.map(keys=>keys.length),[20]);
});

test('scratch batching preserves wide cell order, missing values and duplicate context selections',async()=>{
 const f=schemaFixture(),fields=Array.from({length:70},(_,i)=>({name:'c'+i,path:'/c'+i})),result=await f.collect('{"rows":[{"c0":0,"c32":null,"c69":{"values":[1,2]}},{}]}',{format:'json',rowsPath:'/rows',fields});
 assert.deepEqual(f.readBatches.map(keys=>keys.length),[32,32,6,32,32,6]);assert.equal(result.rows[0].cells[0].value,'0');assert.equal(result.rows[0].cells[32].kind,'null');assert.equal(result.rows[0].cells[69].value,'{"values":[1,2]}');assert.ok(result.rows[1].cells.every(cell=>cell.kind==='absent'));
 const nested=schemaFixture(),mapping={format:'json-nested',rowsPath:'/rows',fields:[{name:'note1',source:'context',path:'/note'},{name:'note2',source:'context',path:'/note'},{name:'looked up',source:'lookup',path:'/v'}],joins:[{name:'lookup',rowsPath:'/lookup',leftPath:'/id',rightPath:'/id',unmatched:'keep'}]},joined=await nested.collect('{"note":"kept","rows":[{"id":1},{"id":2}],"lookup":[{"id":1,"v":42}]}',mapping);
 assert.deepEqual(joined.rows.map(row=>row.cells.map(cell=>cell.value)),[['kept','kept','42'],['kept','kept','']]);assert.equal(joined.rows[1].cells[2].kind,'absent');assert.deepEqual(nested.readBatches.map(keys=>keys.length),[2,1]);assert.equal(nested.reads.get('value:lookup:/lookup/0:key')??0,0,'join completion reads its pending key');
});

test('scratch batching leaves duplicate detection authoritative and discards pending values on parse or alignment failure',async()=>{
 const fields=Array.from({length:70},(_,i)=>({name:'f'+i,path:'/f'+i})),text='{"rows":[{'+fields.map((field,i)=>JSON.stringify(field.name)+':'+i).join(',')+',"f69":0}]}',duplicate=schemaFixture();
 await assert.rejects(duplicate.collect(text,{format:'json',rowsPath:'/rows',fields}),{code:'MATERIAL_TABLE'});assert.equal(duplicate.writeBatches.length,2);assert.equal(duplicate.stored.has('value:row:/rows/0:field:69'),false);assert.equal(duplicate.stored.has('row:0'),false);assert.equal(duplicate.work.closed,true);
 const joined=schemaFixture(),mapping={format:'json-nested',rowsPath:'/rows',fields:[{name:'value',source:'lookup',path:'/v'}],joins:[{name:'lookup',rowsPath:'/lookup',leftPath:'/id',rightPath:'/id'}]};
 await assert.rejects(joined.collect('{"rows":[{"id":1}],"lookup":[{"id":1,"v":10},{"id":1,"v":20}]}',mapping),{code:'DATASET_JOIN_DUPLICATE'});assert.equal(joined.writeBatches.length,0);assert.equal(joined.work.closed,true);
 const alignment=schemaFixture();await assert.rejects(alignment.collect('{"rows":[{}],"lookup":[{},{}]}',{...mapping,joins:[{name:'lookup',rowsPath:'/lookup',mode:'position'}]}),{code:'DATASET_JOIN_LENGTH'});assert.equal(alignment.writeBatches.length,0);assert.equal(alignment.work.closed,true);
});

test('scratch batching write failures and cancellation expose no parsed dataset and never flush during cleanup',async()=>{
 const fields=[{name:'v',path:'/v'}],text=Array.from({length:40},(_,i)=>'{"v":'+i+'}').join('\n'),reason=Error('scratch batch failed');let attempts=0;
 const failed=schemaFixture({onPutMany:()=>{if(++attempts===2)throw reason;}}),iterator=failed.reader(source(text),{format:'jsonl',fields});
 await assert.rejects(iterator.next(),error=>error===reason);assert.equal(attempts,2);assert.equal(failed.writeBatches.length,1);assert.equal(failed.stored.has('row:15'),true);assert.equal(failed.stored.has('row:16'),false);assert.equal(failed.work.closed,true);
 const controller=new AbortController(),cancelled=schemaFixture({onPutManyComplete:()=>controller.abort(reason)}),stopped=cancelled.reader(source(text),{format:'jsonl',fields},{signal:controller.signal});
 await assert.rejects(stopped.next(),error=>error===reason);assert.equal(cancelled.writeBatches.length,1);assert.equal(cancelled.work.closed,true);
});

test('scratch batching checks cancellation after a cell window read before yielding its values',async()=>{
 const controller=new AbortController(),reason=Error('cancel cell window'),f=schemaFixture({onGetMany:()=>controller.abort(reason)}),iterator=f.reader(source('{"v":1}'),{format:'jsonl',fields:[{name:'v',path:'/v'}]},{signal:controller.signal});
 try{await iterator.next();const {value:row}=await iterator.next();await assert.rejects(row.cells().next(),error=>error===reason);assert.equal(f.readBatches.length,1);}finally{await iterator.return();}assert.equal(f.work.closed,true);
});
