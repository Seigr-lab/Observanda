import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {seal,unseal} from '../encryption.js';
import {contentStream,contentSize,contentHash} from '../file-content.js';
import {verifyOrganizationCommand,identityHash} from './identity.js';
import {exchangeContact,wrapExchangeKey} from './exchange-identity.js';
import {exact,uuid} from '../modules/validation.js';
import {AppError} from '../errors.js';

const magic=Buffer.from('OBSSHARE1\n'),block=1024*1024,maxFrame=block+512;
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
export async function* writeExchange(identity,recipient,entries,{id=randomUUID(),signal}={}){
 const key=randomBytes(32),header={format:'observanda-collaboration',version:1,id,recipient:exchangeContact(recipient).id,key:wrapExchangeKey(recipient,id,key)},headerBytes=json(header),headerHash=hash(headerBytes),chain=createHash('sha256'),manifest=createHash('sha256');let index=0,count=0;
 const frame=plain=>{signal?.throwIfAborted();const encrypted=seal(plain,key,headerHash+'/'+index++);return framed(encrypted);};
 const send=plain=>{chain.update(plain);return frame(plain);};
 try{
  yield magic;yield* framed(headerBytes);
  for await(const {kind,name,content} of entries){
   const info={kind,name,size:contentSize(content),sha256:contentHash(content)};validateEntry(info);manifest.update(manifestEntry(info));
   yield* send(Buffer.concat([Buffer.from([1]),json(info)]));const check=createHash('sha256');let size=0;
   for await(const bytes of contentStream(content))for(let offset=0;offset<bytes.length;offset+=block){
    const part=bytes.subarray(offset,offset+block);size+=part.length;check.update(part);yield* send(Buffer.concat([Buffer.from([0]),part]));
   }
   if(size!==info.size||check.digest('hex')!==info.sha256)fail();yield* send(Buffer.from([2]));count++;
  }
  const signature=await identity.signer.sign({kind:'collaboration.package',headerHash,frames:index,entries:count,digest:chain.digest('hex'),manifestHash:manifest.digest('hex')});
  yield* frame(Buffer.concat([Buffer.from([3]),json(signature)]));
 }finally{key.fill(0);}
}
function validateEntry(info){
 if(!exact(info,['kind','name','size','sha256'])||!['description','record','metadata','original'].includes(info.kind)||typeof info.name!=='string'||!info.name||info.name.length>500||!Number.isSafeInteger(info.size)||info.size<0||info.size>2**41||!digest(info.sha256))fail();
}
async function* blocks(source){for await(const part of source){const bytes=Buffer.from(part);for(let at=0;at<bytes.length;at+=block)yield bytes.subarray(at,at+block);}}
class Input{
 constructor(source){this.iterator=blocks(source)[Symbol.asyncIterator]();this.buffer=Buffer.alloc(0);}
 async take(size,{optional=false}={}){
  const parts=[];let remaining=size;
  while(remaining){
   if(!this.buffer.length){const next=await this.iterator.next();if(next.done){if(optional&&remaining===size)return null;fail();}this.buffer=next.value;}
   const n=Math.min(remaining,this.buffer.length);parts.push(this.buffer.subarray(0,n));this.buffer=this.buffer.subarray(n);remaining-=n;
  }
  return Buffer.concat(parts,size);
 }
 async frame(max){const bytes=await this.take(4,{optional:true});if(!bytes)return null;const size=bytes.readUInt32BE();if(!size||size>max)fail();return this.take(size);}
 close(){return this.iterator.return?.();}
}
export async function readExchange(identity,source,consume,{signal,expectedSender}={}){
 const input=new Input(source),chain=createHash('sha256'),manifest=createHash('sha256');let secret,index=0,count=0;
 try{
  if(!(await input.take(magic.length)).equals(magic))fail();const bytes=await input.frame(8192);if(!bytes)fail();const header=JSON.parse(bytes.toString('utf8'));
  if(!exact(header,['format','version','id','recipient','key'])||header.format!=='observanda-collaboration'||header.version!==1||!uuid(header.id)||!digest(header.recipient)||typeof header.key!=='string'||header.key.length!==512||Buffer.from(header.key,'base64').toString('base64')!==header.key)fail();
  secret=await identity.unwrap(header);const headerHash=hash(bytes);
  const next=async()=>{signal?.throwIfAborted();const frame=await input.frame(maxFrame);if(!frame)fail();return unseal(frame,secret,headerHash+'/'+index++);};
  for(;;){
   const plain=await next();
   if(plain[0]===3){
    const signed=JSON.parse(plain.subarray(1).toString('utf8')),value=verifyOrganizationCommand(signed);
    if(!exact(value,['kind','headerHash','frames','entries','digest','manifestHash'])||value.kind!=='collaboration.package'||value.headerHash!==headerHash||value.frames!==index-1||value.entries!==count||value.digest!==chain.digest('hex')||value.manifestHash!==manifest.digest('hex')||expectedSender&&signed.identity.id!==expectedSender)fail();
    if(await input.take(1,{optional:true})!==null)fail();return {id:header.id,sender:signed.identity,signatureHash:identityHash(signed),attestation:signed,entries:count};
   }
   if(plain[0]!==1)fail();chain.update(plain);const info=JSON.parse(plain.subarray(1).toString('utf8'));validateEntry(info);manifest.update(manifestEntry(info));let ended=false,size=0;const check=createHash('sha256');
   async function* content(){
    for(;;){const part=await next();chain.update(part);
     if(part[0]===2){if(part.length!==1||size!==info.size||check.digest('hex')!==info.sha256)fail();ended=true;return;}
     if(part[0]!==0||part.length<2||part.length>block+1)fail();const bytes=part.subarray(1);size+=bytes.length;if(size>info.size)fail();check.update(bytes);yield bytes;
    }
   }
   await consume(info,content());if(!ended)fail();count++;
  }
 }catch(error){if(error.name==='AbortError'||['ACCESS_LOCKED','DEVICE_UNAVAILABLE','STORAGE_FULL','COLLABORATION_SCOPE'].includes(error.code))throw error;throw new AppError('COLLABORATION_PACKAGE');}
 finally{secret?.fill(0);await input.close();}
}
