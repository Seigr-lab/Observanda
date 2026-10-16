import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,rename,symlink,link,readdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';import os from 'node:os';
import {inventorySource} from '../src/migration/inventory.js';
import {inspectSource} from '../src/migration/runner.js';
import {validateInventoryManifest} from '../src/migration/adapters.js';
import {migrationFixture} from './migration-fixture.js';

async function fixture(t,options={creative:true}){
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-migration-')),root=path.join(parent,'source');
 t.after(()=>rm(parent,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
 return {root,parent,...await migrationFixture(root,options)};
}
async function save(f){await writeFile(path.join(f.root,'inventory.observanda-source.json'),JSON.stringify(f.manifest,null,2)+'\n');}
async function verifyOriginals(f){
 assert.equal((await readdir(f.root)).includes('.observanda'),false);
 for(const [name,expected]of f.originals){const sha=createHash('sha256');let bytes=0;for await(const part of createReadStream(path.join(f.root,name))){sha.update(part);bytes+=part.length;}assert.equal(sha.digest('hex'),expected.sha256,name);assert.equal(bytes,expected.bytes,name);}
}
test('full adoption inventory accounts for originals, exact relationships, repeated runs and independent outcomes without modifying bytes',async t=>{
 const f=await fixture(t,{full:true}),report=await inspectSource({source:f.root});
 assert.equal(report.complete,true);for(const field of ['objects','files','mapped','excluded'])assert.equal(report.counts[field],f.expected[field]);
 assert.equal(report.objects.filter(o=>o.kind==='investigation').length,42);
 assert.equal(report.objects.filter(o=>o.kind==='run').length,70);
 const nested=report.objects.filter(o=>o.links.some(l=>l.type==='prior-attempt-of'));
 assert.equal(nested.length,f.expected.nestedPriorRuns);assert.ok(nested.every(o=>o.files[0].selector.value==='/priorAttempts/0'&&o.files[0].verification.status==='verified'));
 assert.equal(report.objects.filter(o=>o.kind==='investigation'&&o.attributes.state==='completed').length,41);
 assert.equal(report.objects.filter(o=>o.kind==='investigation'&&o.attributes.state==='active').length,1);
 const preparation=report.objects.find(o=>o.id==='preparation-1').links,returned=report.objects.find(o=>o.id==='acquisition-1').links.filter(l=>l.type==='includes');
 assert.equal(preparation.length,f.expected.preparationArtifacts);assert.equal(returned.length,f.expected.returnedArtifacts);
 const bytes=links=>links.reduce((sum,l)=>sum+report.objects.find(o=>o.id===l.id).files[0].bytes,0);
 assert.equal(bytes(preparation),f.expected.preparationBytes);assert.equal(bytes(returned),f.expected.returnedBytes);
 t.diagnostic(JSON.stringify({workload:'A1 synthetic full source',files:report.counts.files,bytes:report.counts.bytes,...report.inspection}));
 assert.equal(report.files.find(f=>f.path==='originals/capture.bin').bytes,96*1024*1024);
 assert.ok(report.files.find(f=>f.path==='originals/analysis.json').bytes>16*1024*1024);
 assert.equal(report.objects.find(o=>o.id==='artifact-247').attributes.observations,4344);
 assert.equal(report.objects.find(o=>o.id==='observations').files[0].verification.status,'verified');
 assert.ok(report.inspection.peakMemoryBytes<256*1024*1024,'full source inventory worker stays within its 256 MiB operating budget');
 assert.ok(report.inspection.durationMs<60000,'full source inspection stays within its 60 second qualification budget');
 const data=JSON.parse(await readFile(path.join(f.root,'originals/analysis.json'),'utf8'));assert.equal(data.observations.length,4344);assert.equal(data.observations[0].counter,'900719925474099312345');assert.deepEqual(data.observations[0].value,{digits:'105',radix:6});assert.equal(data.observations[4343].missing,'not-acquired');
 assert.equal(report.objects.find(o=>o.id==='run-1').attributes.outcome,'incomplete');
 assert.equal(report.objects.find(o=>o.id==='run-0').links.find(l=>l.type==='followed').revision,'r1');
 assert.equal(report.objects.find(o=>o.id==='acquisition-assessment').attributes.outcome,'met');
 assert.equal(report.objects.find(o=>o.id==='recognition-assessment').attributes.outcome,'unresolved');
 assert.ok(report.objects.filter(o=>o.kind==='artifact').every(o=>o.audience==='private'));
 assert.equal(JSON.stringify(report).includes(f.root),false);
 assert.equal(report.readOnly,true);await verifyOriginals(f);
 // Source identity is portable and changes only when source declarations/bytes change.
 const moved=path.join(f.parent,'relocated');await rename(f.root,moved);
 const again=await inventorySource({source:moved,expectedPin:report.source.pin});assert.equal(again.source.pin,report.source.pin);
});
test('creative records keep unknown dates and observations without compulsory criteria',async t=>{
 const f=await fixture(t),report=await inventorySource({source:f.root});
 assert.equal(report.complete,true);assert.equal(report.counts.objects,4);assert.equal(report.counts.files,5);
 if(process.platform==='win32')assert.equal((await inventorySource({source:f.root.toLowerCase()})).source.pin,report.source.pin);
 const a=report.objects.find(o=>o.id==='morning-one'),b=report.objects.find(o=>o.id==='morning-two');
 assert.deepEqual(a.dates,[{meaning:'observation',value:'2026-04'}]);assert.equal(b.dates[0].value,null);
 assert.equal(a.attributes.outcome,'observed');assert.ok(!JSON.stringify(report.objects).includes('hypothesis'));
 await verifyOriginals(f);
});
test('inventory blocks missing dependencies, ambiguous boundaries, duplicate identities and unaccounted files',async t=>{
 const f=await fixture(t),one=f.manifest.objects[1],two=f.manifest.objects[2];
 two.files=one.files;two.links.push({type:'missing-method',id:'absent',revision:'r0',required:true});
 f.manifest.objects.push(structuredClone(f.manifest.objects[0]));await save(f);
 await writeFile(path.join(f.root,'unlisted.txt'),'not declared');
 const report=await inventorySource({source:f.root});
 assert.equal(report.complete,false);assert.equal(report.counts.unaccountedFiles,2); // old second-run file plus unlisted file
 assert.ok(report.objects[0].issues.some(i=>i.code==='duplicate-identity'));
 assert.ok(report.objects[1].issues.some(i=>i.code==='ambiguous-boundary'));
 // A missing exact revision is not silently resolved to the current method.
 const clean=await fixture(t);clean.manifest.objects[1].links[0].revision='r9';await save(clean);
 const blocked=await inventorySource({source:clean.root});assert.equal(blocked.objects[1].status,'conflict');assert.match(blocked.objects[1].issues[0].message,/r9/);
});
test('every unsafe, missing, unsupported and intentionally excluded object stays visible',async t=>{
 const f=await fixture(t);
 await rm(path.join(f.root,'field/one.json'));
 f.manifest.objects[2].disposition='unsupported';f.manifest.objects[2].reason='Native structure needs a dedicated adapter.';
 f.manifest.objects[3].disposition='exclude';f.manifest.objects[3].reason='Do not import this recording.';
 await save(f);const report=await inventorySource({source:f.root});
 assert.equal(report.complete,false);assert.equal(report.counts.missing,1);assert.equal(report.counts.unsupported,1);assert.equal(report.counts.excluded,1);assert.equal(report.counts.objects,4);
});
test('read-only inspection never follows links, runs scripts or fetches source URLs',async t=>{
 const f=await fixture(t),outside=path.join(f.parent,'outside');await writeFile(outside,'outside sentinel');
 await link(outside,path.join(f.root,'hard-link'));await writeFile(path.join(f.root,'script.js'),"throw Error('must not execute')");
 const report=await inventorySource({source:f.root});assert.equal(report.counts.unsafeFiles,1);assert.equal(report.counts.unaccountedFiles,1);assert.equal(report.complete,false);
 assert.equal(report.files.find(f=>f.path==='hard-link').sha256,null);
 if(process.platform!=='win32'){await symlink(f.parent,path.join(f.root,'escape'));assert.equal((await inventorySource({source:f.root})).counts.unsafeFiles,2);}
 else{await symlink(f.parent,path.join(f.root,'escape'),'junction');assert.equal((await inventorySource({source:f.root})).counts.unsafeFiles,2);}
 assert.equal(await readFile(outside,'utf8'),'outside sentinel');
});
test('bad paths, unknown formats, byte mismatches and changed source pins cannot yield complete inventories',async t=>{
 const f=await fixture(t);
 for(const pathValue of ['../outside','C:/private','folder\\file','/absolute','x:stream','CON','folder/../file']){
  const value=structuredClone(f.manifest);value.objects[0].files[0].path=pathValue;assert.ok(validateInventoryManifest(value).length,pathValue);
 }
 const invalid=structuredClone(f.manifest);invalid.adapter.version=2;assert.ok(validateInventoryManifest(invalid).length);
 const before=await inventorySource({source:f.root});await writeFile(path.join(f.root,'procedure.json'),'replaced');
 const after=await inventorySource({source:f.root});assert.equal(after.complete,false);assert.ok(after.objects[0].issues.some(i=>i.code==='byte-mismatch'));
 await assert.rejects(inventorySource({source:f.root,expectedPin:before.source.pin}),{code:'INVENTORY_CHANGED'});
 await assert.rejects(inventorySource({source:f.root,manifest:'../outside'}),{code:'INVENTORY_INVALID'});
});
test('cancel, timeout and source mutation abort without a partial completeness claim; retry succeeds',async t=>{
 const f=await fixture(t);const controller=new AbortController();
 await assert.rejects(inventorySource({source:f.root},{signal:controller.signal,onProgress:()=>controller.abort()}),{code:'INVENTORY_CANCELLED'});
 await assert.rejects(inspectSource({source:f.root},{timeout:1}),{code:'INVENTORY_TIMEOUT'});
 let changed=false;await assert.rejects(inventorySource({source:f.root},{onProgress:async p=>{if(p.phase==='verifying'&&!changed){changed=true;await writeFile(path.join(f.root,'new-file'),'concurrent');}}}),{code:'INVENTORY_CHANGED'});
 await rm(path.join(f.root,'new-file'));assert.equal((await inspectSource({source:f.root})).complete,true);
});
test('CLI inventory has a read-only JSON contract and does not start PostgreSQL',async t=>{
 const f=await fixture(t);
 const run=args=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['src/cli.js','inventory','--source',f.root,'--json',...args],{windowsHide:true,env:{...process.env,OBSERVANDA_DATABASE_URL:'invalid database must not be used',OBSERVANDA_POSTGRES_BIN:'missing'},stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>resolve({code,out,err}));
 });
 const result=await run([]);assert.equal(result.code,0,result.err);assert.equal(JSON.parse(result.out).complete,true);
 await writeFile(path.join(f.root,'unlisted'),'unaccounted');const blocked=await run([]);assert.equal(blocked.code,2,blocked.err);assert.equal(JSON.parse(blocked.out).complete,false);
});
