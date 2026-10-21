import {test} from 'node:test';
import assert from 'node:assert/strict';
import {figureRadixLabel,figureRadixValue} from '../src/web/figure-radix-labels.js';
import {figureTickLabels} from '../src/web/figure-number-labels.js';
import {figureStyleDefaults,setFigureDesign} from '../src/web/figure-style.js';
import {createFigure,figureIssues,figureCSV} from '../src/web/figure-model.js';
import {renderFigure,figureTable} from '../src/web/figure-renderer.js';
import {defaultHeatmap} from '../src/web/figure-heatmap.js';
import {exactRational} from '../src/web/measurement-model.js';

function integer(text,base){let n=0n;for(const char of text)n=n*BigInt(base)+BigInt(parseInt(char,36));return n;}
function readValue(text,base){
 assert.ok(text.startsWith(base+'#'));text=text.slice(String(base).length+1);let sign=1n;if(text[0]==='-'){sign=-1n;text=text.slice(1);}
 if(text.startsWith('(')){const [n,d]=text.slice(1,-1).split('/');return {numerator:sign*integer(n,base),denominator:integer(d,base)};}
 const value=exactRational(text,'radix-fraction',base);return {...value,numerator:sign*value.numerator};
}
test('native-base value labels retain every plotted decimal value, including recurring fractions',()=>{
 for(let base=2;base<=36;base++)for(const value of [0,-0,1,-6,0.5,0.1,1/3,9007199254740991,1e100,1e-100,Number.MIN_VALUE,Number.MAX_VALUE]){
  const a=readValue(figureRadixValue(value,base),base),b=exactRational(String(value));assert.equal(a.numerator*b.denominator,b.numerator*a.denominator,base+': '+value);
 }
 assert.equal(figureRadixValue(10,6),'6#14');assert.equal(figureRadixValue(.5,6),'6#0.3');assert.equal(figureRadixValue(.1,6),'6#(1/14)');
 assert.equal(figureRadixValue(255,16),'16#ff');assert.equal(figureRadixValue(-0,6),'6#0');
});
test('rounded radix ticks are explicit and remain distinct across close and extreme coordinates',()=>{
 for(let radix=2;radix<=36;radix++)for(const values of [[1,1+Number.EPSILON,1+2*Number.EPSILON],[1e-100,2e-100,3e-100],[1e100,2e100,3e100],[Number.MIN_VALUE,2*Number.MIN_VALUE],[-1.000000001,-1.000000002]]){
  const labels=figureTickLabels(values,{...figureStyleDefaults(),numberFormat:'radix',radix,decimals:0});assert.equal(new Set(labels).size,values.length,radix+': '+labels);assert.ok(labels.every(label=>label.includes(radix+'#')&&label.length<120));
 }
 assert.equal(figureRadixLabel(10,6),'6#14');assert.match(figureRadixLabel(.1,6),/^\u2248 6#/);assert.equal(figureRadixLabel(36**8,6),'6#1 \u00d7 6^(6#24)');
 for(const base of [1,37,6.5])assert.throws(()=>figureRadixLabel(6,base));
});
test('figure axes, point hints and reading tables use the selected base without altering plotted data or CSV',()=>{
 const figure=createFigure();figure.kind='scatter';figure.x.kind='number';figure.title='Mixed fractions';figure.series[0].points=[{x:6,y:10,error:.5,xLower:5,xUpper:7},{x:12,y:.1,error:null}];const points=structuredClone(figure.series),csv=figureCSV(figure);
 setFigureDesign(figure,'style.numberFormat','radix');setFigureDesign(figure,'style.radix',6);assert.deepEqual(figureIssues(figure),[]);
 const svg=renderFigure(figure),table=figureTable(figure);assert.match(svg,/6#10 \u2192 6#14 \u00b1 6#0.3/);assert.match(svg,/6#\(1\/14\)/);assert.match(table,/<td>6#14<\/td>/);assert.match(table,/<td>6#\(1\/14\)<\/td>/);assert.match(table,/<td>6#11<\/td>/);assert.deepEqual(figure.series,points);assert.equal(figureCSV(figure),csv);
 const copied=structuredClone(figure);assert.equal(renderFigure(copied),svg);setFigureDesign(copied,'style.radix',1);assert.equal(copied.style.radix,6);
});
test('heatmap numerical labels, tooltips and threshold values share the selected numeral base',()=>{
 const figure=createFigure();figure.kind='heatmap';figure.x.kind='category';figure.heatmap=defaultHeatmap();figure.heatmap.thresholds[0].max=6;figure.heatmap.thresholds[1].max=12;figure.series[0].points=[{x:'Reading',y:10,error:null}];figure.style={numberFormat:'radix',radix:6};
 const svg=renderFigure(figure),table=figureTable(figure);assert.match(svg,/: 6#14/);assert.match(svg,/\u2264 6#10/);assert.match(svg,/\u2264 6#20/);assert.match(table,/<td>6#14<\/td>/);assert.match(table,/\u2264 6#20/);
});

test('custom ticks, annotation positions and count legends retain the chosen base while dates retain their identity',()=>{
 const figure=createFigure();figure.kind='scatter';figure.x.kind='number';figure.style={numberFormat:'radix',radix:6};figure.markerArea={label:'Observations',unitArea:6};figure.x.ticks=[{value:6,label:'Start'}];figure.series[0].points=[{x:6,y:10,error:null,count:6}];
 figure.annotations=[{id:crypto.randomUUID(),kind:'interval',axis:'x',start:6,end:12,label:'Window',color:'#123456',opacity:.2},{id:crypto.randomUUID(),kind:'region',xLower:6,xUpper:12,yLower:6,yUpper:12,label:'Region',color:'#123456',opacity:.2}];
 assert.deepEqual(figureIssues(figure),[]);const svg=renderFigure(figure),table=figureTable(figure);assert.match(svg,/6#10: Start/);assert.match(svg,/Window: 6#10 \u2013 6#20/);assert.match(svg,/X: 6#10 \u2013 6#20; Y: 6#10 \u2013 6#20/);assert.match(svg,/Observations: 6#10/);assert.match(table,/<td>6#10<\/td><td>Start/);
 const date=createFigure();date.x.kind='date';date.style={numberFormat:'radix',radix:6};date.series[0].points=[{x:'2026-01-01',y:6,error:null}];assert.match(figureTable(date),/<td>2026-01-01<\/td><td>6#10/);
});
