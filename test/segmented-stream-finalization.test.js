import {test} from 'node:test';
import assert from 'node:assert/strict';
import filesystem,{mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {Workspace,digest} from '../src/storage.js';
import {writeContent,FileContent} from '../src/file-content.js';
import {clearVault} from '../src/encryption.js';
import {diskCapacity} from '../src/disk-capacity.js';
import {readSegmentedHeader} from '../src/segmented-file-format.js';
const BLOCK=1024*1024,HEADER=96;
async function fixture(t){const parent=path.resolve(os.tmpdir()),root=await mkdtemp(path.join(parent,'observanda-stream-seeking-')),vault={id:randomUUID(),key:randomBytes(32)},workspace=new Workspace(root,vault),file=path.join(root,'original');t.after(async()=>{clearVault(vault);assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('observanda-stream-seeking-'));await rm(root,{recursive:true,force:true});});return {root,vault,workspace,file};}
const collect=async iterator=>{const parts=[];for await(const bytes of iterator)parts.push(bytes);return Buffer.concat(parts);};

test('existing whole-file envelopes still authenticate the entire file before a partial read',async t=>{
 const f=await fixture(t),bytes=randomBytes(2*BLOCK+7);await f.workspace.writeFile(f.file,bytes);const stored=await readFile(f.file);
 assert.equal(stored.subarray(0,8).toString(),'OBSENC01');const content=new FileContent(f.workspace,f.file,bytes.length,digest(bytes));
 assert.deepEqual(await collect(content.read(0,65535)),bytes.subarray(0,65536));stored[stored.length-1]^=1;await writeFile(f.file,stored);
 let released=0;await assert.rejects(async()=>{for await(const part of content.read(0,65535))released+=part.length;},{code:'ENCRYPTION_DAMAGED'});assert.equal(released,0);
});

test('unknown stream finalization uses new header keys and bounds later playback reads',async t=>{
 const f=await fixture(t),bytes=randomBytes(16*BLOCK),openFile=filesystem.open;let provisional,seekReads=0,stagingReads=0;
 const mock=t.mock.method(filesystem,'open',async(name,...args)=>{
  const handle=await openFile.call(this,name,...args);if(path.dirname(name)!==f.root)return handle;
  const read=handle.read.bind(handle),write=handle.write.bind(handle);
  handle.read=async(...input)=>{const result=await read(...input);if(name===f.file)seekReads+=result.bytesRead;else stagingReads+=result.bytesRead;return result;};
  handle.write=async(buffer,offset,length,position)=>{if(position===0&&buffer.length===HEADER&&!provisional)provisional=readSegmentedHeader(buffer,f.vault.key,f.workspace.fileAAD(f.file));return write(buffer,offset,length,position);};return handle;
 });syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
 async function* input(){for(let offset=0;offset<bytes.length;offset+=65536)yield bytes.subarray(offset,offset+65536);}
 const started=performance.now(),saved=await writeContent(f.workspace,f.file,input()),intakeMs=performance.now()-started,final=readSegmentedHeader((await readFile(f.file)).subarray(0,HEADER),f.vault.key,f.workspace.fileAAD(f.file));
 assert.notDeepEqual(provisional.salt,final.salt);assert.notDeepEqual(provisional.prefix,final.prefix);assert.equal(stagingReads,bytes.length+16*28);
 const content=new FileContent(f.workspace,f.file,saved.size,saved.sha256);
 for(const start of [0,8*BLOCK,bytes.length-65536])assert.deepEqual(await collect(content.read(start,start+65535)),bytes.subarray(start,start+65536));
 assert.ok(seekReads<=3*(8+HEADER+BLOCK+28));assert.equal(saved.sha256,digest(bytes));
 t.diagnostic(JSON.stringify({inputBytes:bytes.length,intakeMs:Math.round(intakeMs),finalizationReadBytes:stagingReads,seekReturnedBytes:3*65536,seekReadBytes:seekReads}));
});

for(const fault of ['read','rewrite','header','truncate','sync','cancel','lock','capacity'])test('interrupted unknown-stream '+fault+' keeps the previous original and releases temporary capacity',async t=>{
 const f=await fixture(t),prior=Buffer.from('retained original');await f.workspace.writeFile(f.file,prior);const before=await readFile(f.file),controller=new AbortController(),openFile=filesystem.open,bytes=randomBytes(BLOCK+7),failure=Error('Injected finalization interruption');let fired=false,headerWrites=0;
 const mock=t.mock.method(filesystem,'open',async(name,...args)=>{
  const handle=await openFile.call(this,name,...args);if(!String(args[0]).startsWith('wx')||path.dirname(name)!==f.root)return handle;
  const fail=()=>{fired=true;throw failure;},read=handle.read.bind(handle),write=handle.write.bind(handle);
  handle.read=async(...values)=>{if(!fired){if(fault==='read')fail();if(fault==='cancel'){fired=true;controller.abort(failure);}if(fault==='lock'){fired=true;clearVault(f.vault);}if(fault==='capacity'){fired=true;diskCapacity.probe=async()=>({id:'full-finalization-volume',available:0n});}}return read(...values);};
  handle.write=async(buffer,offset,length,position)=>{if(position===0)headerWrites++;if(!fired&&(fault==='rewrite'&&headerWrites===1&&position===HEADER&&buffer.length===BLOCK+28&&await handle.stat().then(s=>s.size>BLOCK)||fault==='header'&&headerWrites===2))fail();return write(buffer,offset,length,position);};
  if(fault==='truncate')handle.truncate=async()=>fail();if(fault==='sync')handle.sync=async()=>fail();return handle;
 });const probe=diskCapacity.probe;syncBuiltinESMExports();
 async function* input(){yield bytes;}
 try{await assert.rejects(writeContent(f.workspace,f.file,input(),{signal:controller.signal}));assert.equal(fired,true);assert.deepEqual(await readFile(f.file),before);assert.deepEqual(await readdir(f.root),['original']);assert.equal(diskCapacity.stats().active,0);}
 finally{diskCapacity.probe=probe;mock.mock.restore();syncBuiltinESMExports();}
});
