import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {createFigure,createSeries} from '../src/web/figure-model.js';
import {defaultHeatmap} from '../src/web/figure-heatmap.js';
import {retainedFigureSVG} from '../src/web/retained-figure-svg.js';
import {figureTextChunks,figureTextLines} from '../src/web/retained-figure-text.js';
const fixture=()=>{const files=new Map();return new RetainedFigureDocuments({readMetadata:async n=>files.get(n)??null,writeMetadata:async(n,t)=>files.set(n,t)});};
const output=async reader=>{let text='',maximum=0;for await(const chunk of retainedFigureSVG(reader)){maximum=Math.max(maximum,chunk.length);text+=chunk;}assert.ok(maximum<65536);assert.ok(!/NaN|Infinity|\[object Object\]|undefined/.test(text),'output has invalid scalar text');return text;};
async function retained(documents,f){const b=documents.builder(f);for(const panel of f.kind==='panels'?f.panels:[{id:f.id,label:f.title,figure:f}]){await b.addPlot(panel.figure,{id:panel.id,label:panel.label});for(const s of panel.figure.series){await b.addSeries(s);for(const p of s.points)await b.addPoint(p);}}return documents.open(await b.finish());}
test('retained text streams complete escaped Unicode through split metadata pages',async()=>{
 const value={format:'figure-text',version:1,preview:'wrong',characters:6},reader={async *textChunks(){yield 'A\ud83d';yield '\ude00<&B';}};
 const encoded=[];for await(const chunk of figureTextChunks(reader,value,{}))encoded.push(new TextEncoder().encode(chunk));const bytes=new Uint8Array(encoded.reduce((n,b)=>n+b.length,0));let offset=0;for(const b of encoded){bytes.set(b,offset);offset+=b.length;}assert.equal(new TextDecoder().decode(bytes),'A\ud83d\ude00<&B');
 let all='';for await(const line of figureTextLines(reader,value,{},30,12))all+=line;assert.equal(all,'A\ud83d\ude00<&B');
 await assert.rejects(async()=>{for await(const chunk of figureTextChunks(reader,{...value,characters:7},{}))void chunk;},/Incomplete/);
});
test('SVG streams dense line observations, discontinuities and intervals without a point ceiling',async()=>{
 const d=fixture(),f=createFigure();f.title='Dense retained trace';f.series[0].style={marker:'none'};f.series[0].points=Array.from({length:10003},(_,i)=>({x:i,y:i===5000?null:i%37,error:i===10002?2:null}));
 const reader=await retained(d,f),svg=await output(reader);assert.equal((svg.match(/class="figure-line" d="([^"]*)"/)[1].match(/ [LM][\d.-]+,[\d.-]+/g)??[]).length,10002);assert.match(svg,/figure-measurement-interval/);assert.match(svg,/Dense retained trace/);
 let windowSVG='';for await(const chunk of retainedFigureSVG(reader,{window:{plotId:f.id,seriesOffset:0,seriesLimit:1,pointOffset:9990,pointLimit:13}}))windowSVG+=chunk;
 assert.equal((windowSVG.match(/class="figure-observation"/g)??[]).length,13);assert.match(windowSVG,/data-point-id=/);assert.equal(/NaN|Infinity|undefined/.test(windowSVG),false);
 const aborted=new AbortController();aborted.abort();await assert.rejects(async()=>{for await(const text of retainedFigureSVG(reader,{signal:aborted.signal}))void text;},{name:'AbortError'});
});
test('SVG keeps complete heatmap cells, missing categories and hidden-series boundaries',async()=>{
 const d=fixture(),f=createFigure();f.kind='heatmap';f.x.kind='category';f.heatmap=defaultHeatmap();f.series=[{...createSeries('First'),points:[{x:'A',y:1,error:null},{x:'B',y:0,error:null}]},{...createSeries('Second'),points:[{x:'B',y:2,error:null}]},{...createSeries('Hidden'),style:{visible:false},points:[{x:'Hidden column',y:4,error:null}]}];
 const svg=await output(await retained(d,f));assert.equal((svg.match(/class="figure-heatmap-cell"/g)??[]).length,4);assert.equal((svg.match(/data-value=""/g)??[]).length,1);assert.match(svg,/data-value="2"/);assert.doesNotMatch(svg,/Hidden column/);
});
test('SVG retains every panel and long label with linked domains and source annotations',async()=>{
 const d=fixture(),panels=Array.from({length:9},(_,i)=>{const f=createFigure();f.title='Plot '+i;f.series[0].points=[{x:1,y:i+1,error:null}];f.annotations=[{id:randomUUID(),kind:'callout',label:'Source observation '+i,color:'#92549f',opacity:.15,seriesId:f.series[0].id,pointIndex:0,dx:24,dy:-36}];return {id:randomUUID(),label:'Panel '+i,figure:f};});
 const f={id:randomUUID(),title:'Complete composition',kind:'panels',layout:{columns:3,linkX:true,linkY:true},panels};f.panels[8].figure.series[0].name='Last '+('unicode \u03bb\ud83d\ude00 '.repeat(1000));
 const svg=await output(await retained(d,f));assert.equal((svg.match(/class="figure-panel" /g)??[]).length,9);assert.equal((svg.match(/class="figure-observation-anchor"/g)??[]).length,9);assert.match(svg,/Source observation 8/);assert.match(svg,/unicode \u03bb\ud83d\ude00/);assert.doesNotMatch(svg,/\ufffd/);
});

test('retained count markers keep visible extrema examples and the zero-count explanation',async()=>{
 const d=fixture(),f=createFigure();f.kind='scatter';f.markerArea={unitArea:24,label:'Observed counts'};f.series[0].points=[{x:1,y:3,error:null,count:0},{x:2,y:4,error:null,count:2},{x:3,y:5,error:null,count:7}];
 const svg=await output(await retained(d,f));assert.equal((svg.match(/class="figure-count-example"/g)??[]).length,2);assert.match(svg,/data-area="48"/);assert.match(svg,/data-area="168"/);assert.match(svg,/class="figure-zero-count"/);
});
