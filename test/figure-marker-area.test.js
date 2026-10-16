import {test} from 'node:test';import assert from 'node:assert/strict';import {createFigure,figureIssues,figureCSV} from '../src/web/figure-model.js';import {renderFigure,figureTable} from '../src/web/figure-renderer.js';import {defaultMarkerArea,areaMarker} from '../src/web/figure-marker-area.js';import {mapFigureTable} from '../src/web/figure-import-model.js';import {readDelimitedTable} from '../src/web/tabular-data.js';
const plot=()=>{const f=createFigure();f.kind='scatter';f.markerArea={...defaultMarkerArea(),unitArea:10};f.series[0].points=[0,1,4,9].map((count,i)=>({x:i,y:i+1,error:null,count}));return f;};
test('marker area encodes counts linearly for every shape and declares the same scale in exports',()=>{
 const f=plot();assert.deepEqual(figureIssues(f),[]);const svg=renderFigure(f);assert.equal((svg.match(/class="figure-count-marker"/g)??[]).length,3);const radii=[...svg.matchAll(/class="figure-count-marker"[^>]*r="([\d.]+)"/g)].map(m=>Number(m[1]));assert.ok(Math.abs(radii[1]**2/radii[0]**2-4)<1e-10);assert.match(svg,/Area = count × 10/);assert.match(svg,/Count 0: no marker/);assert.match(figureTable(f),/Observation count/);
 const rows=readDelimitedTable(figureCSV(f)).rows;assert.equal(rows[2].cells[4],'4');assert.equal(rows[2].cells[5],'10');
 const options={area:100,x:10,y:10,esc:v=>v};assert.match(areaMarker({...options,shape:'square'}),/width="10" height="10"/);const diamond=areaMarker({...options,shape:'diamond'});assert.match(diamond,/7.0710678118654755/);
});
test('negative, missing, fractional and unsafe counts fail; excessive area requires a smaller declared scale',()=>{
 for(const value of [-1,1.1,Number.MAX_SAFE_INTEGER+1,null]){const f=plot();f.series[0].points[0].count=value;assert.ok(figureIssues(f).length);}const f=plot();f.markerArea.unitArea=10000;assert.ok(figureIssues(f).length);f.markerArea.unitArea=10;f.kind='bar';assert.ok(figureIssues(f).length);
});
test('count columns are retained without aggregation or radius-based distortion',()=>{
 const table={columns:['x','y','n'].map((label,index)=>({label,index})),rows:[{line:2,cells:['1','20','4']}]},mapping={x:0,xKind:'number',values:[{column:1,error:null,count:2}],group:null,operation:'raw',kind:'scatter',mode:'replace',decimal:'.'},r=mapFigureTable(table,mapping,createFigure());assert.deepEqual(r.issues,[]);assert.equal(r.figure.series[0].points[0].count,4);assert.equal(r.figure.markerArea.unitArea,24);assert.ok(mapFigureTable(table,{...mapping,operation:'mean'},createFigure()).issues.length);
});
