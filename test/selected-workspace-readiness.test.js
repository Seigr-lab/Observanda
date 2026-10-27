import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,rename,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {serviceHealth} from '../src/service-health.js';
import {clearVault} from '../src/encryption.js';
import {workspaceFile} from '../src/storage.js';
import {openCatalogue} from '../src/postgres.js';

test('selected readiness authenticates bounded metadata independently of scratch and preserves data',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-readiness-')),f=await encryptedFixture(directory,sampleNotebook());let db;t.after(async()=>{await db?.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 let scratch=process.env;const provider={healthEnvironments:()=>({scratch,selected:process.env})},options={root:f.workspace.root,workspace:f.workspace,locked:false,provider},head=(await f.workspace.outline()).etag;
 let report=await serviceHealth(options);assert.equal(report.selectedWorkspace.ready,true,JSON.stringify(report));assert.equal(report.selectedWorkspace.scope,'selected-workspace');assert.equal(report.selectedWorkspace.catalogueIntegrity,'selected-metadata-verified');assert.equal(report.selectedWorkspace.retainedContent,'not-checked');assert.equal(report.selectedWorkspace.storageWrites,'not-probed');
 const bad=new URL(process.env.OBSERVANDA_DATABASE_URL);bad.password='wrong-readiness-password';scratch={...process.env,OBSERVANDA_DATABASE_URL:bad.href};report=await serviceHealth(options);assert.equal(report.scratch.ready,false);assert.equal(report.serviceReadiness.ready,false);assert.equal(report.selectedWorkspace.ready,true);scratch=process.env;
 const file=await workspaceFile(f.workspace.root),bytes=await readFile(file);await rename(file,file+'.withheld');
 report=await serviceHealth(options);assert.equal(report.scratch.ready,true);assert.equal(report.selectedWorkspace.ready,false);await rename(file+'.withheld',file);
 const corrupted=Buffer.from(bytes);corrupted[corrupted.length-1]^=1;await writeFile(file,corrupted);report=await serviceHealth(options);assert.equal(report.selectedWorkspace.ready,false);assert.equal(report.selectedWorkspace.code,'ENCRYPTION_DAMAGED');await writeFile(file,bytes);
 db=await openCatalogue(f.workspace.root,{detached:true,vault:f.vault});
 const payload=(await db.get("SELECT payload FROM state WHERE slot='head'")).payload;
 try{
  await db.run("UPDATE state SET payload=$1 WHERE slot='head'",Buffer.from('damaged'));report=await serviceHealth(options);assert.equal(report.scratch.ready,true);assert.equal(report.selectedWorkspace.ready,false);
 }finally{await db.run("UPDATE state SET payload=$1 WHERE slot='head'",payload);}
 const snapshot=(await db.get('SELECT payload FROM snapshots WHERE id=$1',head)).payload;
 try{
  await db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',Buffer.alloc(2*1024*1024+1),head);report=await serviceHealth(options);assert.equal(report.selectedWorkspace.state,'incomplete');assert.equal(report.selectedWorkspace.code,'READINESS_LIMIT');
 }finally{await db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',snapshot,head);}
 report=await serviceHealth({...options,locked:true});assert.equal(report.selectedWorkspace.state,'locked');assert.equal(report.selectedWorkspace.catalogueIntegrity,'not-checked');
 report=await serviceHealth({...options,authorize:async()=>false});assert.equal(report.selectedWorkspace.state,'locked');assert.equal(report.selectedWorkspace.catalogueIntegrity,'not-checked');
 report=await serviceHealth(options);assert.equal(report.selectedWorkspace.ready,true);assert.equal((await f.workspace.outline()).etag,head);assert.deepEqual(await readFile(file),bytes);
 assert.doesNotMatch(JSON.stringify(report),/observanda-readiness-|wrong-readiness-password|postgresql:\/\//);
});
