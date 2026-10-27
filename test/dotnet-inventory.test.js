import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectDotnetRuntime} from '../scripts/dotnet-inventory.js';

const marker=Buffer.from('8b1202b96a612038727b930214d7a03213f5b9e6efae3318ee3b2dce24b36aae','hex');
function bundle({runtime='10.0.9',dependency=runtime,duplicate=false,hugeConfig=false,badPointer=false,major=6}={}){
 const bytes=Buffer.alloc(2*1024*1024+256),offset=1024*1024-16,manifest=2*1024*1024;
 bytes.set([0x7f,0x45,0x4c,0x46]);marker.copy(bytes,offset);bytes.writeBigInt64LE(badPointer?2n**62n:BigInt(manifest),offset-8);
 if(duplicate)marker.copy(bytes,4096);
 const config=Buffer.from(JSON.stringify({runtimeOptions:{tfm:'net10.0',includedFrameworks:[{name:'Microsoft.NETCore.App',version:runtime}]}}));config.copy(bytes,128);
 const deps=Buffer.from(JSON.stringify({runtimeTarget:{name:'.NETCoreApp,Version=v10.0/linux-x64'},libraries:{['runtimepack.Microsoft.NETCore.App.Runtime.linux-x64/'+dependency]:{}}}));deps.copy(bytes,2048);
 bytes.writeUInt32LE(major,manifest);bytes.writeInt32LE(2,manifest+8);bytes[manifest+12]=4;bytes.write('test',manifest+13);
 const cursor=manifest+17;bytes.writeBigInt64LE(2048n,cursor);bytes.writeBigInt64LE(BigInt(deps.length),cursor+8);bytes.writeBigInt64LE(128n,cursor+16);bytes.writeBigInt64LE(BigInt(hugeConfig?65537:config.length),cursor+24);
 return bytes;
}
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'observanda-runtime-inventory-'));t.after(()=>rm(root,{recursive:true,force:true}));return path.join(root,'helper');}

test('single-file runtime inventory finds a boundary-spanning marker and verifies both version manifests',async t=>{
 const executable=await fixture(t),bytes=bundle(),hash=createHash('sha256').update(bytes).digest('hex');await writeFile(executable,bytes);
 assert.deepEqual(await inspectDotnetRuntime(executable,{platform:'linux',expectedSha256:hash}),{kind:'bundled',name:'.NET',version:'10.0.9',sha256:hash,metadataFormat:'dotnet-single-file-6.0'});
 await assert.rejects(inspectDotnetRuntime(executable,{platform:'linux',expectedSha256:'f'.repeat(64)}),/Could not identify/);
});
test('single-file inventory rejects contradictory, ambiguous, oversized and unreviewed metadata',async t=>{
 const executable=await fixture(t);
 for(const options of [{dependency:'10.0.8'},{duplicate:true},{hugeConfig:true},{badPointer:true},{major:7}]){
  await writeFile(executable,bundle(options));await assert.rejects(inspectDotnetRuntime(executable,{platform:'linux'}),error=>error.message==='Could not identify credential helper .NET runtime.');
 }
 await writeFile(executable,Buffer.from('private sentinel'));await assert.rejects(inspectDotnetRuntime(executable,{platform:'linux'}),/Could not identify/);
});
test('Windows inventory reports a host prerequisite instead of a bundled framework patch version',async t=>{
 const executable=await fixture(t),xml='<?xml version="1.0"?><configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.7.2" /></startup></configuration>';
 await writeFile(executable+'.config',xml);const value=await inspectDotnetRuntime(executable,{platform:'win32'});
 assert.equal(value.kind,'host-requirement');assert.equal(value.minimumVersion,'4.7.2');assert.equal(value.configurationSha256,createHash('sha256').update(xml).digest('hex'));assert.equal(value.version,undefined);
 for(const invalid of [xml.replace('v4.0','v2.0'),xml.replace('</startup>','<supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8.0" /></startup>'),'<!DOCTYPE configuration [<!ENTITY secret "private sentinel">]>'+xml,xml.slice(0,-4),'x'.repeat(65537)]){
  await writeFile(executable+'.config',invalid);await assert.rejects(inspectDotnetRuntime(executable,{platform:'win32'}),error=>error.message==='Could not identify credential helper .NET runtime.');
 }
});
