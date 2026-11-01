import test from 'node:test';
import assert from 'node:assert/strict';
import {createFigure,createSeries} from '../src/web/figure-model.js';
import {createComposition,linkedPanelPlots} from '../src/web/figure-composition.js';
import {plotDomains} from '../src/web/figure-renderer.js';
import {figurePreviewWindow,figurePreviewPointLimit} from '../src/web/figure-preview-window.js';
const fixture=count=>{const figure=createFigure();figure.kind='scatter';figure.series[0].points=Array.from({length:count},(_,index)=>({x:index,y:index%23,error:null}));return figure;};
test('preview windows retain every authored point and the complete Cartesian range',()=>{
 const figure=fixture(100000),before=JSON.stringify(figure),window=figurePreviewWindow(figure),page=window.view(1440),domains=plotDomains(figure);assert.equal(page.paged,true);assert.equal(page.total,100000);assert.equal(page.figure.series[0].points.length,120);assert.equal(page.figure.x.min,domains.x.min);assert.equal(page.figure.y.max,domains.y.max);assert.equal(page.figure.series[0].points[0],figure.series[0].points[0]);
 assert.equal(window.select('observations',99999,1440),true);assert.deepEqual(window.view(390).figure.series[0].points,[figure.series[0].points[99999]]);assert.equal(window.view(390).limit,32);assert.equal(JSON.stringify(figure),before);
});
test('small figures keep their combined presentation and viewport sizing never sets a data ceiling',()=>{
 const figure=fixture(8);figure.series.push({...createSeries(),points:figure.series[0].points});const window=figurePreviewWindow(figure);assert.equal(window.view(390).figure,figure);assert.equal(window.view(390).paged,false);assert.equal(figurePreviewPointLimit(100000),128);assert.equal(figurePreviewPointLimit(1),32);
});
test('series navigation preserves full-axis intervals and original observation metadata',()=>{
 const figure=fixture(1000);figure.series.push({...createSeries('Intervals'),points:[{x:1000,y:100,error:null,yLower:90,yUpper:900}]});const window=figurePreviewWindow(figure),first=window.view(390);assert.equal(window.select('series',1,390),true);const second=window.view(390);assert.equal(second.offset,0);assert.equal(second.total,1);assert.equal(second.figure.y.max,first.figure.y.max);assert.equal(second.figure.series[0].points[0],figure.series[1].points[0]);assert.equal(window.select('observations',1,390),false);
});
test('panel windows preserve linked axes and do not retarget saved annotations',()=>{
 const a=fixture(1000),b=fixture(1000);b.series[0].points[0].x=100000;a.annotations=[];const figure=createComposition([a,b]);figure.layout.linkX=true;const before=JSON.stringify(figure),window=figurePreviewWindow(figure),expected=linkedPanelPlots(figure,plotDomains);assert.equal(window.view(390).figure.x.max,expected[0].x.max);assert.equal(window.select('panel',1,390),true);assert.equal(window.view(390).figure.x.max,expected[1].x.max);assert.deepEqual(window.view(390).figure.annotations,[]);assert.equal(JSON.stringify(figure),before);
});
test('heatmap windows preserve the final value for repeated categories across pages',()=>{
 const figure=fixture(1000);figure.kind='heatmap';figure.x.kind='category';figure.series[0].points=figure.series[0].points.map(point=>({...point,x:'Category '+point.x}));figure.series[0].points.push({x:'Category 3',y:9999,error:null});const before=JSON.stringify(figure),window=figurePreviewWindow(figure),page=window.view(390);assert.equal(page.total,1000);assert.equal(page.figure.series[0].points[3].y,9999);assert.equal(JSON.stringify(figure),before);
});
