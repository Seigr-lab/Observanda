import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {createFigure} from '../src/web/figure-model.js';
import {createComposition} from '../src/web/figure-composition.js';
import {copyFigureResults} from '../src/web/figure-result-links.js';
import {preparation,assessment} from './fixtures/attempts.js';

test('a copied panel retains its exact analysis and edited measurements are identified before publication',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-panel-provenance-')),book=upgradeNotebook(sampleNotebook()),[record,method]=book.entries,plot=createFigure();plot.series[0].points=[{x:0,y:2,error:.1},{x:1,y:3,error:.2}];record.figures=[plot];
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});const materials=new ResearchMaterials(f.workspace);
 const analysis=await f.workspace.withLock(async()=>materials.commit({kind:'analysis',recordId:record.id,title:'Retained calculation',content:{inputs:[await materials.retainRecord(method)],outputs:[],tool:'Synthetic calculator',version:'1',parameters:'Declared two-row projection',figure:plot}}));
 const sourceResults={version:1,statements:[{id:randomUUID(),kind:'figure',figureId:plot.id,title:'Exact calculation source',text:'Two retained points.',limitations:'Synthetic verification only.',basis:'retained',source:analysis}]},compound=createComposition([plot,plot]);
 record.figures.push(compound);record.results=copyFigureResults(sourceResults,[[plot,compound.panels[0].figure],[plot,compound.panels[1].figure]]);
 const service=new ResearchRecords(f.workspace,{}),base=(await f.workspace.read()).book.entries.find(r=>r.id===record.id);await service.save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(base),record}]});
 const saved=(await f.workspace.read()).book,first=await materials.releaseSources(saved,[record.id]);assert.equal(first.sources.filter(s=>s.resultId).length,3);assert.ok(first.sources.every(s=>s.analysis.revision===analysis.revision));assert.equal(first.warnings.filter(w=>w.reason==='edited').length,0);
 const changed=structuredClone(saved);changed.entries.find(r=>r.id===record.id).figures[1].panels[1].figure.series[0].points[0].y=25;
 const second=await materials.releaseSources(changed,[record.id]);assert.deepEqual(second.warnings.filter(w=>w.reason==='edited'),[{recordId:record.id,figureId:compound.panels[1].figure.id,reason:'edited'}]);assert.equal((await materials.read(analysis)).content.figure.series[0].points[0].y,2);
});


test('result and current assessment sources remain checked without legacy figure discovery',async()=>{
 const workspaceId=randomUUID(),recordId=randomUUID(),resultId=randomUUID(),resultRef={kind:'analysis',id:randomUUID(),revision:'a'.repeat(64)},assessmentRef={kind:'analysis',id:randomUUID(),revision:'b'.repeat(64),workspaceId},supersededRef={kind:'analysis',id:randomUUID(),revision:'c'.repeat(64),workspaceId};
 const prep=preparation(),before=assessment(prep,0,{references:[{...supersededRef,label:'Superseded calculation'}]}),current=assessment(prep,0,{supersedes:before.id,references:[{...assessmentRef,label:'Current calculation'}]});
 const record={id:recordId,figures:[],results:{version:1,statements:[{id:resultId,kind:'conclusion',basis:'retained',source:resultRef,title:'Exact result',text:'Synthetic result.',limitations:'Synthetic verification only.'}]},attempt:{version:1,preparations:[prep],events:[],assessments:[before,current]}};
 const book={id:workspaceId,entries:[record,{id:randomUUID(),figures:[createFigure()]}]},materials=new ResearchMaterials({root:path.join(os.tmpdir(),'observanda-result-provenance'),storageKind:async()=> 'file'}),reads=[];
 materials.readSnapshot=operation=>operation(null);materials.headEntries=async function*(){assert.fail('Result-only sources scanned legacy figure heads');};
 materials.read=async ref=>{reads.push(ref);return {content:{}};};
 const result=await materials.releaseSources(book,[recordId]);assert.deepEqual(reads,[resultRef,assessmentRef]);assert.deepEqual(result,{sources:[{recordId,resultId,label:'Exact result',analysis:resultRef},{recordId,assessmentId:current.id,label:prep.criteria[0].label,analysis:assessmentRef}],warnings:[]});
 const missing=new Error('Retained analysis unavailable');materials.read=async()=>{throw missing;};await assert.rejects(materials.releaseSources(book,[recordId]),error=>error===missing);
 const controller=new AbortController(),reason=new Error('Cancelled retained source review');materials.read=async()=>{controller.abort(reason);return {content:{}};};await assert.rejects(materials.releaseSources(book,[recordId],{signal:controller.signal}),error=>error===reason);
});
