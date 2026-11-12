import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateDesktopFuseWire,verifyDesktopHardening} from '../scripts/desktop-hardening.js';

const states=[48,49,48,48,49,49,48,48,49],wire=()=>({version:'1',...states});
test('desktop hardening rejects each missing, removed, inherited or reversed fuse and unreviewed layouts',()=>{
 assert.equal(validateDesktopFuseWire(wire()).runAsNode,false);
 for(let index=0;index<states.length;index++)for(const state of [undefined,114,144,states[index]===48?49:48])assert.throws(()=>validateDesktopFuseWire({...wire(),[index]:state}),/fuse policy/);
 assert.throws(()=>validateDesktopFuseWire({...wire(),version:'2'}),/layout/);
 assert.throws(()=>validateDesktopFuseWire({...wire(),9:48}),/layout/);
 const missing=wire();delete missing[8];assert.throws(()=>validateDesktopFuseWire(missing),/layout/);
});
test('fuse inspection binds the actual bytes and reports Linux integrity and signature limits',async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-fuse-test-'));
 t.after(async()=>{assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-fuse-test-'));await rm(directory,{force:true,recursive:true});});
 // Synthetic fuse bytes exercise the reader, not an executable or signed build.
 const bytes=Buffer.concat([Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'),Buffer.from([1,states.length,...states])]),file=path.join(directory,'synthetic-fuse-wire');await writeFile(file,bytes);
 const report=await verifyDesktopHardening(file,'linux');assert.equal(report.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(report.embeddedAsarIntegritySupported,false);assert.equal(report.publisherSignatureVerified,false);assert.ok(!JSON.stringify(report).includes(directory));
 assert.equal((await verifyDesktopHardening(file,'win32')).embeddedAsarIntegritySupported,true);
 // Place the marker across the default 64 KiB file-stream boundary.
 const split=Buffer.concat([Buffer.alloc(65536-9),bytes]);
 await writeFile(file,split);
 assert.equal((await verifyDesktopHardening(file,'linux')).sha256,createHash('sha256').update(split).digest('hex'));
 await writeFile(file,Buffer.concat([split,bytes]));
 await assert.rejects(verifyDesktopHardening(file,'linux'),/multiple fuse wires/);
 await writeFile(file,split.subarray(0,-1));
 await assert.rejects(verifyDesktopHardening(file,'linux'),/complete fuse wire/);
 bytes[bytes.length-1]=48;await writeFile(file,bytes);await assert.rejects(verifyDesktopHardening(file,'linux'),/wasmTrapHandlers/);
 await assert.rejects(verifyDesktopHardening(file,'darwin'),/launcher in the macOS application bundle/);
 await assert.rejects(verifyDesktopHardening(file,'unknown'),/Unsupported/);
});

test('macOS inspection binds the thin launcher and matching Electron Framework',async t=>{
 const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'observanda-fuse-mac-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const contents=path.join(root,'Test.app','Contents');
 const launcher=path.join(contents,'MacOS','Test'),framework=path.join(contents,'Frameworks','Electron Framework.framework','Electron Framework');
 await mkdir(path.dirname(launcher),{recursive:true});await mkdir(path.dirname(framework),{recursive:true});
 const macHeader=cpu=>{const value=Buffer.alloc(32);value.writeUInt32LE(0xfeedfacf);value.writeUInt32LE(cpu,4);return value;};
 const fuseWire=Buffer.concat([Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'),Buffer.from([1,states.length,...states])]);
 for(const [arch,cpu] of [['arm64',0x0100000c],['x64',0x01000007]]){
  const header=macHeader(cpu),frameworkBytes=Buffer.concat([header,fuseWire]);
  await writeFile(launcher,header);await writeFile(framework,frameworkBytes);
  const report=await verifyDesktopHardening(launcher,'darwin');
  assert.equal(report.arch,arch);assert.equal(report.frameworkSha256,createHash('sha256').update(frameworkBytes).digest('hex'));
  assert.equal(report.sha256,createHash('sha256').update(header).digest('hex'));assert.equal(report.publisherSignatureVerified,false);
 }
 await writeFile(launcher,macHeader(0x0100000c));await assert.rejects(verifyDesktopHardening(launcher,'darwin'),/architecture differs/);
 await writeFile(launcher,Buffer.alloc(32));await assert.rejects(verifyDesktopHardening(launcher,'darwin'),/single-architecture/);
});
