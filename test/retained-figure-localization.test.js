import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {retainedFigureSVG} from '../src/web/retained-figure-svg.js';
import {retainedFigureTable,retainedFigureCSV} from '../src/web/retained-figure-data.js';
import {retainedFigureTranslator} from '../src/retained-figure-localization.js';
import {dispatchRetainedFigure,retainedFigureRequest} from '../src/retained-figures.js';
import {RecordFigureDrafts} from '../src/record-figure-drafts.js';
import {liveFigure} from '../src/collaboration/live-figures.js';
import {sharedReviewFigure} from '../src/collaboration/review-figures.js';
import {Reviews} from '../src/reviews.js';
import {retainedFigureReader} from '../src/web/retained-figure-reader.js';
import {prepareLanguage,activateLanguage} from '../src/web/i18n/index.js';
const locales=['en','ca','es','nb','nn'];
const revision='a'.repeat(64);
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const prepare=locale=>prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});
const baseline=[
  "c06043387ab14168cfdacd323123abcdf2a3b62f6d2f3aacbc34dd2fb3856553",
  "7526ed0e4b72d75b476d24c2f2dbce3e3dae4d3095ae6d3eb1ae704938560ab0",
  "5f59d9a900db87d826dbd9b5b35dd81d475c44e2f845a44b121ee9b900f4d294"
];
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {createFigure} from '../src/web/figure-model.js';
import {defaultHeatmap} from '../src/web/figure-heatmap.js';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function fixtures(){
 const plot=createFigure();plot.id=id(1);plot.title='Authored <title>';plot.kind='scatter';plot.x.label='Authored axis '+('long label '.repeat(120))+'END-AXIS';plot.series[0].id=id(2);plot.series[0].name='Authored & series '+('long name '.repeat(120))+'END-SERIES';plot.style={numberFormat:'radix',radix:6,annotationLabels:'key'};
 plot.series[0].points=[{x:1,y:2,error:null,xLower:.5,xUpper:1.5,yLower:1,yUpper:3,count:4},{x:2,y:4,error:null,count:0}];plot.markerArea={unitArea:10,label:'Authored count'};plot.computation={version:1,kind:'approximate-inputs'};
 const q=spelling=>({spelling,representation:'decimal',radix:10});plot.projection={version:1,x:{origin:q('100'),scale:q('0.001')}};
 plot.annotations=[{id:id(3),kind:'boundary',axis:'x',start:1,end:null,label:'Authored boundary',color:'#92549f',opacity:.15},{id:id(4),kind:'callout',label:'Authored callout',seriesId:id(2),pointIndex:0,dx:24,dy:-36,color:'#92549f',opacity:.15}];
 const heatmap=createFigure();heatmap.id=id(5);heatmap.kind='heatmap';heatmap.title='Authored heatmap';heatmap.x.kind='category';heatmap.heatmap={...defaultHeatmap(),thresholds:[{max:1,color:'#92549f',label:'Authored low'},{max:null,color:'#123456',label:'Authored high'}]};heatmap.series[0].id=id(6);heatmap.series[0].name='Authored heat series';heatmap.series[0].points=[{x:'Authored <category>',y:2,error:null},{x:'Missing category',y:null,error:null}];
 const panels={id:id(7),title:'Authored panels',kind:'panels',layout:{columns:2,linkX:false,linkY:false},panels:[{id:id(8),label:'Authored A',figure:plot},{id:id(9),label:'Authored B',figure:heatmap}]};
 return [plot,heatmap,panels];
}
async function open(figure){
 const values=new Map(),workspace={readMetadata:async key=>values.get(key)??null,writeMetadata:async(key,value)=>{values.set(key,value);}},documents=new RetainedFigureDocuments(workspace),builder=documents.builder(figure);let next=100;
 for(const panel of figure.kind==='panels'?figure.panels:[{id:figure.id,label:figure.title,figure}]){await builder.addPlot(panel.figure,{id:panel.id,label:panel.label});for(const series of panel.figure.series){await builder.addSeries(series);for(const point of series.points)await builder.addPoint(point,{id:id(next++)});}}
 return documents.open(await builder.finish());
}
async function collect(chunks){let text='',maximum=0;for await(const chunk of chunks){text+=chunk;maximum=Math.max(maximum,Buffer.byteLength(chunk));}return {text,maximum};}

