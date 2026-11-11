import {test} from 'node:test';
import assert from 'node:assert/strict';
import {figureDateTicks,figureDateLabel,FIGURE_DATE_FORMATS} from '../src/web/figure-time-axis.js';
import {validFigureStyle} from '../src/web/figure-style.js';
import {createFigure} from '../src/web/figure-model.js';
import {renderFigure} from '../src/web/figure-renderer.js';
import {retainedFigureProperties} from '../src/web/retained-figure-properties.js';

const start=Date.parse('2026-03-01T12:00:00.000Z');
const coordinateLabels=svg=>[...svg.matchAll(/<text class="figure-coordinate-tick"[^>]*><title>([^<]*)<\/title>/g)].map(m=>m[1]);

test('sub-second spans step through whole milliseconds and seconds',()=>{
 const ms=figureDateTicks({min:start,max:start+40},5,'milliseconds');
 assert.ok(ms.length>=2);assert.ok(ms.every(v=>Number.isInteger(v)&&v>=start&&v<=start+40));
 assert.equal(new Set(ms.map(v=>figureDateLabel(v,'milliseconds'))).size,ms.length);
 const seconds=figureDateTicks({min:start,max:start+12000},6,'seconds');
 assert.ok(seconds.length>=3);assert.ok(seconds.every(v=>v%1000===0));
 // Coarser formats never subdivide below their own unit.
 assert.ok(figureDateTicks({min:start,max:start+12000},6,'datetime').every((v,i,a)=>!i||v-a[i-1]>=60000));
 assert.ok(figureDateTicks({min:start,max:start+5*86400000},5,'date').every(v=>v%86400000===0));
});

test('labels are UTC ISO spellings at the chosen resolution',()=>{
 const value=Date.parse('2026-03-01T12:34:56.789Z');
 assert.equal(figureDateLabel(value,'milliseconds'),'2026-03-01 12:34:56.789 UTC');
 assert.equal(figureDateLabel(value,'seconds'),'2026-03-01 12:34:56 UTC');
 assert.equal(figureDateLabel(value,'datetime'),'2026-03-01 12:34 UTC');
 assert.equal(figureDateLabel(value,'date'),'2026-03-01');
 assert.equal(figureDateLabel(value,'month'),'2026-03');
 assert.equal(figureDateLabel(value,'year'),'2026');
});

test('figures accept the new formats and render distinct sub-second ticks',()=>{
 for(const dateFormat of FIGURE_DATE_FORMATS)assert.ok(validFigureStyle({dateFormat}));
 assert.equal(validFigureStyle({dateFormat:'microseconds'}),false);
 const f=createFigure();f.title='Sampled voltage';f.x.kind='date';f.style={dateFormat:'milliseconds'};
 f.series[0].points=[0,10,20,30].map(offset=>({x:new Date(start+offset).toISOString(),y:offset/10,error:null}));
 const labels=coordinateLabels(renderFigure(f));
 assert.ok(labels.length>=2);assert.equal(new Set(labels).size,labels.length,labels.join());
 assert.ok(labels.every(label=>/^2026-03-01 12:00:00\.0\d\d UTC$/.test(label)),labels.join());
 const options=retainedFigureProperties('figure',f,f).find(p=>p.path==='style.dateFormat').options;
 assert.ok(options.includes('seconds')&&options.includes('milliseconds'));
});

test('retained figure drawings step through calendar units with distinct labels',async()=>{
 const {RetainedFigureDocuments}=await import('../src/retained-figure-document.js'),{retainedFigureSVG}=await import('../src/web/retained-figure-svg.js');
 const values=new Map(),documents=new RetainedFigureDocuments({readMetadata:async key=>values.get(key)??null,writeMetadata:async(key,value)=>{values.set(key,value);}});
 const f=createFigure();f.title='Logged current';f.x.kind='date';f.style={dateFormat:'seconds'};
 f.series[0].points=Array.from({length:30},(_,i)=>({x:new Date(start+i*500).toISOString(),y:i,error:null}));
 const reader=await documents.open(await documents.retain(f));let svg='';for await(const chunk of retainedFigureSVG(reader))svg+=chunk;
 const labels=[...svg.matchAll(/2026-03-01 12:00:\d\d UTC/g)].map(m=>m[0]);
 assert.ok(labels.length>=2,svg.slice(0,400));assert.ok(new Set(labels).size>=2);
});
