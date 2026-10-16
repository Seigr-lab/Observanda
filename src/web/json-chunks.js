// JSON data encoding for bounded transports. Match JSON.stringify's spelling
// and property order without collecting a whole document or long scalar.
// Application values are plain data: accessors and custom serialization hooks
// are deliberately not invoked while creating a checkpoint identity.
const encoder=new TextEncoder(),stringWindow=4096,nonASCII=/[^\x00-\x7f]/;
const invalid=()=>{throw Object.assign(new TypeError('Expected JSON data.'),{code:'INVALID'});};
function* stringParts(value){
 for(let start=0;start<value.length;){
  let end=Math.min(start+stringWindow,value.length);
  if(end<value.length&&value.charCodeAt(end-1)>=0xd800&&value.charCodeAt(end-1)<=0xdbff&&value.charCodeAt(end)>=0xdc00&&value.charCodeAt(end)<=0xdfff)end--;
  yield value.slice(start,end);start=end;
 }
}
function* quoted(value){
 yield '"';
 for(const part of stringParts(value))yield JSON.stringify(part).slice(1,-1);
 yield '"';
}
function* parts(value,pretty,depth,ancestors,canonical=false){
 if(typeof value==='string'){yield* quoted(value);return;}
 if(value===null||typeof value==='boolean'||typeof value==='number'){yield JSON.stringify(value);return;}
 if(!value||typeof value!=='object'||ancestors.has(value)||Object.getOwnPropertySymbols(value).length)invalid();
 const array=Array.isArray(value);
 if(!array&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))invalid();
 ancestors.add(value);
 try{
  yield array?'[':'{';let count=0;
  const emit=function*(key){
   const descriptor=Object.getOwnPropertyDescriptor(value,key);
   if(descriptor&&!Object.hasOwn(descriptor,'value'))invalid();
   const child=descriptor?.value;
   if(typeof child==='function'||typeof child==='symbol'||typeof child==='bigint')invalid();
   if(!array&&child===undefined)return;
   if(count++)yield ',';
   if(pretty)yield '\n'+'  '.repeat(depth+1);
   if(!array){yield* quoted(key);yield pretty?': ':':';}
   yield* parts(child===undefined?null:child,pretty,depth+1,ancestors,canonical);
  };
  if(array){for(let i=0;i<value.length;i++)yield* emit(String(i));}
  else{
   let keys=Object.keys(value);
   // Match Object.fromEntries(sorted keys): integer-index properties still
   // precede other names numerically, including in the canonical encoding.
   if(canonical){const index=key=>/^(0|[1-9][0-9]*)$/.test(key)&&Number(key)<4294967295;keys.sort((a,b)=>index(a)?index(b)?Number(a)-Number(b):-1:index(b)?1:a<b?-1:a>b?1:0);}
   for(const key of keys)yield* emit(key);
  }
  if(pretty&&count)yield '\n'+'  '.repeat(depth);
  yield array?']':'}';
 }finally{ancestors.delete(value);}
}
export function* jsonChunks(value,{size=128*1024,pretty=false,canonical=false,signal}={}){
 if(!Number.isSafeInteger(size)||size<1)invalid();
 let buffer=new Uint8Array(size),used=0;
 for(const part of parts(value,pretty,0,new Set(),canonical)){
  signal?.throwIfAborted();const bytes=encoder.encode(part);
  for(let offset=0;offset<bytes.length;){
   const count=Math.min(size-used,bytes.length-offset);buffer.set(bytes.subarray(offset,offset+count),used);used+=count;offset+=count;
   if(used===size){yield buffer;buffer=new Uint8Array(size);used=0;}
  }
 }
 signal?.throwIfAborted();if(used)yield buffer.subarray(0,used);
}
function countBytes(parts,signal){
 let bytes=0;
 for(const part of parts){signal?.throwIfAborted();bytes+=nonASCII.test(part)?encoder.encode(part).byteLength:part.length;if(!Number.isSafeInteger(bytes))invalid();}
 signal?.throwIfAborted();return bytes;
}
// Capacity diagnostics share the transport spelling but never retain a complete
// JSON string or encoded byte array. Count all input so the reported size is exact.
export const jsonByteLength=(value,{pretty=false,canonical=false,signal}={})=>countBytes(parts(value,pretty,0,new Set(),canonical),signal);
// Representation selection only: stop as soon as the value cannot fit. Unlike
// capacity diagnostics this predicate makes no claim about the complete size.
export function jsonFitsBytes(value,limit,{pretty=false,signal}={}){
 if(!Number.isSafeInteger(limit)||limit<0)invalid();
 let bytes=0;
 for(const part of parts(value,pretty,0,new Set())){
  signal?.throwIfAborted();bytes+=nonASCII.test(part)?encoder.encode(part).byteLength:part.length;
  if(bytes>limit)return false;
 }
 signal?.throwIfAborted();return true;
}
export const utf8ByteLength=(value,{signal}={})=>countBytes(stringParts(value),signal);
// Yield to input/paint/cancellation while inspecting a large draft. Network
// requests provide their own yields during transfer; inspection has no I/O.
export async function yieldJSONWork(start,signal){
 signal?.throwIfAborted();
 if(performance.now()-start<16)return start;
 await new Promise(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();return performance.now();
}
