import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import parser from 'stream-json/parser.js';
import {AppError} from './errors.js';
// Emit locations and exact scalar spellings. Unselected strings/numbers never
// accumulate in memory; even a very large visit remains a stream of leaves.
export async function* datasetJSONTokens(chunks,selected,limits,{signal}={}){
 const input=Readable.from(chunks),stream=parser.asStream({packValues:false});
 // Observe both stream ends. A rejected lookup can return from this generator
 // before parsing finishes; that cancellation must not become an uncaught error.
 const completion=pipeline(input,stream,{signal}).catch(()=>{});
 const fail=()=>{throw new AppError('MATERIAL_TABLE');},stack=[];
 let key='',keyChars=0,scalar=null;
 const location=()=>{const p=stack.at(-1);return {path:p?[...p.path,p.array?String(p.index):p.key]:[],arrays:stack.flatMap(s=>s.array?[s.path.length]:[])};};
 const finish=()=>{if(stack.at(-1)?.array)stack.at(-1).index++;};
 try{
  for await(const {name,value} of stream){
   signal?.throwIfAborted();
   if(name==='startKey'){key='';continue;}
   if(name==='stringChunk'||name==='numberChunk'){
    if(scalar){if(scalar.keep){scalar.value+=value;if(scalar.value.length>limits.rowChars)fail();}}
    else{key+=value;if(key.length>2048)fail();}continue;
   }
   if(name==='endKey'){const p=stack.at(-1);if(p.keys.has(key)||p.keys.size===limits.keys||(keyChars+=key.length)>limits.rowChars)fail();p.keyChars+=key.length;p.keys.add(key);p.key=key;continue;}
   if(name==='startArray'||name==='startObject'){
    const at=location(),type=name==='startArray'?'array':'object';if(selected(at))fail();
    yield {event:'begin',type,...at};if(stack.length>=limits.depth)fail();stack.push({...at,array:type==='array',index:0,key:null,keys:new Set(),keyChars:0});continue;
   }
   if(name==='endArray'||name==='endObject'){const p=stack.pop();keyChars-=p.keyChars;yield {event:'end',path:p.path,arrays:p.arrays};finish();continue;}
   if(name==='startString'||name==='startNumber'){const at=location();scalar={...at,keep:selected(at),kind:name==='startString'?'string':'number',value:''};continue;}
   if(name==='endString'||name==='endNumber'){yield {event:'value',...scalar};scalar=null;finish();continue;}
   if(['trueValue','falseValue','nullValue'].includes(name)){yield {event:'value',...location(),kind:value===null?'null':'boolean',value:value===null?'':String(value)};finish();}
  }
 }catch(error){if(signal?.aborted)throw signal.reason;if(error instanceof AppError)throw error;fail();}
 finally{input.destroy();stream.destroy();await completion;}
}
