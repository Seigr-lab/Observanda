import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {seal,unseal} from '../encryption.js';
import {contentStream,contentSize,contentHash} from '../file-content.js';
import {verifyOrganizationCommand,identityHash} from './identity.js';
import {exchangeContact,wrapExchangeKey} from './exchange-identity.js';
import {exact,uuid} from '../modules/validation.js';
import {AppError} from '../errors.js';

const magic=Buffer.from('OBSSHARE1\n'),block=1024*1024,maxFrame=block+512;
const maxDeclaration=2*1024*1024+16384;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=()=>{throw new AppError('COLLABORATION_PACKAGE');};
const json=value=>Buffer.from(JSON.stringify(value));
export const manifestEntry=({kind,name,size,sha256})=>json({kind,name,size,sha256});
function framed(bytes){const size=Buffer.alloc(4);size.writeUInt32BE(bytes.length);return [size,bytes];}

// Frames are independently authenticated and position-bound. The final signed
// digest authenticates the sender, complete ordered content and recipient.
// Consumers must stage incoming entries until this generator finishes; a valid
// prefix is never an accepted package. No workspace key is put in the archive.
export async function* writeExchange(identity,recipient,entries,{id=randomUUID(),signal,keyAdapter,declaration}={}){
 const key=randomBytes(32),header={format:'observanda-collaboration',version:declaration?2:1,id,recipient:(keyAdapter?keyAdapter.recipient(recipient):exchangeContact(recipient)).id,key:keyAdapter?keyAdapter.wrap(recipient,id,key):wrapExchangeKey(recipient,id,key)},headerBytes=json(header),headerHash=hash(headerBytes),chain=createHash('sha256'),manifest=createHash('sha256');let index=0,count=0,total=0;
 const frame=plain=>{signal?.throwIfAborted();const encrypted=seal(plain,key,headerHash+'/'+index++);return framed(encrypted);};
 const send=plain=>{chain.update(plain);return frame(plain);};
 try{
  yield magic;yield* framed(headerBytes);
  if(declaration){
   validateDeclaration(declaration);
   const signed=await identity.signer.sign({kind:'collaboration.package.declaration',headerHash,...declaration}),plain=Buffer.concat([Buffer.from([4]),json(signed)]);
   if(plain.length>maxDeclaration-512)fail();yield* send(plain);
  }
  for await(const {kind,name,content} of entries){
   const info={kind,name,size:contentSize(content),sha256:contentHash(content)};validateEntry(info);manifest.update(manifestEntry(info));
   yield* send(Buffer.concat([Buffer.from([1]),json(info)]));const check=createHash('sha256');let size=0;
   for await(const bytes of contentStream(content))for(let offset=0;offset<bytes.length;offset+=block){
    const part=bytes.subarray(offset,offset+block);size+=part.length;check.update(part);yield* send(Buffer.concat([Buffer.from([0]),part]));
   }
   if(size!==info.size||check.digest('hex')!==info.sha256)fail();yield* send(Buffer.from([2]));count++;total+=size;
  }
  const manifestHash=manifest.digest('hex');
  if(declaration&&(count!==declaration.entries||total!==declaration.bytes||manifestHash!==declaration.manifestHash))fail();
  const signature=await identity.signer.sign({kind:'collaboration.package',headerHash,frames:index,entries:count,digest:chain.digest('hex'),manifestHash});
  yield* frame(Buffer.concat([Buffer.from([3]),json(signature)]));
 }finally{key.fill(0);}
}
function validateDeclaration(value){
 if(!exact(value,['entries','bytes','manifestHash','selection'])||!Number.isSafeInteger(value.entries)||value.entries<1||!Number.isSafeInteger(value.bytes)||value.bytes<0||!digest(value.manifestHash)||!value.selection||typeof value.selection!=='object'||Array.isArray(value.selection)||json(value.selection).length>2*1024*1024)fail();
}
// Only descriptors are read in this pass; original bodies remain streamed.
export async function exchangeDeclaration(items,selection){
 const manifest=createHash('sha256');let entries=0,bytes=0;
 for await(const item of items){const info={kind:item.kind,name:item.name,size:item.size??contentSize(item.content),sha256:item.sha256??contentHash(item.content)};validateEntry(info);manifest.update(manifestEntry(info));entries++;bytes+=info.size;if(!Number.isSafeInteger(bytes))fail();}
 const value={entries,bytes,manifestHash:manifest.digest('hex'),selection};validateDeclaration(value);return value;
}
function validateEntry(info){
 if(!exact(info,['kind','name','size','sha256'])||!['description','record','metadata','original'].includes(info.kind)||typeof info.name!=='string'||!info.name||info.name.length>500||!Number.isSafeInteger(info.size)||info.size<0||info.size>2**41||!digest(info.sha256))fail();
}
async function* blocks(source){let empty=0;for await(const part of source){const bytes=Buffer.from(part);if(!bytes.length){if(++empty>64)fail();continue;}empty=0;for(let at=0;at<bytes.length;at+=block)yield bytes.subarray(at,at+block);}}
class Input{
 constructor(source,{signal,idleTimeoutMs=15000,timeoutMs=30*60*1000}={}){
  for(const value of [idleTimeoutMs,timeoutMs])if(!Number.isSafeInteger(value)||value<1||value>2147483647)fail();
  this.source=source;this.iterator=blocks(source)[Symbol.asyncIterator]();this.buffer=Buffer.alloc(0);this.controller=new AbortController();this.signal=signal?AbortSignal.any([signal,this.controller.signal]):this.controller.signal;this.idleTimeoutMs=idleTimeoutMs;
  this.timer=setTimeout(()=>this.controller.abort(new AppError('COLLABORATION_PACKAGE')),timeoutMs);this.timer.unref?.();
 }
 async wait(pending){
  let timer,abort;
  try{return await Promise.race([pending,new Promise((_,reject)=>{
   abort=()=>reject(this.signal.reason);this.signal.addEventListener('abort',abort,{once:true});
   timer=setTimeout(()=>this.controller.abort(new AppError('COLLABORATION_PACKAGE')),this.idleTimeoutMs);if(this.signal.aborted)abort();
  })]);}finally{clearTimeout(timer);this.signal.removeEventListener('abort',abort);}
 }
 async take(size,{optional=false}={}){
  const parts=[];let remaining=size;
  while(remaining){
   this.signal.throwIfAborted();if(!this.buffer.length){const next=await this.wait(this.iterator.next());if(next.done){if(optional&&remaining===size)return null;fail();}this.buffer=next.value;}
   const n=Math.min(remaining,this.buffer.length);parts.push(this.buffer.subarray(0,n));this.buffer=this.buffer.subarray(n);remaining-=n;
  }
  return Buffer.concat(parts,size);
 }
 async frame(max){const bytes=await this.take(4,{optional:true});if(!bytes)return null;const size=bytes.readUInt32BE();if(!size||size>max)fail();return this.take(size);}
 async close(){
  clearTimeout(this.timer);
  if(this.signal.aborted){this.source.destroy?.();Promise.resolve(this.iterator.return?.()).catch(()=>{});return;}
  try{await this.wait(Promise.resolve(this.iterator.return?.()));}finally{clearTimeout(this.timer);}
 }
}
export async function readExchange(identity,source,consume,{signal,expectedSender,requireDeclaration=false,authorizeDeclaration,maxBytes=2**31,maxFileBytes=2**30,maxEntries=100000,idleTimeoutMs,timeoutMs}={}){
 for(const limit of [maxBytes,maxFileBytes,maxEntries])if(!Number.isSafeInteger(limit)||limit<1)fail();
 const input=new Input(source,{signal,idleTimeoutMs,timeoutMs}),chain=createHash('sha256'),manifest=createHash('sha256');let secret,index=0,count=0,total=0,declaration,sender;
 signal=input.signal;
 try{
  if(!(await input.take(magic.length)).equals(magic))fail();const bytes=await input.frame(8192);if(!bytes)fail();const header=JSON.parse(bytes.toString('utf8'));
  if(!exact(header,['format','version','id','recipient','key'])||header.format!=='observanda-collaboration'||![1,2].includes(header.version)||requireDeclaration&&header.version!==2||!uuid(header.id)||!digest(header.recipient)||typeof header.key!=='string'||header.key.length!==512||Buffer.from(header.key,'base64').toString('base64')!==header.key)fail();
  secret=await identity.unwrap(header);const headerHash=hash(bytes);
  const next=async(max=maxFrame)=>{signal?.throwIfAborted();const frame=await input.frame(max);if(!frame)fail();return unseal(frame,secret,headerHash+'/'+index++);};
  if(header.version===2){
   const plain=await next(maxDeclaration);if(plain[0]!==4)fail();chain.update(plain);
   const signed=JSON.parse(plain.subarray(1).toString('utf8')),value=verifyOrganizationCommand(signed);
   if(!exact(value,['kind','headerHash','entries','bytes','manifestHash','selection'])||value.kind!=='collaboration.package.declaration'||value.headerHash!==headerHash||expectedSender&&signed.identity.id!==expectedSender)fail();
   const {kind,headerHash:bound,...declared}=value;void kind;void bound;validateDeclaration(declared);declaration=declared;sender=signed.identity;
   if(declaration.entries>maxEntries||declaration.bytes>maxBytes)throw new AppError('LIMIT');
   await authorizeDeclaration?.({id:header.id,sender,declaration});signal?.throwIfAborted();
  }
  for(;;){
   const plain=await next();
   if(plain[0]===3){
    const signed=JSON.parse(plain.subarray(1).toString('utf8')),value=verifyOrganizationCommand(signed);
    if(!exact(value,['kind','headerHash','frames','entries','digest','manifestHash'])||value.kind!=='collaboration.package'||value.headerHash!==headerHash||value.frames!==index-1||value.entries!==count||value.digest!==chain.digest('hex')||value.manifestHash!==manifest.digest('hex')||expectedSender&&signed.identity.id!==expectedSender||sender&&signed.identity.id!==sender.id||declaration&&(count!==declaration.entries||total!==declaration.bytes||value.manifestHash!==declaration.manifestHash))fail();
    if(await input.take(1,{optional:true})!==null)fail();return {id:header.id,sender:signed.identity,signatureHash:identityHash(signed),attestation:signed,entries:count};
   }
   if(plain[0]!==1)fail();chain.update(plain);const info=JSON.parse(plain.subarray(1).toString('utf8'));validateEntry(info);
   total+=info.size;if(!Number.isSafeInteger(total)||info.size>maxFileBytes||total>maxBytes||count>=maxEntries||declaration&&(total>declaration.bytes||count>=declaration.entries))throw new AppError('LIMIT');
   if(declaration&&count===0&&(info.kind!=='description'||info.name!=='selection'||info.sha256!==hash(json(declaration.selection))))fail();
   manifest.update(manifestEntry(info));let ended=false,size=0;const check=createHash('sha256');
   async function* content(){
    for(;;){const part=await next();chain.update(part);
     if(part[0]===2){if(part.length!==1||size!==info.size||check.digest('hex')!==info.sha256)fail();ended=true;return;}
     if(part[0]!==0||part.length<2||part.length>block+1)fail();const bytes=part.subarray(1);size+=bytes.length;if(size>info.size)fail();check.update(bytes);yield bytes;
    }
   }
   await consume(info,content(),{signal});if(!ended)fail();count++;
  }
 }catch(error){if(error.name==='AbortError'||['ACCESS_LOCKED','DEVICE_UNAVAILABLE','STORAGE_FULL','COLLABORATION_SCOPE','COLLABORATION_DENIED','LIMIT'].includes(error.code))throw error;throw new AppError('COLLABORATION_PACKAGE');}
 finally{secret?.fill(0);await input.close();}
}