test('retained translations preserve canonical exports and complete authenticated labels in every language',async()=>{
 const figures=fixtures(),readers=await Promise.all(figures.map(open)),canonical=[];
 for(const reader of readers){const output=[];for(const render of [retainedFigureSVG,retainedFigureTable,retainedFigureCSV])output.push((await collect(render(reader))).text);output.push((await collect(reader.json())).text);canonical.push(output);}
 // Captured before this extraction, with deterministic retained point IDs.
 assert.deepEqual(canonical.map(output=>createHash('sha256').update(JSON.stringify(output)).digest('hex')),baseline);
 try{for(const locale of locales){
  await prepare(locale);activateLanguage(locale);
  const translate=await retainedFigureTranslator(locale);assert.ok(Object.isFrozen(translate));
  assert.strictEqual(await retainedFigureTranslator(locale),translate);
  assert.throws(()=>translate('../../errors','invalid'),/Unsupported retained figure namespace/);
  const svg=await collect(retainedFigureSVG(readers[0],{translate})),html=await collect(retainedFigureTable(readers[0],{translate})),heat=await collect(retainedFigureSVG(readers[1],{translate})),panels=await collect(retainedFigureSVG(readers[2],{translate}));
  for(const result of [svg,html,panels]){
   assert.ok(result.text.includes(esc(figures[0].x.label)),'complete authenticated axis text');
   assert.ok(result.text.includes(esc(figures[0].series[0].name)),'complete authenticated series text');
   assert.ok(result.text.includes(esc(translate('measurements','computationApproximateInputs'))));
   assert.doesNotMatch(result.text,/\[object Object\]|undefined|NaN|Infinity|\uFFFD/u);assert.ok(result.maximum<=65536);
  }
  assert.ok(svg.text.includes(esc(translate('figureDisplay','numeralHelp',{radix:6}))));
  assert.ok(svg.text.includes(esc(translate('figureMarkerArea','zero'))));
  assert.ok(svg.text.includes(esc(translate('figureIntervals','xLower'))));
  assert.ok(html.text.includes(esc(translate('retainedFigureData','figureSettings'))));
  assert.ok(html.text.includes(esc(translate('figureComposition','boundary'))));
  assert.ok(html.text.includes(esc(translate('figureObservations','callout'))));
  assert.ok(heat.text.includes(esc(translate('figureHeatmap','help'))));
  assert.ok(heat.text.includes(esc(translate('figureHeatmap','missing'))));
  assert.ok(heat.text.includes('Authored &lt;category&gt;'));assert.doesNotMatch(svg.text,/<title>Authored <title>/);
  for(let i=0;i<readers.length;i++){
   const output=[];for(const render of [retainedFigureSVG,retainedFigureTable,retainedFigureCSV])output.push((await collect(render(readers[i]))).text);output.push((await collect(readers[i].json())).text);
   assert.deepEqual(output,canonical[i]);
   assert.equal((await collect(retainedFigureCSV(readers[i],{translate}))).text,canonical[i][2]);
  }
 }}finally{activateLanguage('en');}
 await assert.rejects(retainedFigureTranslator('../es'),/Unsupported retained figure language/);
});

test('bounded preview language is request-scoped while exports and default response shapes remain canonical',async()=>{
 const figure=fixtures()[0],reader=await open(figure),window={plotId:figure.id,seriesOffset:0,seriesLimit:1,pointOffset:0,pointLimit:1},command={operation:'svg',window,expectedRevision:revision},calls=[];
 const observed=Object.create(reader);observed.window=async selection=>{calls.push(selection);return reader.window(selection);};
 const before=JSON.stringify(reader.document),original=await dispatchRetainedFigure(observed,revision,command);
 assert.equal(Object.hasOwn(original,'language'),false);
 const outputs=await Promise.all(locales.map(language=>dispatchRetainedFigure(observed,revision,{...command,language})));
 for(let i=0;i<locales.length;i++){
  const result=outputs[i],translate=await retainedFigureTranslator(locales[i]);
  assert.equal(result.language,locales[i]);assert.equal(result.revision,revision);assert.deepEqual(result.window,window);assert.deepEqual(result.document,original.document);assert.deepEqual(result.counts,original.counts);
  assert.ok(result.svg.includes(esc(translate('figureDisplay','numeralHelp',{radix:6}))));
  assert.equal((result.svg.match(/class="figure-observation"/g)??[]).length,1);
 }
 assert.equal(JSON.stringify(reader.document),before);assert.deepEqual(await dispatchRetainedFigure(reader,revision,command),original);
 assert.ok(calls.filter(value=>value.collection==='points').every(value=>value.limit===1));
 for(const format of ['svg','csv','json']){
  const result=await dispatchRetainedFigure(reader,revision,{format},{exporting:true,download:async({chunks})=>(await collect(chunks)).text});
  const expected=(await collect(format==='svg'?retainedFigureSVG(reader):format==='csv'?retainedFigureCSV(reader):reader.json())).text;
  assert.equal(result,expected);
 }
 const unreadable=new Proxy({},{get(){throw Error('Must not read a rejected request');}});
 for(const language of [undefined,null,'','fr','es-ES','../es',{},['es']])await assert.rejects(dispatchRetainedFigure(unreadable,revision,{...command,language}),{code:'INVALID'});
 for(const operation of ['open','header','window','cells','item','text','source'])await assert.rejects(dispatchRetainedFigure(unreadable,revision,{operation,language:'ca'}),{code:'INVALID'});
 await assert.rejects(dispatchRetainedFigure(unreadable,revision,{format:'svg',language:'ca'},{exporting:true}),{code:'INVALID'});
 await assert.rejects(dispatchRetainedFigure(unreadable,revision,{...command,language:'ca',expectedRevision:'b'.repeat(64)}),{code:'RECORD_CHANGED'});
 await assert.rejects(dispatchRetainedFigure(unreadable,revision,{...command,language:'ca',window:{...window,pointLimit:129}}),{code:'INVALID'});
});

