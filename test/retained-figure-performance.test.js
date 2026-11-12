import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {convertPublicationRecord} from '../src/publication-conversion-render.js';
import {createFigure} from '../src/web/figure-model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';

// Retaining a measured series and drawing its website copy must stay close to
// linear in its points. Exact values are drawn for every observation.
test('retained figures are saved and drawn for the website in near-linear time',{timeout:1800000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-figure-scale-')),book=sampleNotebook(),record=book.entries[0];book.entries=[record];
 const {workspace,vault}=await encryptedFixture(directory,book);t.after(async()=>{await closeIdleMutationFiles();await clearVault(vault);await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:100});});
 const measured={};
 for(const count of [400,4000]){
  const figure=createFigure();figure.title='Series of '+count;figure.series[0].points=Array.from({length:count},(_,i)=>({x:i,y:Number((1+i/7).toFixed(6)),error:null}));
  let started=performance.now();const retained=await workspace.withLock(()=>new RetainedFigureDocuments(workspace).retain(figure)),retain=performance.now()-started;
  started=performance.now();const output=await convertPublicationRecord(workspace,book,{...record,share:true,figures:[retained],results:undefined}),draw=performance.now()-started;
  // A website figure is drawn once per number style its page languages use;
  // every drawing holds every observation.
  const drawings=output.assets.filter(asset=>asset.path.endsWith('.svg')).map(asset=>String(asset.bytes));assert.ok(drawings.length>=1);
  for(const svg of drawings)assert.equal(svg.split('class="figure-observation"').length-1,count);
  measured[count]={retain,draw};t.diagnostic(`${count} points: retain ${Math.round(retain)} ms, website drawing ${Math.round(draw)} ms`);
 }
 // A 400-point figure fits the block caches; a 4000-point one is read and
 // written in batches of 32 blocks and packed member runs. Measured on
 // 2026-11-11: drawing grew 8.6x and saving 15.8x for 10x points (saving was
 // 78x before batched reads in the writer's coordinate pass). The bounds keep
 // about half as much again for machine noise.
 for(const [step,bound] of [['draw',14],['retain',24]])assert.ok(measured[4000][step]<measured[400][step]*bound,step+' grew '+(measured[4000][step]/measured[400][step]).toFixed(1)+'x for 10x points');
});
