// A single logical JSON value may be larger than an encrypted metadata page.
// Chunk its UTF-8 bytes and retain an authenticated, indexed sequence of chunks.
// Consumers still materialize this one value; this is not a corpus-sized reader.
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
const fail=()=>{throw new AppError('MATERIAL_MISSING');};
const chunkBytes=65536;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export class RetainedJsonValue{
 constructor(sequences,write,{namespace='json-value-chunks',signal}={}){this.sequences=sequences;this.write=write;this.namespace=namespace;this.signal=signal;}
 async put(value){
  this.signal?.throwIfAborted();const bytes=Buffer.from(serialize(value)),builder=this.sequences.builder('pages',this.write);
  for(let offset=0;offset<bytes.length;offset+=chunkBytes){
   this.signal?.throwIfAborted();let id;
   await this.write(async()=>{this.signal?.throwIfAborted();id=await this.sequences.put(this.namespace,{data:bytes.subarray(offset,offset+chunkBytes).toString('base64')});});
   await builder.append(id);
  }
  return {format:1,bytes:bytes.length,hash:digest(bytes),chunks:await builder.finish()};
 }
 async read(value){
  this.signal?.throwIfAborted();
  if(!value||value.format!==1||!Number.isSafeInteger(value.bytes)||value.bytes<1||!hash(value.hash))fail();
  this.sequences.validate(value.chunks);
  if(value.chunks.kind!=='pages'||value.chunks.count!==Math.ceil(value.bytes/chunkBytes))fail();
  const parts=[];let length=0;
  for await(const id of this.sequences.items(value.chunks)){
   this.signal?.throwIfAborted();if(!hash(id))fail();const chunk=await this.sequences.read(this.namespace,id,131072);
   if(typeof chunk?.data!=='string'||chunk.data.length>Math.ceil(chunkBytes/3)*4)fail();
   const bytes=Buffer.from(chunk.data,'base64');
   if(bytes.toString('base64')!==chunk.data||bytes.length!==Math.min(chunkBytes,value.bytes-length))fail();
   parts.push(bytes);length+=bytes.length;
  }
  const bytes=Buffer.concat(parts,length);if(length!==value.bytes||digest(bytes)!==value.hash)fail();
  let parsed;try{parsed=JSON.parse(bytes.toString('utf8'));}catch{fail();}
  if(digest(serialize(parsed))!==value.hash)fail();return parsed;
 }
}
