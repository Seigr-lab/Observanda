import {test} from 'node:test';import assert from 'node:assert/strict';
import {createFigure,figureIssues,figureCSV} from '../src/web/figure-model.js';
import {renderFigure,plotDomains,figureTable} from '../src/web/figure-renderer.js';
import {mapFigureTable} from '../src/web/figure-import-model.js';
import {createComposition,linkedPanelPlots} from '../src/web/figure-composition.js';
import {readDelimitedTable} from '../src/web/tabular-data.js';
const plot=()=>{const f=createFigure();f.kind='scatter';f.series[0].points=[{x:10,y:20,error:null,xLower:7,xUpper:14,yLower:18,yUpper:25}];return f;};
test('both asymmetric intervals affect auto and shared ranges and survive all figure outputs',()=>{
 const f=plot();assert.deepEqual(figureIssues(f),[]);const d=plotDomains(f);assert.ok(d.x.min<=7&&d.x.max>=14&&d.y.min<=18&&d.y.max>=25);const svg=renderFigure(f);assert.match(svg,/figure-interval-x/);assert.match(svg,/figure-interval-y/);assert.match(svg,/Coordinate lower bound: 7/);assert.match(figureTable(f),/<td>25<\/td>/);
 const rows=readDelimitedTable(figureCSV(f));assert.equal(rows.rows[0].cells.length,8);assert.equal(rows.rows[0].cells.at(-1),'25');
 const panels=createComposition([f,plot()]);panels.layout.linkX=true;panels.layout.linkY=true;const plots=linkedPanelPlots(panels,plotDomains);assert.ok(plots.every(p=>p.x.min<=7&&p.x.max>=14));assert.equal(readDelimitedTable(figureCSV(panels)).rows.length,2);
 for(const kind of ['line','bar','bar-horizontal','area']){f.kind=kind;assert.deepEqual(figureIssues(f),[]);assert.match(renderFigure(f),/figure-interval-x/);}
});
test('intervals validate endpoints, absence, conflicts, calendar and logarithmic meaning',()=>{
 for(const mutate of [p=>p.xLower=11,p=>p.yUpper=19,p=>p.xUpper=null,p=>p.error=1,p=>p.y=null,p=>p.xLower=Infinity]){const f=plot();mutate(f.series[0].points[0]);assert.ok(figureIssues(f).length);}
 const f=plot();f.x.scale='log';f.series[0].points[0].xLower=0;assert.ok(figureIssues(f).length);f.x.scale='linear';f.x.kind='date';Object.assign(f.series[0].points[0],{x:'2026-10-08',xLower:'2026-10-07',xUpper:'2026-10-09'});assert.deepEqual(figureIssues(f),[]);assert.match(renderFigure(f),/figure-interval-x/);
});
test('mapped bounds remain row-specific and cannot become silently aggregated uncertainty',()=>{
 const table={columns:['x','y','xl','xu','yl','yu'].map((label,index)=>({label,index})),rows:[{line:2,cells:['10','20','7','14','18','25']}]},mapping={x:0,xKind:'number',values:[{column:1,error:null,xLower:2,xUpper:3,yLower:4,yUpper:5}],group:null,operation:'raw',kind:'scatter',mode:'replace',decimal:'.'};
 const result=mapFigureTable(table,mapping,createFigure());assert.deepEqual(result.issues,[]);assert.deepEqual(result.figure.series[0].points[0],plot().series[0].points[0]);assert.ok(mapFigureTable(table,{...mapping,operation:'mean'},createFigure()).issues.length);
});
