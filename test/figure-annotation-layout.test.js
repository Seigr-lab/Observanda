import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFigure,figureIssues,figureCSV} from '../src/web/figure-model.js';
import {createAnnotation} from '../src/web/figure-annotations.js';
import {createComposition} from '../src/web/figure-composition.js';
import {renderFigure,plotDomains,figureTable} from '../src/web/figure-renderer.js';
import {wrapAnnotationText} from '../src/web/figure-annotation-layout.js';

function plot(count=12){
 const f=createFigure();f.title='Acquisition phases';f.x.label='Time (s)';f.y.label='Signal (V)';
 f.series[0].points=[{x:0,y:1,error:.1},{x:1,y:2,error:.2}];
 f.annotations=Array.from({length:count},(_,i)=>({...createAnnotation(i%2?'interval':'boundary'),start:.2+i*.001,end:i%2?.2+i*.001+.0001:null,label:'Acquisition phase '+(i+1)+' with its complete explanation'}));return f;
}

test('dense annotations use a full key without changing geometry, measurements or export coordinates',()=>{
 const f=plot(),before=structuredClone(f),domain=plotDomains(f);
 assert.deepEqual(figureIssues(f),[]);
 for(const width of [320,960]){
  const svg=renderFigure(f,{width});assert.equal((svg.match(/class="figure-annotation-key-item"/g)??[]).length,12);
  assert.equal((svg.match(/class="figure-annotation"/g)??[]).length,12);
  assert.doesNotMatch(svg,/class="figure-annotation-label"|…|NaN|Infinity/);
  for(const annotation of f.annotations){assert.ok(svg.includes(annotation.id));assert.ok(svg.includes(String(annotation.start)));}
 }
 assert.deepEqual(f,before);assert.deepEqual(plotDomains(f),domain);assert.match(figureCSV(f),/Acquisition phase 12 with its complete explanation/);
 assert.match(figureTable(f),/Acquisition phase 12 with its complete explanation/);
});

test('sparse, forced-key, hidden and off-range annotations retain their independent presentation',()=>{
 const f=plot(1);f.annotations[0].label='Acquisition';const original=structuredClone(f.series);
 assert.match(renderFigure(f),/class="figure-annotation-label"/);assert.doesNotMatch(renderFigure(f),/class="figure-annotation-key"/);
 f.style={annotationLabels:'key'};assert.deepEqual(figureIssues(f),[]);assert.match(renderFigure(f),/class="figure-annotation-key"/);
 f.style.annotationLabels='hidden';const svg=renderFigure(f);assert.match(svg,/class="figure-annotation"/);assert.doesNotMatch(svg,/class="figure-annotation-label"|class="figure-annotation-key"/);assert.match(figureTable(f),/Acquisition/);
 f.style.annotationLabels='key';f.annotations[0].start=5;assert.doesNotMatch(renderFigure(f),/class="figure-annotation-key"|class="figure-annotation"/);assert.match(figureCSV(f),/"5"/);
 f.style.annotationLabels='unrecognized';assert.ok(figureIssues(f).length);assert.deepEqual(f.series,original);
});

test('the full 64-annotation limit and eight linked panels remain complete without clipping their keys',()=>{
 const f=plot(64);f.annotations[0].label='δ'.repeat(300);assert.deepEqual(figureIssues(f),[]);
 const svg=renderFigure(f,{width:320});assert.equal((svg.match(/class="figure-annotation-key-item"/g)??[]).length,64);
 const figure=createComposition(Array.from({length:8},()=>plot(12)));figure.layout.columns=3;figure.layout.linkX=true;figure.layout.linkY=true;
 const before=structuredClone(figure);assert.deepEqual(figureIssues(figure),[]);
 for(const width of [320,1200]){
  const result=renderFigure(figure,{width});assert.equal((result.match(/class="figure-panel"/g)??[]).length,8);
  assert.equal((result.match(/class="figure-annotation-key-item"/g)??[]).length,96);assert.doesNotMatch(result,/NaN|Infinity/);
 }
 assert.deepEqual(figure,before);
 const text='🧪'.repeat(80);assert.equal(wrapAnnotationText(text,180,12).join(''),text);
});
