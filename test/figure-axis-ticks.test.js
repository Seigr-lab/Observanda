import {test} from 'node:test';
import assert from 'node:assert/strict';
import {figureTicks,figureDomain} from '../src/web/figure-scales.js';
import {createFigure} from '../src/web/figure-model.js';
import {renderFigure} from '../src/web/figure-renderer.js';

test('linear ticks are exact multiples of their step without binary noise',()=>{
 assert.deepEqual(figureTicks({min:3,max:4},false,5),[3,3.2,3.4,3.6,3.8,4]);
 assert.deepEqual(figureTicks({min:0,max:1},false,5),[0,0.2,0.4,0.6,0.8,1]);
 assert.deepEqual(figureTicks({min:1,max:1.000000004},false,5),[1,1.000000001,1.000000002,1.000000003,1.000000004]);
 // Steps near the limit of double precision keep every distinct tick.
 const tiny=figureTicks({min:1,max:1+8*Number.EPSILON},false,5);
 assert.ok(tiny.length>=3);assert.equal(new Set(tiny).size,tiny.length);assert.ok(tiny.every(v=>v>=1&&v<=1+8*Number.EPSILON));
});

test('logarithmic axes spanning a decade or less label 1-2-5 multiples or plain steps',()=>{
 assert.deepEqual(figureTicks({min:0.5,max:30},true,6),[0.5,1,2,5,10,20]);
 assert.deepEqual(figureTicks({min:1,max:100},true,5),[1,10,100]);
 const narrow=figureTicks({min:3,max:4},true,5);
 assert.ok(narrow.length>=3,narrow.join());assert.ok(narrow.every(v=>v>=3&&v<=4));assert.deepEqual(narrow,[3,3.2,3.4,3.6,3.8,4]);
 const wide=figureTicks({min:1e-9,max:1e9},true,5);assert.ok(wide.length>=3&&wide.length<=6);assert.ok(wide.every(v=>Number.isInteger(Math.log10(v))||Math.abs(Math.log10(v)-Math.round(Math.log10(v)))<1e-12));
 for(const scale of [1e-100,1e-12,1,1e99]){
  const d=figureDomain([scale,scale*3],{scale:'log',min:null,max:null}),values=figureTicks(d,true,5);
  assert.ok(values.length>=2);assert.ok(values.every(v=>v>0&&v>=d.min&&v<=d.max&&Number.isFinite(v)));
 }
});

test('a log figure within one decade draws more than its two bounds',()=>{
 const f=createFigure();f.title='Gain';f.x.kind='number';f.y.scale='log';
 f.series[0].points=[{x:1,y:2.1,error:null},{x:2,y:7.9,error:null}];
 const labels=[...renderFigure(f).matchAll(/<text class="figure-value-tick"[^>]*><title>([^<]*)<\/title>/g)].map(m=>m[1]);
 assert.ok(labels.length>=2,labels.join());assert.ok(labels.includes('5')||labels.includes('2'),labels.join());
});
