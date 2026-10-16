// Encrypted, ordered frames carry only the pinned release's reachable blocks.
// Frame size is a transport unit; total template size has no envelope limit.
import {randomBytes,createHash} from 'node:crypto';
import {passwordKey,seal,unseal} from './encryption.js';
import {AppError} from './errors.js';
import {serialize,digest} from './storage-format.js';
import {RecordDocument} from './record-document.js';
import {starterFingerprint,validateStarterDocument} from './record-starter-documents.js';
import {starterKeys,starterText} from './web/record-starter-model.js';
import {revisionId} from './web/revision-model.js';
const magic=Buffer.from('OBSSTART2'),frameBytes=96*1024;
const fail=()=>{throw new AppError('STARTER_PACKAGE');};
const passwordCheck=value=>{if(typeof value!=='string'||value.length<12||value.length>1024)throw new AppError('STARTER_PASSWORD');};
const aad=(salt,index)=>Buffer.from('Observanda template v2:'+salt.toString('hex')+':'+index);
export async function validateStarterRelease(document,{signal}={}){
 if((await document.tree.propertyNames(document.root)).sort().join()!=='blueprint,createdAt,note,number,previousRevision,version')fail();
 const metadata={};for(const name of ['version','number','createdAt','previousRevision','note'])metadata[name]=(await document.field([name],{signal})).value;
 if(metadata.version!==1||!Number.isSafeInteger(metadata.number)||metadata.number<1||!starterText(metadata.createdAt,30,true)||!Number.isFinite(Date.parse(metadata.createdAt))||!revisionId(metadata.previousRevision)||!starterText(metadata.note,2000,true))fail();
 await validateStarterDocument(new RecordDocument(document.blocks,await document.reference(['blueprint'])),{signal});return metadata;
}
export async function* starterBlocks(document,{signal}={}){
 async function* visit(kind,revision){
  signal?.throwIfAborted();const value=await document.blocks.read(kind,revision);
  yield {kind,revision,value};
  if(kind==='index'){
   if(value.children)for(const child of value.children)yield* visit('index',child.hash);
   else if(value.entries)for(const child of value.entries)yield* visit('value',child.revision);
   else fail();
  }else if(value.root)yield* visit('index',value.root.hash);
  else if(['item','property'].includes(value.type))yield* visit('value',value.value);
 }
 yield* visit('value',document.root);
}
export async function* sealStarterStream(document,fingerprint,password,{signal}={}){
 passwordCheck(password);await validateStarterRelease(document,{signal});if(await starterFingerprint(document,{signal})!==fingerprint)fail();
 const salt=randomBytes(16),key=await passwordKey(password,salt),hash=createHash('sha256');let index=0;
 const frame=value=>{const plain=Buffer.from(JSON.stringify(value));try{if(plain.length>frameBytes-28)fail();const bytes=seal(plain,key,aad(salt,index++)),size=Buffer.alloc(4);size.writeUInt32BE(bytes.length);return Buffer.concat([size,bytes]);}finally{plain.fill(0);}};
 try{
  yield Buffer.concat([magic,salt]);yield frame({type:'release',root:document.root,fingerprint});
  for await(const block of starterBlocks(document,{signal})){hash.update(serialize(block));yield frame({type:'block',...block});}
  signal?.throwIfAborted();yield frame({type:'complete',frames:index,sha256:hash.digest('hex')});
 }finally{key.fill(0);}
}
class Bytes{
 constructor(source,signal){this.source=source[Symbol.asyncIterator]();this.buffer=Buffer.alloc(0);this.signal=signal;}
 async read(size,{end=false}={}){
  const parts=[];let needed=size;
  while(needed){this.signal?.throwIfAborted();if(!this.buffer.length){const next=await this.source.next();if(next.done){if(end&&needed===size)return null;fail();}this.buffer=Buffer.from(next.value);if(!this.buffer.length)continue;}
   const count=Math.min(needed,this.buffer.length);parts.push(this.buffer.subarray(0,count));this.buffer=this.buffer.subarray(count);needed-=count;
  }return parts.length===1?parts[0]:Buffer.concat(parts,size);
 }
}
export async function openStarterStream(source,password,blocks,{signal}={}){
 passwordCheck(password);const input=new Bytes(source,signal),header=await input.read(25);if(!header.subarray(0,9).equals(magic))fail();
 const salt=header.subarray(9),key=await passwordKey(password,salt),hash=createHash('sha256');let index=0,manifest,complete;
 try{
  for(;;){const size=(await input.read(4)).readUInt32BE();if(size<28||size>frameBytes)fail();const encrypted=await input.read(size);let value,plain;
   try{plain=unseal(encrypted,key,aad(salt,index++));value=JSON.parse(plain.toString('utf8'));}catch{fail();}finally{plain?.fill(0);}
   if(index===1){if(!starterKeys(value,['type','root','fingerprint'])||value.type!=='release'||!revisionId(value.root)||!revisionId(value.fingerprint))fail();manifest=value;continue;}
   if(value.type==='complete'){if(!starterKeys(value,['type','frames','sha256'])||value.frames!==index-1||value.sha256!==hash.digest('hex')||await input.read(1,{end:true})!==null)fail();complete=value;break;}
   if(!starterKeys(value,['type','kind','revision','value'])||value.type!=='block'||!['value','index'].includes(value.kind)||!revisionId(value.revision)||Buffer.byteLength(serialize(value.value))>65536||digest(serialize(value.value))!==value.revision)fail();
   const {type,...block}=value;hash.update(serialize(block));await blocks.put(block.kind,block.value);
  }
  const document=new RecordDocument(blocks,manifest.root),metadata=await validateStarterRelease(document,{signal});if(await starterFingerprint(document,{signal})!==manifest.fingerprint)fail();
  // Reject additional unrelated blocks as well as missing, reordered or
  // repeated frames. Transfer traversal is deterministic and depth-bounded.
  const expected=createHash('sha256');let frames=1;for await(const block of starterBlocks(document,{signal})){frames++;expected.update(serialize(block));}
  if(frames!==complete.frames||expected.digest('hex')!==complete.sha256)fail();
  return {document,fingerprint:manifest.fingerprint,...metadata};
 }catch(error){if(signal?.aborted)throw error;if(error.code==='STARTER_PASSWORD')throw error;fail();}finally{key.fill(0);await input.source.return?.();}
}
