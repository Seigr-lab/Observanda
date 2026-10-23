import {inspectJSONValue} from '../src/structured-inspection.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readPagedDataset} from '../src/dataset-paged-reader.js';
const source=text=>[Buffer.from(text)];
async function collect(text,mapping){
 const rows=[];let columns=[];
 for await(const item of readPagedDataset(source(text),mapping)){
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
