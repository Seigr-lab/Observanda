import {Readable} from 'node:stream';
import {isAnyArrayBuffer} from 'node:util/types';
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
 const stack=[],values=[];let inKey=false,active=false,depth=0,result='',scalar=false,selectedPath=null,total=0;
 // Materialize retained keys from their UTF-16 code units so token substrings
 // cannot keep whole decoder buffers alive. Escaped lone surrogates stay distinct.
 const keyBuffer=Buffer.alloc(selectorLimits.jsonKeyUnits*2);
 let keyBytes=0,liveKeys=0,liveKeyBytes=0;
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
  const decoder=new TextDecoder('utf-8',{fatal:true});let sourceBytes=0;
  // The tokenizer emits a batch per input chunk. Bound that batch even when
  // a staged read supplies a much larger buffer.
  const blockBytes=16*1024;
  for await(const chunk of chunks){
   signal?.throwIfAborted();
   if(!ArrayBuffer.isView(chunk)&&!isAnyArrayBuffer(chunk))fail();
   const bytes=new Uint8Array(chunk.buffer??chunk,chunk.byteOffset,chunk.byteLength);
   sourceBytes+=bytes.byteLength;if(sourceBytes>selectorLimits.jsonConversionBytes)fail();
   for(let offset=0;offset<bytes.length;offset+=blockBytes){
    yield decoder.decode(bytes.subarray(offset,offset+blockBytes),{stream:true});
   }
  }
  yield decoder.decode();
 }
 const stream=Readable.from(utf8()).compose(parser.asStream({packValues:false}));
 try{
  for await(const {name,value} of stream){
   signal?.throwIfAborted();
   if(name==='startKey'){inKey=true;keyBytes=0;if(stack.at(-1).seen.size)append(',');append('"');continue;}
   if(name==='stringChunk'){
    if(inKey){
     if(keyBytes+value.length*2>keyBuffer.length)fail();
     keyBytes+=keyBuffer.write(value,keyBytes,value.length*2,'utf16le');
    }
    append(JSON.stringify(value).slice(1,-1));continue;
   }
   if(name==='endKey'){
    inKey=false;
    if(liveKeys>=selectorLimits.jsonLiveKeys||liveKeyBytes+keyBytes>selectorLimits.jsonLiveKeyBytes)fail();
    const frame=stack.at(-1),key=keyBuffer.toString('utf16le',0,keyBytes);
    if(frame.seen.has(key))fail();
    frame.seen.add(key);frame.key=key;frame.keyBytes+=keyBytes;
    liveKeys++;liveKeyBytes+=keyBytes;append('":');continue;
   }
   if(name==='startObject'||name==='startArray'){
    const at=begin();append(name==='startObject'?'{':'[');
    if(stack.length>=selectorLimits.jsonDepth)fail();
    const array=name==='startArray';stack.push({path:at,array,index:0,key:null,seen:array?null:new Set(),keyBytes:0});continue;
   }
   if(name==='endObject'||name==='endArray'){
    append(name==='endObject'?'}':']');const frame=stack.pop();
    if(frame.seen){liveKeys-=frame.seen.size;liveKeyBytes-=frame.keyBytes;}
    end();continue;
   }
   if(name==='startString'||name==='startNumber'){begin();scalar=true;if(name==='startString')append('"');continue;}
   if(name==='numberChunk'){append(value);continue;}
   if(name==='endString'||name==='endNumber'){if(name==='endString')append('"');scalar=false;end();continue;}
   if(['trueValue','falseValue','nullValue'].includes(name)){begin();append(name.slice(0,-5));end();}
  }
  if(stack.length||scalar||active)fail();return values;
 }catch(error){if(signal?.aborted)throw error;if(error instanceof AppError)throw error;fail();}
 finally{stream.destroy();}
}
