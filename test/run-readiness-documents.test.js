import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {preparation,assessment} from './fixtures/attempts.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {RunReadiness} from '../src/run-readiness.js';
import {RetainedRecordDocuments} from '../src/retained-record-documents.js';
import {digest} from '../src/storage-format.js';

test('large-record readiness preserves criteria and receipt guards without reconstructing the record',async t=>{
 const f=await figureValueFixture({large:true});t.after(f.close);const ready=new RunReadiness(f.workspace),command={workspaceId:f.book.id,recordId:f.record.id};
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Readiness reconstructed the full record');});t.mock.method(ResearchMaterials.prototype,'owner',()=>{throw Error('Readiness requested the full owner');});
 const save=async(field,value)=>{const target={...command,field},base=await f.values.read(target);return f.values.save({...target,expectedRevision:base.revision,value:{value}});};
 const p=preparation();p.criteria=p.criteria.slice(0,1);await save('attempt:preparation:'+p.id,p);let view=await ready.view(command);assert.deepEqual(view.unresolved,p.criteria.map(({id,label})=>({id,label})));
 const a=assessment(p);await save('attempt:assessment:'+a.id,a);assert.deepEqual((await ready.view(command)).unresolved,[]);
 const correction={...a,id:randomUUID(),supersedes:a.id,outcome:'unresolved',reason:'Review needs another acquisition'};await save('attempt:assessment:'+correction.id,correction);assert.equal((await ready.view(command)).unresolved.length,1);
 view=await ready.view(command);await ready.setPolicy({...command,expectedProjectId:view.projectId,expectedPolicy:view.policy.etag,required:['validation']});await assert.rejects(save('status','completed'),{code:'INTAKE_COMPLETION'});
 const receiptCommand={...command,id:randomUUID(),kind:'validation',expectedRevision:view.revision,expectedEvidenceRevision:view.evidenceRevision,sourceRevision:'Synthetic acquisition',sourceSha256:digest('source'),statement:'Exact retained source inspected; unresolved criteria remain explicit.',tool:'Independent inspection',toolVersion:'1',toolSha256:digest('validator')};
 const append=ready.appendLocked.bind(ready);t.mock.method(ready,'appendLocked',async(...args)=>{await append(...args);throw Error('Receipt interrupted');});await assert.rejects(ready.link(receiptCommand),/Receipt interrupted/);ready.appendLocked.mock.restore();assert.deepEqual((await ready.receiptPage(command.recordId)).items,[]);assert.equal(await f.workspace.readMetadata('.observanda/materials/records/'+command.recordId+'/'+view.revision+'.json',1024),null);
 const receipt=await ready.link(receiptCommand);assert.deepEqual(await ready.link(receiptCommand),receipt);assert.equal((await new RetainedRecordDocuments(f.workspace).read({ref:{kind:'record',id:command.recordId,revision:view.revision}})).previous.header.title,f.record.title);
 await save('status','completed');view=await ready.view(command);assert.deepEqual(view.missing,[]);assert.equal(view.receipts[0].current,true);assert.equal(view.unresolved.length,1);
 await save('status','draft');await save('title','Changed interpretation');view=await ready.view(command);assert.deepEqual(view.missing,['validation']);await assert.rejects(ready.link({...receiptCommand,id:randomUUID()}),{code:'RECORD_CHANGED'});assert.deepEqual(await ready.link(receiptCommand),receipt);
 await assert.rejects(ready.view({...command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});await assert.rejects(ready.view({...command,recordId:randomUUID()}),{code:'MATERIAL_INVALID'});
 const controller=new AbortController();controller.abort();await assert.rejects(ready.view(command,{signal:controller.signal}),{name:'AbortError'});
});
