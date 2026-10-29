import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createFigure} from '../src/web/figure-model.js';
import {defaultHeatmap} from '../src/web/figure-heatmap.js';
import {renderFigure,renderFigureView,figureTable,figureSummary} from '../src/web/figure-renderer.js';
import {renderFigure as displayFigure,figureTable as displayTable,figureSummary as displaySummary} from '../src/web/figure-presentation.js';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const load=locale=>prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});
const baseline=[
  "0fda02a5b2ba687748a9b5afc094a40f5d73f14399eee41e2dc377aa3c3bcbbe",
  "0d83caad02b323ccfe9077bc52ccd54f45c9be5076a5e533423c7d367f12e0d8",
  "ddcd233a38531fd8324956161973fd6c5995fe9c3a5cd0b01b84a8a80fcd090a",
  "7beafd6c404d6f80548b4398e9111ebcd3b7517416dab9c4765ebb44a0b8f56b",
  "cdfb874c825637a1aa246171d5717c039456b292cabfe615e9a3031d82f38704"
];
const hash=figure=>createHash('sha256').update(JSON.stringify([renderFigure(figure),figureTable(figure),figureSummary(figure),renderFigureView(figure)])).digest('hex');
function fixtures(){
 const simple=createFigure();simple.id='00000000-0000-4000-8000-000000000001';simple.title='User <figure>';simple.series[0].id='00000000-0000-4000-8000-000000000002';simple.series[0].name='User & series';simple.series[0].points=[{x:1,y:2,error:null},{x:2,y:null,error:null},{x:3,y:5,error:.5}];
 const decorated=structuredClone(simple);decorated.id='00000000-0000-4000-8000-000000000003';decorated.kind='scatter';decorated.summary={operation:'mean',category:'User <category>',group:'User group',rows:8,missing:2};decorated.style={numberFormat:'radix',radix:6,annotationLabels:'key'};
 decorated.x.ticks=[{value:1,label:'Authored tick'}];decorated.y.reversed=true;decorated.series[0].points=[{x:1,y:2,error:null,xLower:.5,xUpper:1.5,yLower:1,yUpper:3,count:4},{x:2,y:4,error:null,count:0}];decorated.markerArea={unitArea:10,label:'Authored count'};decorated.computation={version:1,kind:'approximate-inputs'};
 const q=spelling=>({spelling,representation:'decimal',radix:10});decorated.projection={version:1,x:{origin:q('100'),scale:q('0.001')},y:{origin:q('0'),scale:q('1')}};
 decorated.annotations=[{id:'00000000-0000-4000-8000-000000000004',kind:'boundary',axis:'x',start:1,end:null,label:'User boundary',color:'#92549f',opacity:.15},{id:'00000000-0000-4000-8000-000000000005',kind:'callout',label:'User callout',seriesId:decorated.series[0].id,pointIndex:0,dx:24,dy:-36,color:'#92549f',opacity:.15}];
 const heatmap=structuredClone(simple);heatmap.id='00000000-0000-4000-8000-000000000006';heatmap.kind='heatmap';heatmap.x.kind='category';heatmap.heatmap={...defaultHeatmap(),thresholds:[{max:null,color:'#92549f',label:'User band'}]};heatmap.series[0].points=[{x:'A',y:2,error:null},{x:'B',y:null,error:null}];
 const count=structuredClone(simple);count.id='00000000-0000-4000-8000-000000000007';count.summary={operation:'count',category:'User category',group:null,rows:4,missing:0};
 const panels={id:'00000000-0000-4000-8000-000000000008',title:'User panels',kind:'panels',layout:{columns:2,linkX:false,linkY:false},panels:[{id:'00000000-0000-4000-8000-000000000009',label:'User A',figure:decorated},{id:'00000000-0000-4000-8000-000000000010',label:'User B',figure:heatmap}]};
 return [simple,decorated,heatmap,count,panels];
}

test('default figure exports remain byte-identical while browser renderers translate all five languages',async()=>{
 const figures=fixtures(),original=JSON.stringify(figures);
 try{for(const locale of ['en','ca','es','nb','nn']){
  await load(locale);activateLanguage(locale);
  // These hashes were measured before adding translation options, covering
  // summaries, SVGs, HTML tables and panel views for five representative plots.
  assert.deepEqual(figures.map(hash),baseline);
  const [simple,decorated,heatmap,count,panels]=figures;
  const table=displayTable(simple),detail=displayTable(decorated),svg=displayFigure(decorated);
  assert.ok(table.includes('<th>'+esc(t('figureDisplay','series'))+'</th>'));
  assert.ok(table.includes('<td>'+esc(t('figureDisplay','gap'))+'</td>'));
  assert.ok(table.includes(esc(t('figureDisplay','uncertainty'))));
  assert.ok(table.includes('User &amp; series'));assert.ok(!table.includes('User <figure>'));
  assert.ok(detail.includes(esc(t('figureIntervals','xLower'))));
  assert.ok(detail.includes(esc(t('figureComposition','annotations'))));
  assert.ok(detail.includes(esc(t('figureAxes','reversed'))));
  assert.ok(detail.includes(esc(t('measurements','computationApproximateInputs'))));
  assert.ok(detail.includes(esc(t('figureDisplay','numeralHelp',{radix:6}))));
  assert.ok(svg.includes(esc(t('figureIntervals','description'))));
  assert.ok(svg.includes('User &lt;figure&gt;'));assert.ok(!svg.includes('User <figure>'));
  assert.ok(detail.includes('Authored tick'));assert.ok(detail.includes('Authored count'));
  assert.ok(displayFigure(heatmap).includes(esc(t('figureHeatmap','missing'))));
  assert.ok(displayTable(heatmap).includes(esc(t('figureHeatmap','allValues'))));
  assert.ok(displaySummary(count).includes('User category'));
  assert.ok(displaySummary(decorated).includes('User <category>'));
  const panelTable=displayTable(panels);assert.ok(panelTable.includes(esc(t('figureDisplay','series'))));
  assert.equal(JSON.stringify(figures),original);
  assert.deepEqual(figures.map(hash),baseline);
 }}finally{activateLanguage('en');}
});

test('translation callbacks are explicit and remain independent across interleaved renders',()=>{
 const [simple]=fixtures();
 const translated=(namespace,key,parameters)=>namespace==='figureDisplay'&&key==='series'?'Series <safe>':namespace==='figureDisplay'&&key==='value'?'Custom value':t(namespace,key,parameters);
 const table=figureTable(simple,{translate:translated});
 assert.ok(table.includes('Series &lt;safe&gt;'));assert.ok(table.includes('Custom value'));
 assert.ok(!table.includes('Series <safe>'));assert.equal(hash(simple),baseline[0]);
});
