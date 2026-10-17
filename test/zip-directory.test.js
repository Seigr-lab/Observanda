import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {ZipDirectory} from '../src/zip-directory.js';
import {zipStream} from '../src/zip-stream.js';

test('ZIP central rows spill after the bounded buffer and cleanup closes the scratch file',async()=>{
 const directory=new ZipDirectory(),chunk=Buffer.alloc(8192,0x61);let file;
 try{for(let i=0;i<40;i++)await directory.append(chunk);assert.ok(directory.handle);assert.equal(directory.pending.length,0);file=directory.file;let size=0;for await(const bytes of directory.chunks()){assert.ok(bytes.length<=65536);size+=bytes.length;assert.ok(bytes.every(byte=>byte===0x61));}assert.equal(size,40*chunk.length);assert.equal((await readFile(file)).length,size);}finally{await directory.close();}
 await assert.rejects(stat(file),{code:'ENOENT'});
});
test('ZIP accepts an asynchronous inventory and counts actual entries without an aggregate size',async()=>{
 async function* files(){yield ['first.txt','one'];yield ['second.txt','two'];}
 const chunks=[];for await(const bytes of zipStream(files()))chunks.push(bytes);const bytes=Buffer.concat(chunks),end=bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x06,0x06]));assert.ok(end>0);assert.equal(bytes.readBigUInt64LE(end+24),2n);assert.equal(bytes.readBigUInt64LE(end+32),2n);
});
test('early ZIP cancellation releases a spilled central directory',async()=>{
 let closed=false,spilled=false;const close=ZipDirectory.prototype.close;
 ZipDirectory.prototype.close=async function(){spilled=!!this.file;const file=this.file;await close.call(this);closed=true;if(file)await assert.rejects(stat(file),{code:'ENOENT'});};
 try{async function* files(){for(let i=0;i<4096;i++)yield ['file-'+String(i).padStart(5,'0')+'.txt',''];}const stream=zipStream(files());for await(const bytes of stream){if(bytes.length>=4&&bytes.readUInt32LE(0)===0x02014b50)break;}}finally{ZipDirectory.prototype.close=close;}
 assert.equal(closed,true);assert.equal(spilled,true);
});
