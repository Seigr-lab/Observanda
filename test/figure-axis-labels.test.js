import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFigure} from '../src/web/figure-model.js';
import {renderFigure,plotDomains} from '../src/web/figure-renderer.js';
import {figureTickLabels} from '../src/web/figure-number-labels.js';
import {figureStyleDefaults} from '../src/web/figure-style.js';
import {createComposition} from '../src/web/figure-composition.js';
import {figureDomain,figureFraction,figureTicks} from '../src/web/figure-scales.js';

function figure(){
 const f=createFigure('line');f.title='Small timing differences';f.x.kind='number';
 f.x.min=1;f.x.max=1.000000004;f.y.min=1;f.y.max=1.000000004;
 f.series[0].points=[{x:1,y:1,error:null},{x:1.000000004,y:1.000000004,error:null}];return f;
}
const labels=(svg,axis)=>[...svg.matchAll(new RegExp('<text class="figure-'+axis+'-tick"[^>]*>([\\s\\S]*?)</text>','g'))].map(m=>[...m[1].matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(s=>s[1]).join(''));
for(const width of [320,840])for(const numberFormat of ['auto','decimal','scientific','percent'])test(`near-unity axes retain distinct complete labels in ${numberFormat} at ${width}px`,()=>{
 const f=figure();f.style={numberFormat};const before=structuredClone(f),svg=renderFigure(f,{width});
 for(const axis of ['value','coordinate']){
  const ticks=labels(svg,axis);assert.ok(ticks.length>=2);assert.equal(new Set(ticks).size,ticks.length,JSON.stringify(ticks));assert.ok(ticks.every(label=>!label.includes('…')),JSON.stringify(ticks));
 }
 assert.deepEqual(f,before);assert.ok(!svg.includes('NaN'));
});

test('small and large magnitudes use compact automatic labels without losing adjacent floating-point ticks',()=>{
 const style=figureStyleDefaults();
 for(const values of [[1e-100,2e-100,3e-100],[1e100,2e100,3e100],[1,1+Number.EPSILON,1+2*Number.EPSILON],[-1.000000003,-1.000000002,-1.000000001]]){
  const ticks=figureTickLabels(values,style);assert.equal(new Set(ticks).size,values.length);assert.ok(ticks.every(t=>t.length<=20));
 }
 assert.deepEqual(figureTickLabels([1.00001,1.00002],{...style,decimals:2}),['1.00','1.00']);
 assert.deepEqual(figureTickLabels([-0,0],style),['0','0']);
 assert.deepEqual(figureTickLabels([1e-100,2e-100,3e-100],{...style,numberFormat:'percent'}),['1e-98%','2e-98%','3e-98%']);
 assert.deepEqual(figureTickLabels([1e99,2e99,3e99],{...style,numberFormat:'percent'}),['1e+101%','2e+101%','3e+101%']);
});

test('narrow linked panels and horizontal charts retain complete numeric labels',()=>{
 const a=figure(),b=figure();a.y.scale='log';b.kind='bar-horizontal';b.x.kind='category';b.series[0].points=[{x:'First',y:1.000000001,error:null},{x:'Second',y:1.000000003,error:null}];b.x.min=null;b.x.max=null;
 for(const f of [a,b,createComposition([a,b])]){
  const svg=renderFigure(f,{width:320});assert.ok(!/NaN|Infinity/.test(svg));assert.ok(labels(svg,'value').every(label=>!label.includes('…')));
 }
});

test('singleton small measurements and one-sided ranges retain proportional visible domains',()=>{
 const f=figure();f.x.min=f.x.max=f.y.min=f.y.max=null;f.series[0].points=[{x:1e-12,y:2e-12,error:null}];
 const range=plotDomains(f);assert.ok(range.x.min>0&&range.x.max<2e-12);assert.ok(range.y.min>0&&range.y.max<4e-12);
 for(const axis of [{scale:'linear',min:4e-12,max:null},{scale:'linear',min:null,max:1e-12}]){
  const bounds=figureDomain([2e-12],axis);assert.ok(bounds.min>0&&bounds.max<5e-12);assert.ok(bounds.min<bounds.max);
 }
});

test('logarithmic scales preserve close point positions and remain finite across supported magnitudes',()=>{
 for(const scale of [1e-100,1e-12,1,1e20,1e99]){
  const min=scale,max=scale*(1+4*Number.EPSILON),mid=scale*(1+2*Number.EPSILON),d={min,max};
  assert.equal(figureFraction(min,d,true),0);assert.equal(figureFraction(max,d,true),1);
  assert.ok(figureFraction(mid,d,true)>0&&figureFraction(mid,d,true)<1);
  const f=figure();f.legend=false;f.x.scale=f.y.scale='log';f.x.min=f.y.min=min;f.x.max=f.y.max=max;
  f.series[0].points=[min,mid,max].map(value=>({x:value,y:value,error:null}));
  const points=[...renderFigure(f).matchAll(/<circle cx="([^"]+)" cy="([^"]+)"/g)].map(m=>[Number(m[1]),Number(m[2])]);
  assert.equal(points.length,3);assert.ok(points[0][0]<points[1][0]&&points[1][0]<points[2][0]);assert.ok(points[0][1]>points[1][1]&&points[1][1]>points[2][1]);
 }
 for(const scale of ['linear','log']){
  const d=figureDomain([Number.MIN_VALUE],{scale,min:null,max:null});assert.ok(d.min<d.max);if(scale==='log')assert.ok(d.min>0);
  const ticks=figureTicks(d,scale==='log');assert.ok(ticks.length>=2);assert.ok(ticks.every(v=>Number.isFinite(v)&&v>=d.min&&v<=d.max));
 }
 const broad={min:Number.MIN_VALUE,max:1e100};assert.equal(figureFraction(broad.min,broad,true),0);assert.equal(figureFraction(broad.max,broad,true),1);
 assert.ok(figureFraction(1,broad,true)>0&&figureFraction(1,broad,true)<1);
});
