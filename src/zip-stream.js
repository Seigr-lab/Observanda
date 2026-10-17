import {ZipDirectory} from './zip-directory.js';
import {contentSize,contentHash,contentStream} from './file-content.js';
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
// ZIP64 data descriptors allow file-backed entries without buffering their bodies.
export async function* zipStream(files){
 let offset=0n,count=0n;const central=new ZipDirectory();
 try{
 for await(const [name,content] of files){
  const filename=Buffer.from(name),size=BigInt(contentSize(content)),extra=Buffer.alloc(20);extra.writeUInt16LE(1);extra.writeUInt16LE(16,2);extra.writeBigUInt64LE(size,4);extra.writeBigUInt64LE(size,12);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(45,4);local.writeUInt16LE(0x808,6);local.writeUInt16LE(0x21,12);local.writeUInt32LE(0xffffffff,18);local.writeUInt32LE(0xffffffff,22);local.writeUInt16LE(filename.length,26);local.writeUInt16LE(extra.length,28);
  yield local;yield filename;yield extra;let crc=0xffffffff,seen=0n;const hash=createHash('sha256');
  for await(const bytes of contentStream(content)){seen+=BigInt(bytes.length);hash.update(bytes);for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);yield bytes;}
  if(seen!==size||hash.digest('hex')!==contentHash(content))throw new AppError('STALE');crc=(crc^0xffffffff)>>>0;
  const descriptor=Buffer.alloc(24);descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(crc,4);descriptor.writeBigUInt64LE(size,8);descriptor.writeBigUInt64LE(size,16);yield descriptor;
  const directory=Buffer.alloc(46),ce=Buffer.alloc(28);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(45,4);directory.writeUInt16LE(45,6);directory.writeUInt16LE(0x808,8);directory.writeUInt16LE(0x21,14);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(0xffffffff,20);directory.writeUInt32LE(0xffffffff,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt16LE(28,30);directory.writeUInt32LE(0xffffffff,42);ce.writeUInt16LE(1);ce.writeUInt16LE(24,2);ce.writeBigUInt64LE(size,4);ce.writeBigUInt64LE(size,12);ce.writeBigUInt64LE(offset,20);await central.append(directory,filename,ce);count++;
  offset+=BigInt(local.length+filename.length+extra.length+descriptor.length)+size;
 }
 const start=offset;for await(const bytes of central.chunks()){yield bytes;offset+=BigInt(bytes.length);}const end64=Buffer.alloc(56);end64.writeUInt32LE(0x06064b50);end64.writeBigUInt64LE(44n,4);end64.writeUInt16LE(45,12);end64.writeUInt16LE(45,14);end64.writeBigUInt64LE(count,24);end64.writeBigUInt64LE(count,32);end64.writeBigUInt64LE(offset-start,40);end64.writeBigUInt64LE(start,48);yield end64;
 const locator=Buffer.alloc(20);locator.writeUInt32LE(0x07064b50);locator.writeBigUInt64LE(offset,8);locator.writeUInt32LE(1,16);yield locator;
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(0xffff,8);end.writeUInt16LE(0xffff,10);end.writeUInt32LE(0xffffffff,12);end.writeUInt32LE(0xffffffff,16);yield end;
 }finally{await central.close();}
}
