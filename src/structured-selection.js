import {Readable} from 'node:stream';
import parser from 'stream-json/parser.js';
import {AppError} from './errors.js';
import {pointerParts,selectorLimits} from './migration/selector-contract.js';
const fail=()=>{throw new AppError('IMPORT_CONTENT');};
// JSON numbers are copied from parser tokens, never passed through Number or
// JSON.parse. The selected value remains editable, including exact radix text.
export async function selectedJSON(chunks,pointer,{signal}={}){
 const parts=pointerParts(pointer);if(!parts)fail();
 const values=await jsonSelections(chunks,at=>at.length===parts.length&&at.every((s,i)=>s===parts[i]),{signal});
 if(values.length!==1)fail();return values[0].text;
}
// One pass through the bounded manifest retains original attribute number tokens.
export async function sourceAttributes(chunks,{signal}={}){
 const values=await jsonSelections(chunks,at=>at.length===3&&at[0]==='objects'&&/^\d+$/.test(at[1])&&at[2]==='attributes',{signal});
 return new Map(values.map(value=>[Number(value.path[1]),value.text]));
}
async function jsonSelections(chunks,select,{signal,maximum=60000}={}){
 const stack=[],values=[];let key='',inKey=false,active=false,depth=0,result='',scalar=false,selectedPath=null,total=0;
 const append=s=>{if(active){result+=s;if(result.length>maximum)fail();}};
 const nextPath=()=>{const p=stack.at(-1);return p?[...p.path,p.array?String(p.index):p.key]:[];};
 const begin=()=>{
  const p=stack.at(-1),at=nextPath();
  if(!active&&select(at)){active=true;depth=stack.length;selectedPath=at;result='';}
  else if(active&&p?.array&&p.index)append(',');
  return at;
 };
 const end=()=>{if(active&&stack.length===depth){active=false;total+=result.length;if(total>8*1024*1024||values.length>=10000)fail();values.push({path:selectedPath,text:result});}const p=stack.at(-1);if(p?.array)p.index++;};
 async function* utf8(){
  const decoder=new TextDecoder('utf-8',{fatal:true});for await(const chunk of chunks){signal?.throwIfAborted();yield decoder.decode(chunk,{stream:true});}yield decoder.decode();
 }
 const stream=Readable.from(utf8()).compose(parser.asStream({packValues:false}));
 try{
  for await(const {name,value} of stream){
   signal?.throwIfAborted();
   if(name==='startKey'){inKey=true;key='';const p=stack.at(-1);if(p.keys++)append(',');append('"');continue;}
   if(name==='stringChunk'){if(inKey){key+=value;if(key.length>2048)fail();}append(JSON.stringify(value).slice(1,-1));continue;}
   if(name==='endKey'){inKey=false;const p=stack.at(-1);p.key=key;if(p.seen.has(key))fail();p.seen.add(key);if(p.seen.size>100000)fail();append('":');continue;}
   if(name==='startObject'||name==='startArray'){
    const at=begin();append(name==='startObject'?'{':'[');
    if(stack.length>=selectorLimits.jsonDepth)fail();stack.push({path:at,array:name==='startArray',index:0,keys:0,key:null,seen:new Set()});continue;
   }
   if(name==='endObject'||name==='endArray'){append(name==='endObject'?'}':']');stack.pop();end();continue;}
   if(name==='startString'||name==='startNumber'){begin();scalar=true;if(name==='startString')append('"');continue;}
   if(name==='numberChunk'){append(value);continue;}
   if(name==='endString'||name==='endNumber'){if(name==='endString')append('"');scalar=false;end();continue;}
   if(['trueValue','falseValue','nullValue'].includes(name)){begin();append(name.slice(0,-5));end();}
  }
  if(stack.length||scalar||active)fail();return values;
 }catch(error){if(signal?.aborted)throw error;if(error instanceof AppError)throw error;fail();}
 finally{stream.destroy();}
}
