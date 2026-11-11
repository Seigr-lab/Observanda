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

test('axes draw a mark at every labelled tick and unlabelled 2-9 marks between log decades',async()=>{
 const {figureMinorTicks}=await import('../src/web/figure-scales.js');
 assert.deepEqual(figureMinorTicks({min:1,max:100},true,[1,10,100]),[2,3,4,5,6,7,8,9,20,30,40,50,60,70,80,90]);
 assert.deepEqual(figureMinorTicks({min:0,max:1},false,[0,1]),[]);
 assert.deepEqual(figureMinorTicks({min:1e-100,max:1e100},true,[]),[],'Very wide axes keep only labelled decades');
 const f=createFigure();f.title='Gain';f.x.kind='number';f.y.scale='log';f.y.min=1;f.y.max=1000;
 f.series[0].points=[{x:1,y:3,error:null},{x:2,y:300,error:null}];
 const svg=renderFigure(f),labels=[...svg.matchAll(/class="figure-value-tick"/g)].length+[...svg.matchAll(/class="figure-coordinate-tick"/g)].length;
 assert.equal((svg.match(/class="figure-tick-mark"/g)??[]).length,labels);
 assert.ok((svg.match(/class="figure-minor-tick"/g)??[]).length>=16);
});

test('a log-axis uncertainty reaching zero or below is drawn clipped at the axis and kept exact',async()=>{
 const {figureIssues}=await import('../src/web/figure-model.js'),{RetainedFigureDocuments}=await import('../src/retained-figure-document.js'),{retainedFigureSVG}=await import('../src/web/retained-figure-svg.js');
 const f=createFigure();f.title='Low signal';f.kind='scatter';f.x.kind='number';f.y.scale='log';
 f.series[0].points=[{x:1,y:0.001,error:0.002},{x:2,y:0.5,error:0.1},{x:3,y:2,error:null,yLower:-1,yUpper:3}];
 assert.deepEqual(figureIssues(f),[]);const before=structuredClone(f),svg=renderFigure(f);
 assert.equal((svg.match(/figure-interval-clipped/g)??[]).length,2);assert.equal((svg.match(/<circle cx=/g)??[]).length-1,3,'Every point is drawn (one legend circle)');
 assert.ok(!/NaN|Infinity/.test(svg));assert.deepEqual(f,before);
 f.series[0].points[0].y=0;assert.ok(figureIssues(f).length);f.series[0].points[0].y=0.001;
 const values=new Map(),documents=new RetainedFigureDocuments({readMetadata:async key=>values.get(key)??null,writeMetadata:async(key,value)=>{values.set(key,value);}});
 let retained='';for await(const chunk of retainedFigureSVG(await documents.open(await documents.retain(f))))retained+=chunk;
 assert.equal((retained.match(/figure-interval-clipped/g)??[]).length,2);assert.ok(!/NaN|Infinity/.test(retained));
});
