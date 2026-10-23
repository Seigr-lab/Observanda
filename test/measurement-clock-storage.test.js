import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {blankClock} from '../src/web/measurement-model.js';
import {blankUnitDefinition,exactUnitScalar} from '../src/web/measurement-unit-model.js';
import {Workspace} from '../src/storage.js';
import {copyWorkspace,copyPlan,encryptedCopy} from '../src/locations.js';
import {contentBuffer} from '../src/file-content.js';
import {catalogueFormat,catalogueRequiresNativeClockModels} from '../src/catalogue-format.js';
import {nativeClockMetadata,nativeClockCommand} from '../src/numerical-material-format.js';
import {DurableJobs} from '../src/jobs.js';
import {enqueueDataset} from '../src/dataset-jobs.js';
const scalar=exactUnitScalar;
const column=name=>({name,representation:'radix',radix:6,unit:'counts',missing:[],time:{kind:'counter',reference:'',resolution:'',uncertainty:''}});
const definition={version:1,modulus:scalar('100000','radix',6),rate:{counts:scalar('15.3','radix-fraction',6),interval:scalar('0.1','radix-fraction',6),unit:'custom window',unitDefinition:{...blankUnitDefinition(),dimensions:[{axis:'custom.interval',exponent:1}],scale:scalar('1/6','rational')}}};
const declared=(c,refs={model:null,referenceData:null})=>({...c,time:{...c.time,clock:{...blankClock(),width:16,frequency:'1000',wrap:'modulo',reset:'observed',epoch:'Boundary after observation 2',...refs,definition}}});
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-clock-retention-')),book=upgradeNotebook(sampleNotebook()),f=await encryptedFixture(directory,book),m=new ResearchMaterials(f.workspace),recordId=book.entries[0].id,keys=[f.vault];
 t.after(async()=>{for(const key of keys)clearVault(key);await rm(directory,{recursive:true,force:true});});
 const upload=async(name,bytes)=>{const s=await m.startImport({recordId,name,size:bytes.length});await m.appendImport(s.id,0,[bytes]);return m.finishImport(s.id);};
 return {...f,directory,m,recordId,keys,upload};
}
const flagged=workspace=>workspace.catalogue(async store=>catalogueRequiresNativeClockModels(await catalogueFormat(store.db)));
test('clock metadata admission examines only explicit bounded schema, measurement and queued command fields',()=>{
 const typed=declared(column('Counter')),command={columnChanges:[{index:17,column:typed}]};
 assert.equal(nativeClockCommand(command),true);assert.equal(nativeClockMetadata('.observanda/jobs/id.json',{type:'dataset.prepare',input:{command}}),true);assert.equal(nativeClockMetadata('.observanda/materials/sequences/chunks/id.json',{kind:'columns',items:[typed]}),true);assert.equal(nativeClockMetadata('.observanda/materials/objects/id/revision.json',{content:{measurement:{time:typed.time}}}),true);assert.equal(nativeClockMetadata('.observanda/materials/objects/id/revision.json',{content:{columns:[typed]}}),true);
 assert.equal(nativeClockMetadata('.observanda/custom/id.json',{content:{columns:[typed]}}),false);assert.equal(nativeClockMetadata('.observanda/jobs/id.json',{type:'unrelated',input:{command}}),false);assert.equal(nativeClockCommand({note:JSON.stringify(command)}),false);assert.equal(nativeClockMetadata('.observanda/materials/sequences/chunks/id.json',{kind:'cells',items:[typed]}),false);
});
test('queued clock schema revisions require the capability before execution and retain exact inputs on reopen',async t=>{
 const f=await fixture(t),artifact=await f.upload('counter.csv',Buffer.from('Counter\n55\n0')),old=await f.m.dataset({recordId:f.recordId,title:'Counter',artifact,columns:[column('Counter')]}),command={recordId:f.recordId,title:'Counter',id:old.id,expectedRevision:old.revision,artifact,baseDataset:old,columnChanges:[{index:0,column:declared(column('Counter'))}]};
 assert.equal(await flagged(f.workspace),false);const queue=new DurableJobs(f.workspace,{'dataset.prepare':{authorize:async()=>{}}}),job=await enqueueDataset(f.m,queue,command);assert.equal(job.state,'queued');assert.equal(await flagged(f.workspace),true);assert.equal((await f.m.schemaPage(old)).items[0].time.clock,undefined);
 const reopened=new Workspace(f.workspace.root,f.vault),saved=await new DurableJobs(reopened,{}).read(job.id);assert.deepEqual(saved.input.command.columnChanges,command.columnChanges);assert.equal(await flagged(reopened),true);
});
test('declared clock schemas, pinned references and measurements survive revisions, ordinary copy and fresh-key recovery without rewriting counts',async t=>{
 const f=await fixture(t),{m,recordId}=f,original=Buffer.from(Array.from({length:18},(_,i)=>'C'+i).join(',')+'\n'+Array.from({length:18},()=> '55555').join(',')+'\n'+Array.from({length:18},()=> '0').join(',')),artifact=await f.upload('counts.csv',original),model=await f.upload('clock-model.txt',Buffer.from('Declared rate; resets unresolved')),referenceData=await f.upload('reference-data.txt',Buffer.from('Independent observations'));
 const columns=Array.from({length:18},(_,i)=>column('C'+i)),old=await m.dataset({recordId,title:'Counter observations',artifact,columns});assert.equal(await flagged(f.workspace),false);
 const typed=declared(columns[17],{model,referenceData}),current=await m.dataset({recordId,title:'Counter observations',id:old.id,expectedRevision:old.revision,artifact,baseDataset:old,columnChanges:[{index:17,column:typed}]});assert.deepEqual((await m.schemaPage(current,{offset:16})).items[1],typed);assert.equal((await m.schemaPage(old,{offset:16})).items[1].time.clock,undefined);assert.equal(await flagged(f.workspace),true);
 const source={ref:current,selector:{kind:'cell',page:0,row:0,column:17}},seed=await m.measurements.seed(source),measurement={version:1,...seed,references:{decoder:null,schema:model},decoderVersion:'',integrity:'not-checked',completion:'partial',note:'Rate declared; no inferred elapsed or synchronized time.'},retained=await m.measurements.save({recordId,title:'Counter reading',measurement});
 assert.deepEqual((await m.measurements.inspect(source)).time,typed.time);assert.equal((await m.measurements.inspect(source)).value.spelling,'55555');assert.equal((await m.measurements.inspect(source)).exact.numerator,'7775');assert.equal((await m.read(retained)).content.measurement.time.kind,'counter');
 const revisedMeasurement=await m.measurements.save({recordId,title:'Counter reading',id:retained.id,expectedRevision:retained.revision,measurement:{...measurement,note:'Reviewed reset boundary without modifying counts.'}});assert.equal((await m.read(revisedMeasurement)).previous,retained.revision);
 const changed=await m.dataset({recordId,title:'Counter observations',id:old.id,expectedRevision:current.revision,artifact,baseDataset:current,columnChanges:[{index:17,column:{...typed,time:{...typed.time,clock:{...typed.time.clock,definition:{...definition,rate:{...definition.rate,counts:scalar('23/2','rational')}}}}}}]});assert.equal((await m.read(changed)).previous,current.revision);assert.deepEqual((await m.read(retained)).content.measurement.time.clock.definition,definition);
 await assert.rejects(m.dataset({recordId,title:'Invalid clock',artifact,columns:[{...typed,time:{...typed.time,clock:{...typed.time.clock,definition:{...definition,modulus:scalar('1/2','rational')}}}}]}),{code:'MATERIAL_INVALID'});await m.verify();
 const ordinary=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'ordinary')),{vault:f.vault}),access=await createWorkspaceAccess('','',f.deviceStore),freshVault=takeCreatedVault(access);f.keys.push(freshVault);const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'fresh')),access,freshVault,f.vault);
 for(const [root,vault] of [[ordinary,f.vault],[fresh,freshVault]]){const workspace=new Workspace(root,vault),restored=new ResearchMaterials(workspace);await restored.verify();assert.equal(await flagged(workspace),true);assert.deepEqual((await restored.schemaPage(current,{offset:17})).items[0],typed);assert.deepEqual((await restored.read(retained)).content.measurement,measurement);assert.equal((await restored.read(revisedMeasurement)).previous,retained.revision);assert.equal((await restored.retainedDatasetPage(await restored.read(current),0,{columns:[17]})).rows[1].cells[0],'0');assert.deepEqual(await contentBuffer((await restored.artifact(artifact)).content),original);for(const ref of [model,referenceData])assert.deepEqual((await restored.read(ref)).content,(await m.read(ref)).content);}
});