test('every retained request boundary validates preview language before entering its unchanged authorization path',async()=>{
 let entered=0;const admission=Error('authorization boundary reached'),stop=()=>{entered++;throw admission;},workspace={withCatalogueConnections:stop,catalogue:stop},common={operation:'svg',window:{plotId:id(1),seriesOffset:0,seriesLimit:1,pointOffset:0,pointLimit:1}};
 const owners=[
  language=>retainedFigureRequest({workspace:{},readSnapshot:stop},{...common,language,workspaceId:id(10),recordId:id(11),figureId:id(1)}),
  language=>new RecordFigureDrafts(workspace).read({...common,language,id:id(12),workspaceId:id(10),expectedRevision:revision,selection:{}}),
  language=>liveFigure({workspace},null,null,{...common,language,recordId:id(11),figureId:id(1),revision}),
  language=>sharedReviewFigure({workspace},{...common,language,workspaceId:id(10),reviewId:id(12),recordId:id(11),figureId:id(1),version:'incoming',revision}),
  language=>Reviews.prototype.figureOperation.call({active:stop},'figure',{...common,language,workspaceId:id(10),id:id(12),recordId:id(11),recordRevision:revision,figureId:id(1)},null,{})
 ];
 for(const owner of owners){
  for(const locale of locales){entered=0;await assert.rejects(async()=>owner(locale),error=>error===admission);assert.equal(entered,1);}
  for(const invalid of [undefined,null,'fr','../en']){entered=0;await assert.rejects(async()=>owner(invalid),error=>error!==admission);assert.equal(entered,0);}
 }
});

test('the browser never paints a response for an old language and refreshes idle readers without changing selection',async()=>{
 for(const locale of ['en','nn','ca'])await prepare(locale);activateLanguage('en');
 const figure=fixtures()[0],data=await open(figure),commands=[],paints=[],gate=Promise.withResolvers(),started=Promise.withResolvers(),idle=Promise.withResolvers();let status={textContent:''},busy=false,refreshDone=idle;
 const root={isConnected:true,markup:'',get innerHTML(){return this.markup;},set innerHTML(value){this.markup=value;paints.push(value);},querySelector:()=>status,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){},setAttribute(name,value){if(name==='aria-busy'){busy=value==='true';if(!busy)refreshDone.resolve();}}};
 const view=retainedFigureReader({root,request:async(command,options)=>{
  commands.push(structuredClone(command));if(command.operation==='svg'&&command.language==='en'){started.resolve();await gate.promise;}
  return dispatchRetainedFigure(data,revision,command,options);
 }});
 try{
  await started.promise;activateLanguage('nn');gate.resolve();await view.ready;
  assert.deepEqual(commands.filter(command=>command.operation==='svg').map(command=>command.language),['en','nn']);
  const nn=await retainedFigureTranslator('nn');assert.ok(root.innerHTML.includes(esc(nn('figureDisplay','numeralHelp',{radix:6}))));
  const english=await retainedFigureTranslator('en');assert.ok(paints.every(value=>!value.includes(esc(english('figureDisplay','numeralHelp',{radix:6})))));
  assert.ok(commands.filter(command=>command.operation!=='svg').every(command=>!Object.hasOwn(command,'language')));
  const selected=commands.filter(command=>command.operation==='svg').at(-1).window;
  refreshDone=Promise.withResolvers();activateLanguage('ca');await refreshDone.promise;assert.equal(busy,false);
  const ca=await retainedFigureTranslator('ca');assert.ok(root.innerHTML.includes(esc(ca('figureDisplay','numeralHelp',{radix:6}))));
  assert.deepEqual(commands.filter(command=>command.operation==='svg').at(-1).window,selected);
  const count=commands.length;view.dispose();activateLanguage('en');assert.equal(commands.length,count);
 }finally{gate.resolve();view.dispose();activateLanguage('en');}
});
