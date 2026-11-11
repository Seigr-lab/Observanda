import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {RetainedFigureAuthoring} from '../src/retained-figure-authoring.js';
import {createFigure} from '../src/web/figure-model.js';
import {catalogueFormat,catalogueRequiresMemberRuns} from '../src/catalogue-format.js';

// The generation an app released before member runs could open.
const PREVIOUS_MAX_GENERATION=3377699720527993;

test('a catalogue records member runs in its format when it first stores one, so older apps refuse it',async t=>{
 const parent=await realpath(os.tmpdir()),root=await mkdtemp(path.join(parent,'observanda-member-runs-')),f=await encryptedFixture(root,sampleNotebook());
 t.after(async()=>{await clearVault(f.vault);assert.equal(path.dirname(root),parent);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const format=()=>f.workspace.catalogue(async store=>catalogueFormat(store.catalogueDb??store.db));
 const figure=createFigure();figure.series[0].points=Array.from({length:40},(_,i)=>({x:i,y:i*2,error:null}));
 // Drafts keep single members and leave the generation as it was.
 const draft=await f.workspace.withLock(()=>new RetainedFigureAuthoring(f.workspace).start(figure));assert.equal(draft.document.format,'figure-authoring');
 assert.equal(catalogueRequiresMemberRuns(await format()),false);assert.ok(await format()<=PREVIOUS_MAX_GENERATION);
 const saved=await f.workspace.withLock(()=>new RetainedFigureDocuments(f.workspace).retain(figure)),after=await format();
 assert.equal(catalogueRequiresMemberRuns(after),true);assert.ok(after>PREVIOUS_MAX_GENERATION,'an app with the previous generation limit refuses this catalogue');
 const reader=await new RetainedFigureDocuments(f.workspace,{readOnly:true}).open(saved);await reader.verify();
 assert.deepEqual((await reader.window({collection:'points',offset:38,limit:2})).items.map(item=>item.value),figure.series[0].points.slice(38));
});
