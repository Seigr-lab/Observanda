import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,rm,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dependencyInventory,collectRuntimeInventory} from '../scripts/release-inventory.js';
import {sealPreparedRuntime} from '../scripts/runtime-input-trust.js';

test('release SBOM separates build dependencies and excludes resolved credentials and private paths',()=>{
 const pkg={version:'1.2.3',integrity:'sha512-'+Buffer.alloc(64,17).toString('base64'),resolved:'https://user:secret@example.invalid/private/sentinel',license:'MIT'};
 const lock={lockfileVersion:3,packages:{'':{},'node_modules/library':pkg,'node_modules/@scope/builder':{...pkg,dev:true}}};
 const all=dependencyInventory(lock),runtime=dependencyInventory(lock,{productionOnly:true});
 assert.equal(all.components.length,2);assert.equal(runtime.components.length,1);assert.equal(runtime.components[0].name,'library');
 assert.doesNotMatch(JSON.stringify(all),/secret|sentinel|example.invalid/);
 assert.throws(()=>dependencyInventory({...lock,packages:{'node_modules/missing':{version:'1.0.0'}}}),/integrity/);
 assert.throws(()=>dependencyInventory({...lock,packages:{'node_modules/../outside':pkg}}),/identity/);
 assert.throws(()=>dependencyInventory({...lock,packages:{'node_modules/linked':{...pkg,link:true}}}),/identity/);
});

async function probes(t,overrides={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-inventory-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const bytes='Synthetic authenticated runtime',hash=createHash('sha256').update(bytes).digest('hex'),versions={node:'24.22.1',undici:'7.30.1',openssl:'3.5.4',uv:'1.51.0',v8:'13.6.233.17-node.37',zlib:'1.3.1'};
 for(const relative of ['runtime/node.exe','postgresql/bin/postgres.exe','media/bin/ffmpeg.exe','media/bin/ffprobe.exe','media/bin/dependency.dll','github/git/cmd/git.exe','github/credential-manager/git-credential-manager.exe','pdf-validation/java/bin/java.exe','pdf-validation/verapdf-cli.jar']){
  const file=path.join(root,relative);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes);
 }
 const outputs={'node.exe':JSON.stringify(versions),'postgres.exe':'postgres (PostgreSQL) 17.11','ffmpeg.exe':'ffmpeg version 9.0.2-full_build','ffprobe.exe':'ffprobe version 9.0.2-full_build','git.exe':'git version 2.56.0.windows.4','git-credential-manager.exe':'3.0.2+build','java.exe':'OpenJDK Runtime Environment Temurin-25.0.5+8 (build 25.0.5+8-LTS)'};
 const calls=[];return {root,hash,calls,options:{admission:await sealPreparedRuntime(root),platform:'win32',nodeVersion:versions.node,inspectDotnet:async()=>({kind:'host-requirement',name:'.NET Framework',minimumVersion:'4.7.2',configurationSha256:hash}),read:async()=>JSON.stringify({validatorVersion:'1.30.3',validatorSha256:hash}),execute:async(file,args,options)=>{calls.push({file,args,options});return {stdout:outputs[path.basename(file)],stderr:''};},...overrides}};
}
test('shipping runtime inventory measures admitted executables with isolated bounded probes',async t=>{
 const p=await probes(t),result=await collectRuntimeInventory(p.root,p.options);
 assert.equal(p.calls.length,7);assert.equal(result.components.length,13);
 assert.equal(result.components.find(c=>c.name==='Node.js/undici').version,'7.30.1');
 assert.equal(result.components.find(c=>c.name==='Java').version,'25.0.5+8-LTS');
 assert.equal(result.format,2);assert.equal(result.hostRequirements[0].minimumVersion,'4.7.2');
 assert.equal(result.hostRequirements[0].requiredBy,'github/credential-manager/git-credential-manager.exe');
 for(const call of p.calls){assert.equal(call.options.windowsHide,true);assert.equal(call.options.timeout,30000);assert.equal(call.options.maxBuffer,65536);assert.equal(call.options.env.NODE_OPTIONS,'');assert.notEqual(call.options.cwd,p.root);assert.equal(call.options.env.HOME,call.options.cwd);}
 await assert.rejects(stat(p.calls[0].options.cwd),{code:'ENOENT'});
 assert.ok(!JSON.stringify(result).includes(p.root));
});
test('bundled .NET inventory binds its metadata to the helper digest',async t=>{
 const p=await probes(t);p.options.inspectDotnet=async()=>({kind:'bundled',name:'.NET',version:'10.0.9',sha256:p.hash,metadataFormat:'dotnet-single-file-6.0'});
 const result=await collectRuntimeInventory(p.root,p.options);
 assert.deepEqual(result.hostRequirements,[]);assert.equal(result.components.find(c=>c.name==='.NET').version,'10.0.9');
 await assert.rejects(collectRuntimeInventory(p.root,{...p.options,inspectDotnet:async()=>({kind:'bundled',sha256:'b'.repeat(64)})}),/inconsistent/);
});
test('runtime inventory refuses missing, unexpected and changed runtimes without disclosing probe output',async t=>{
 const p=await probes(t),execute=p.options.execute;
 await assert.rejects(collectRuntimeInventory(p.root,{...p.options,execute:(file,args,options)=>path.basename(file)==='git.exe'?{stdout:'git version 2.56.0.windows.2'}:execute(file,args,options)}),/Windows Git differs/);
 await assert.rejects(collectRuntimeInventory(p.root,{...p.options,execute:(file,args,options)=>path.basename(file)==='java.exe'?{stderr:'OpenJDK Runtime Environment Temurin-25.0.4+5 (build 25.0.4+5-LTS)'}:execute(file,args,options)}),/Java differs/);
 await assert.rejects(collectRuntimeInventory(p.root,{...p.options,credentialVersion:'2.9.1'}),/credential helper differs/);
 await assert.rejects(collectRuntimeInventory(p.root,{...p.options,nodeVersion:'24.0.0'}),/differs/);
 await assert.rejects(collectRuntimeInventory(p.root,{...p.options,execute:async()=>{throw Error('private-file password=secret');}}),error=>error.message==='Runtime version probe failed: Node.js');
 await assert.rejects(collectRuntimeInventory(p.root,{...p.options,execute:async()=>({stdout:'private-file password=secret'})}),error=>error.message==='Runtime version is not identifiable: Node.js');
 await assert.rejects(collectRuntimeInventory(p.root,{...p.options,read:async()=>JSON.stringify({validatorVersion:'1.30.3',validatorSha256:'b'.repeat(64)})}),/digest differs/);
});

test('unadmitted or modified executable trees are rejected before the first inventory probe',async t=>{
 const p=await probes(t);
 for(const admission of [undefined,{}])await assert.rejects(collectRuntimeInventory(p.root,{...p.options,admission}),/pre-execution admission/);
 await writeFile(path.join(p.root,'media/bin/dependency.dll'),'Tampered dependency');
 await assert.rejects(collectRuntimeInventory(p.root,p.options),/changed after admission/);
 assert.equal(p.calls.length,0);
});
