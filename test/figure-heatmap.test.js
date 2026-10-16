import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFigure,createSeries,figureIssues,figureCSV} from '../src/web/figure-model.js';
import {defaultHeatmap,heatmapBand} from '../src/web/figure-heatmap.js';
import {renderFigure,figureTable} from '../src/web/figure-renderer.js';
import {createFigureMapper} from '../src/web/figure-import-model.js';
import {createComposition} from '../src/web/figure-composition.js';
import {sameFigureCalculation} from '../src/web/figure-result-links.js';
import {readDelimitedTable} from '../src/web/tabular-data.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateDetachedRecords} from '../src/model.js';
import {buildPublication} from '../src/publication.js';
const matrix=()=>({...createFigure(),kind:'heatmap',heatmap:{...defaultHeatmap(),valueLabel:'Reference gap (µs)',thresholds:[{max:0,color:'#123456',label:'Negative or zero'},{max:12,color:'#abcdef',label:'Accepted'},{max:null,color:'#ee7722',label:'Outside band'}]},x:{kind:'category',label:'Trial',scale:'linear',min:null,max:null},y:{label:'Reference',scale:'linear',min:null,max:null},series:Array.from({length:6},(_,r)=>({...createSeries('Reference '+(r+1)),points:Array.from({length:5},(_,c)=>({x:'Trial '+(c+1),y:r*5+c,error:null}))}))});
test('6 by 5 numerical heatmaps retain cell values and inclusive declared thresholds in SVG and downloadable data',()=>{
 const f=matrix();assert.deepEqual(figureIssues(f),[]);const svg=renderFigure(f,{width:1000});assert.equal((svg.match(/class="figure-heatmap-cell"/g)??[]).length,30);assert.match(svg,/data-value="12"[^]*?<rect[^>]*fill="#abcdef"/);assert.match(svg,/data-value="13"[^]*?<rect[^>]*fill="#ee7722"/);assert.match(svg,/Reference gap \(µs\)/);assert.match(svg,/≤ 12/);assert.equal(heatmapBand(0,f.heatmap).color,'#123456');
 const rows=readDelimitedTable(figureCSV(f)).rows;assert.equal(rows.filter(r=>r.cells[1]==='measurement').length,30);assert.equal(rows.filter(r=>r.cells[1]==='threshold').length,3);assert.match(figureTable(f),/#abcdef/);
 const changed=structuredClone(f);changed.heatmap.thresholds[1].max=11;assert.equal(sameFigureCalculation(f,changed),false);
});
test('matrix gaps remain visible and ambiguous cells, unsupported coordinates and inconsistent thresholds fail validation',()=>{
 const f=matrix();f.series[0].points[0].y=null;f.series[1].points.splice(2,1);const svg=renderFigure(f);assert.equal((svg.match(/class="figure-heatmap-cell"/g)??[]).length,30);assert.equal((svg.match(/data-value=""/g)??[]).length,2);
 for(const mutate of [f=>f.series[0].points.push(f.series[0].points[0]),f=>f.heatmap.thresholds[1].max=-1,f=>f.heatmap.thresholds.at(-1).max=30,f=>f.x.kind='number',f=>f.series[0].points[0].error=1]){const invalid=matrix();mutate(invalid);assert.ok(figureIssues(invalid).length);}
 const panels=createComposition([matrix(),matrix()]);assert.deepEqual(figureIssues(panels),[]);assert.equal((renderFigure(panels).match(/figure-heatmap-cell/g)??[]).length,60);panels.layout.linkY=true;assert.ok(figureIssues(panels).length);
});
test('retained-style long data maps to matrix rows and columns without aggregating repeated cells',()=>{
 const mapping={x:0,xKind:'category',group:1,values:[{column:2,error:null}],operation:'raw',kind:'heatmap',mode:'replace',decimal:'.'},base=createFigure(),table={columns:['Trial','Reference','Gap'].map((label,index)=>({label,index}))},mapper=createFigureMapper(table,mapping,base);
 for(let r=0;r<6;r++)for(let c=0;c<5;c++)mapper.add({line:r*5+c+1,cells:['Trial '+c,'Reference '+r,String(r*5+c)]});const result=mapper.finish();assert.deepEqual(result.issues,[]);assert.equal(result.figure.series.length,6);assert.equal(result.figure.heatmap.valueLabel,'Gap');assert.equal(result.figure.y.label,'Reference');
 const duplicate=createFigureMapper(table,mapping,base);duplicate.add({line:1,cells:['A','B','1']});duplicate.add({line:2,cells:['A','B','2']});assert.ok(duplicate.finish().issues.length);
});
test('static publication uses the saved matrix and excludes unselected heatmaps',()=>{
 const book=upgradeNotebook(sampleNotebook()),publicRecord=book.entries[0];publicRecord.figures=[matrix()];publicRecord.share=true;book.projects.forEach(p=>p.share=true);book.entries[1].figures=[matrix()];book.entries[1].figures[0].title='PRIVATE_HEATMAP';book.entries[1].share=false;validateDetachedRecords([publicRecord,book.entries[1]]);
 const files=[...buildPublication(book).files.values()].map(String).join('\n');assert.match(files,/figure-heatmap-cell/);assert.match(files,/Negative or zero/);assert.match(files,/≤ 12/);assert.ok(!files.includes('PRIVATE_HEATMAP'));
});
