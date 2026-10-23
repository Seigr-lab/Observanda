import {test} from 'node:test';
import {defaultHeatmap} from '../src/web/figure-heatmap.js';
import assert from 'node:assert/strict';
import {createFigure,figureIssues,figureCSV} from '../src/web/figure-model.js';
import {renderFigure,figureTable} from '../src/web/figure-renderer.js';
import {createComposition} from '../src/web/figure-composition.js';
import {sameFigureCalculation} from '../src/web/figure-result-links.js';
import {readDelimitedTable} from '../src/web/tabular-data.js';
const q=(spelling,representation='decimal',radix=10)=>({spelling,representation,radix});
const projection=()=>({version:1,x:{origin:q('1000000000000000000000000000000'),scale:q('0.001')},y:{origin:q('10','radix',6),scale:q('0.1','radix-fraction',6)}});
function figure(){const f=createFigure();f.x.label='Acquisition (ticks)';f.y.label='Response (V)';f.series[0].points=[{x:1,y:6,error:1},{x:2,y:12,error:2}];f.projection=projection();return f;}
test('projected figures retain complete exact formulas in SVG, reader and standalone CSV without changing measurements',()=>{
 const f=figure(),before=structuredClone(f);
 for(const width of [320,1200]){const svg=renderFigure(f,{width});assert.match(svg,/class="figure-projection-description"/);assert.match(svg,/Projected Acquisition \(ticks\)/);assert.match(svg,/Projected Response \(V\)/);assert.match(svg,/6#\(10\)/);assert.match(svg,/6#\(0.1\)/);assert.doesNotMatch(svg,/NaN|Infinity/);const height=Number(svg.match(/viewBox="0 0 [^ ]+ ([^"]+)"/)[1]);for(const y of svg.matchAll(/<text x="20" y="([^"]+)"/g))assert.ok(Number(y[1])<height);}
 const table=figureTable(f);assert.match(table,/source value - 1000000000000000000000000000000/);assert.match(table,/exact measurements and projection errors/);
 const csv=readDelimitedTable(figureCSV(f)),settings=JSON.parse(csv.rows[0].cells.at(-1));assert.deepEqual(settings.projection,f.projection);assert.equal(csv.rows[1].cells[3],'1');assert.equal(csv.rows[1].cells[4],'6');assert.deepEqual(f,before);
});
test('projection validation refuses malformed semantics and calculation equality includes them',()=>{
 const f=figure();assert.deepEqual(figureIssues(f),[]);const copy=structuredClone(f);copy.title='Another title';assert.equal(sameFigureCalculation(f,copy),true);copy.projection.y.origin.spelling='11';assert.equal(sameFigureCalculation(f,copy),false);
 for(const change of [f=>f.projection.version=2,f=>f.projection.x.scale.spelling='0',f=>f.projection.x.origin.radix=6,f=>f.x.kind='category',f=>f.x.kind='date',f=>f.projection.extra='unexpected']){const c=structuredClone(f);change(c);assert.ok(figureIssues(c).length);}
});
test('linked panels require equivalent exact coordinate meanings, including implicit identity transforms',()=>{
 const a=figure(),b=figure(),f=createComposition([a,b]);f.layout.linkY=true;assert.deepEqual(figureIssues(f),[]);
 f.panels[1].figure.projection.y.origin=q('6');f.panels[1].figure.projection.y.scale=q('1/6','rational');assert.deepEqual(figureIssues(f),[]);
 f.panels[1].figure.projection.y.scale=q('2/6','rational');assert.ok(figureIssues(f).length);f.layout.linkY=false;assert.deepEqual(figureIssues(f),[]);
 f.layout.linkY=true;delete f.panels[0].figure.projection.y;f.panels[1].figure.projection.y={origin:q('0'),scale:q('1')};assert.deepEqual(figureIssues(f),[]);
});
test('projection captions escape labels and compound figures retain each independent transform',()=>{
 const a=figure(),b=figure();a.x.label='<script>alert(1)</script>';b.projection.x.origin=q('2');const f=createComposition([a,b]),svg=renderFigure(f,{width:320});assert.doesNotMatch(svg,/<script>/);assert.match(svg,/&lt;script&gt;/);assert.equal((svg.match(/class="figure-projection-description"/g)??[]).length,2);assert.match(figureTable(f),/source value - 2/);
});

test('heatmap projection describes cell values while preserving category axes',()=>{
 const f=figure();f.kind='heatmap';f.x.kind='category';f.x.label='Trial';f.y.label='Reference';f.heatmap={...defaultHeatmap(),valueLabel:'Gap (ticks)'};delete f.projection.x;
 f.series[0].points=[{x:'Trial A',y:6,error:null},{x:'Trial B',y:12,error:null}];assert.deepEqual(figureIssues(f),[]);
 const before=structuredClone(f),svg=renderFigure(f),table=figureTable(f);assert.match(svg,/Projected Gap \(ticks\)/);assert.doesNotMatch(svg,/Projected Reference/);assert.match(svg,/>Reference<\/title>/);assert.match(table,/<th>Projected Gap \(ticks\)<\/th>/);assert.deepEqual(f,before);
});
