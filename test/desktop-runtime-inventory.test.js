import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bootstrapDesktop,desktopRuntimeVersions} from '../desktop/runtime-inventory.js';
import {collectDesktopRuntimeInventory} from '../scripts/desktop-runtime-inventory.js';

const versions={electron:'44.10.0',chrome:'152.0.7977.169',node:'24.22.1',v8:'15.2.124.45-electron.0',openssl:'0.0.0',uv:'1.52.1',zlib:'1.3.2.1-motley',undici:'7.30.1',privateValue:'sentinel'};
test('version inspection exits without starting a desktop profile or service',async()=>{
 const writes=[],exits=[];let starts=0;const options={argv:['--observanda-runtime-inventory'],versions,platform:'win32',arch:'x64',write:async text=>writes.push(text),exit:code=>exits.push(code),start:async()=>starts++};
 await bootstrapDesktop(options);assert.equal(starts,0);assert.deepEqual(exits,[0]);assert.equal(JSON.parse(writes[0]).versions.chrome,versions.chrome);assert.doesNotMatch(writes[0],/privateValue|sentinel/);
 await bootstrapDesktop({...options,argv:[]});assert.equal(starts,1);
 await bootstrapDesktop({...options,versions:{...versions,chrome:undefined}});assert.deepEqual(exits,[0,1]);assert.equal(starts,1);
 await bootstrapDesktop({...options,write:async()=>{throw Error('private sentinel');}});assert.deepEqual(exits,[0,1,1]);
 assert.throws(()=>desktopRuntimeVersions({...versions,openssl:'private path'}));
 for(const undici of [undefined,'','private sentinel'])assert.throws(()=>desktopRuntimeVersions({...versions,undici}));
});
test('candidate runtime inspection checks actual versions and executable stability without disclosing probe errors',async()=>{
 const hash='a'.repeat(64),calls=[],execute=async(file,args,options)=>{calls.push({file,args,options});return {stdout:JSON.stringify({format:1,platform:'linux',arch:'x64',versions})};};
 const options={expectedElectron:versions.electron,digest:async()=>hash,execute};
 const value=await collectDesktopRuntimeInventory('synthetic-executable',options);assert.equal(value.executableSha256,hash);assert.deepEqual(value.versions,desktopRuntimeVersions(versions));assert.doesNotMatch(JSON.stringify(value),/synthetic-executable|sentinel/);
 assert.equal(calls[0].options.windowsHide,true);assert.equal(calls[0].options.timeout,30000);assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE,undefined);assert.deepEqual(calls[0].args,['--observanda-runtime-inventory']);
 await assert.rejects(collectDesktopRuntimeInventory('synthetic',{...options,expectedElectron:'44.4.5'}),/Could not verify/);
 await assert.rejects(collectDesktopRuntimeInventory('synthetic',{...options,execute:async()=>({stdout:JSON.stringify({format:1,platform:'linux',arch:'x64',versions:{...versions,undici:undefined}})})}),/Could not verify/);
 let count=0;await assert.rejects(collectDesktopRuntimeInventory('synthetic',{...options,digest:async()=>count++? 'b'.repeat(64):hash}),/Could not verify/);
 await assert.rejects(collectDesktopRuntimeInventory('synthetic',{...options,execute:async()=>{throw Error('private sentinel');}}),error=>error.message==='Could not verify desktop runtime inventory.');
});
