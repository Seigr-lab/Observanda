import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFigure,figureIssues,figureCSV} from '../src/web/figure-model.js';
import {createAnnotation} from '../src/web/figure-annotations.js';
import {createComposition,cloneFigure,linkedPanelPlots} from '../src/web/figure-composition.js';
import {renderFigure,figureTable,plotDomains} from '../src/web/figure-renderer.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateDetachedRecords} from '../src/model.js';
import {buildPublication} from '../src/publication.js';
import {copyFigureResults,figureHasResults,sameFigureCalculation} from '../src/web/figure-result-links.js';
import {validateResultSources} from '../src/result-statements.js';
import {figureResultView} from '../src/web/result-statements.js';

function plot(title='Measured response',values=[1,4,2]){
 const f=createFigure();f.title=title;f.x.label='Time (s)';f.y.label='Response (V)';f.series[0].points=values.map((y,x)=>({x,y,error:.25}));return f;
}
function annotated(){const f=plot();f.annotations=[{...createAnnotation('interval'),start:.5,end:1.5,label:'Acquisition window'},{...createAnnotation('boundary','y'),start:3,label:'Decision boundary'}];return f;}
test('annotations validate coordinates and preserve intervals, boundaries and uncertainty in exported data',()=>{
 const f=annotated();assert.deepEqual(figureIssues(f),[]);const svg=renderFigure(f),table=figureTable(f),csv=figureCSV(f);
 assert.match(svg,/class="figure-interval"/);assert.match(svg,/class="figure-annotation"/);assert.match(table,/Acquisition window/);assert.match(csv,/"Interval","Acquisition window"/);assert.match(csv,/"0.25"/);assert.doesNotMatch(svg,/NaN|Infinity/);
 for(const mutate of [f=>f.annotations[0].end=.1,f=>f.annotations[0].start=NaN,f=>f.annotations[0].opacity=2,f=>f.annotations[0].color='url(https://example.org)',f=>f.annotations.push({...f.annotations[0]}),f=>f.x.kind='category']){
  const copy=structuredClone(f);mutate(copy);assert.ok(figureIssues(copy).length);
 }
 f.annotations[0].label='<script>secret()</script>';assert.ok(!renderFigure(f).includes('<script>'));assert.match(figureTable(f),/&lt;script&gt;/);
 const date=plot();date.x.kind='date';date.series[0].points.forEach((p,i)=>p.x='2026-10-0'+(i+1));date.annotations=[{...createAnnotation('interval'),start:'2026-10-01T12:00:00Z',end:'2026-10-02T12:00:00Z',label:'UTC window'}];assert.deepEqual(figureIssues(date),[]);assert.match(renderFigure(date),/UTC window/);
 const log=plot();log.y.scale='log';log.annotations=[{...createAnnotation('boundary','y'),start:0,label:'Invalid zero'}];assert.ok(figureIssues(log).length);log.annotations[0].start=2;assert.deepEqual(figureIssues(log),[]);
 const horizontal=annotated();horizontal.kind='bar-horizontal';assert.doesNotMatch(renderFigure(horizontal),/NaN|Infinity/);
 f.annotations[0].start=100;f.annotations[0].end=101;assert.doesNotMatch(renderFigure(f),/class="figure-interval"/);assert.match(figureTable(f),/>101</);
});
test('shared panel ranges are derived from retained copies, include uncertainty and never mutate independent ranges',()=>{
 const a=annotated(),b=plot('Second acquisition',[10,20,30]),f=createComposition([a,b]);f.layout.linkX=true;f.layout.linkY=true;
 assert.deepEqual(figureIssues(f),[]);const saved=structuredClone(f),linked=linkedPanelPlots(f,plotDomains);
 assert.deepEqual(linked[0].y,linked[1].y);assert.ok(linked[0].y.max>30.25);assert.deepEqual(f,saved);
 a.series[0].points[0].y=999;assert.equal(f.panels[0].figure.series[0].points[0].y,1);
 const svg=renderFigure(f,{width:1000});assert.equal((svg.match(/class="figure-panel"/g)??[]).length,2);assert.match(svg,/Acquisition window/);assert.doesNotMatch(svg,/NaN|Infinity/);
 const narrow=renderFigure(f,{width:320}),positions=[...narrow.matchAll(/class="figure-panel"[^>]+translate\(([^)]+)\)/g)].map(m=>m[1]);assert.ok(positions.every(p=>p.startsWith('0 ')));assert.notEqual(positions[0],positions[1]);
 const copy=cloneFigure(f);assert.notEqual(copy.id,f.id);assert.notEqual(copy.panels[0].figure.id,f.panels[0].figure.id);assert.deepEqual(copy.panels[0].figure.series[0].points,f.panels[0].figure.series[0].points);
 for(const mutate of [f=>f.panels[1].figure.y.label='Different meaning',f=>f.panels[1].figure.y.scale='log',f=>f.panels[1].figure.kind='bar-horizontal',f=>f.panels[1].id=f.panels[0].id,f=>f.panels[1].figure=f,f=>f.layout.columns=0]){
  const copy=structuredClone(f);mutate(copy);assert.ok(figureIssues(copy).length);
 }
 assert.match(figureCSV(f),/"A","Measurement"/);assert.match(figureCSV(f),/"B","Measurement"/);assert.match(figureCSV(f),/"Second acquisition","Time \(s\)","Response \(V\)"/);assert.match(figureTable(f),/Second acquisition/);
});
test('compound figures remain in narrative position and public exports include only selected record figures',()=>{
 const book=upgradeNotebook(sampleNotebook()),r=book.entries[0],f=createComposition([annotated(),plot('Second panel')]);f.title='Compound acquisition';r.figures=[f];
 r.sections=[];r.body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Before the compound figure.'}]},{type:'book_figure',attrs:{version:1,id:randomUUID(),figureId:f.id,alternative:'Compare both acquisitions.'}},{type:'paragraph',content:[{type:'text',text:'After the compound figure.'}]}]};r.share=true;book.projects.forEach(p=>p.share=true);
 const privateFigure=createComposition([plot('PRIVATE FIGURE MARKER'),plot()]);book.entries[1].figures=[privateFigure];book.entries[1].share=false;
 validateDetachedRecords([r,book.entries[1]]);const publication=buildPublication(book),values=[...publication.files.values()].map(String).join('\n');
 assert.match(values,/Compound acquisition/);assert.match(values,/figure-panel/);assert.match(values,/Acquisition window/);assert.ok(!values.includes('PRIVATE FIGURE MARKER'));
 const page=[...publication.files].find(([name,body])=>name.endsWith('.html')&&String(body).includes('id="record-figure-'+f.id+'"'))?.[1];assert.ok(page);const html=String(page);assert.ok(html.indexOf('Before the compound figure.')<html.indexOf('id="record-figure-'+f.id+'"'));assert.ok(html.indexOf('id="record-figure-'+f.id+'"')<html.indexOf('After the compound figure.'));
});
test('panel snapshots copy supporting results and exact analysis references without changing the originals',async()=>{
 const original=annotated(),copy=cloneFigure(original),results={version:1,statements:[{id:randomUUID(),kind:'figure',figureId:original.id,title:'Returned capture comparison',text:'Result from the retained decoder.',limitations:'Only this apparatus state was tested.',basis:'retained',source:{kind:'analysis',id:randomUUID(),revision:'a'.repeat(64)}}]},before=structuredClone(results);
 const next=copyFigureResults(results,[[original,copy]]);assert.deepEqual(results,before);assert.equal(next.statements.length,2);assert.equal(next.statements[1].figureId,copy.id);assert.notEqual(next.statements[1].id,results.statements[0].id);assert.deepEqual(next.statements[1].source,results.statements[0].source);assert.equal(next.statements[1].limitations,results.statements[0].limitations);assert.equal(figureHasResults(copy,next),true);
 assert.equal(sameFigureCalculation(original,copy),true);copy.series[0].color='#000000';assert.equal(sameFigureCalculation(original,copy),true);copy.series[0].points[0].y=42;assert.equal(sameFigureCalculation(original,copy),false);
 const full={version:1,statements:Array.from({length:64},()=>({...results.statements[0],id:randomUUID()}))};assert.throws(()=>copyFigureResults(full,[[original,copy]]));assert.equal(full.statements.length,64);
 const compound=createComposition([original,copy]),record={figures:[compound],results:{version:1,statements:[{...next.statements[1],figureId:compound.panels[0].figure.id,basis:'authored',source:null}]}};await validateResultSources({},record);
 assert.match(figureResultView(compound,record.results,String),/No supporting result is declared for panel B/);
 assert.ok((renderFigure(plot('Short panel',[1,5]),{width:400}).match(/class="figure-value-tick"/g)??[]).length>=2);
});
