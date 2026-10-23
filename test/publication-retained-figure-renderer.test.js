import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {publicationEditionParts} from '../src/publication-edition-fragments.js';
import {publicationFigureContents} from '../src/publication-figure-renderer.js';
import {renderPublication} from '../src/publication.js';
import {projectPublication} from '../src/publication-projection.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {createFigure} from '../src/web/figure-model.js';
import {createComposition} from '../src/web/figure-composition.js';
import {assertPublicFiles} from '../src/privacy.js';
const collect=async stream=>{const chunks=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk,'utf8'));return Buffer.concat(chunks).toString('utf8');};
async function fixture({data=true,panels=false}={}){
 const values=new Map(),documents=new RetainedFigureDocuments({readMetadata:async key=>values.get(key)??null,writeMetadata:async(key,value)=>values.set(key,value)}),sourceId=randomUUID(),sourceRevision='a'.repeat(64),f=createFigure();f.title='Complete public figure';f.series[0].name='Retained source-order values';f.series[0].points=Array.from({length:137},(_,i)=>({x:i,y:i+2,error:null}));
 const inputFigure=panels?createComposition([f,f]):f;inputFigure.source={kind:'analysis',id:sourceId,revision:sourceRevision};const builder=documents.builder(inputFigure);for(const panel of panels?inputFigure.panels:[{id:f.id,label:f.title,figure:f}]){await builder.addPlot(panel.figure,{id:panel.id,label:panel.label});for(const series of panel.figure.series){await builder.addSeries(series);for(const point of series.points)await builder.addPoint(point,{source:{kind:'cell',id:sourceId,revision:sourceRevision,row:point.x}});}}
 const figure=await builder.finish(),reader=await documents.open(figure),book=upgradeNotebook(sampleNotebook()),record={...book.entries[0],figures:[figure],body:'Selected result',sections:[],attachments:[],relations:[],share:true},selection={id:record.id,revision:'b'.repeat(64),include:true,body:true,sections:[],fields:[],attachments:[],figures:[{id:figure.id,data}]},collections=new Map();
 collections.set('retainedFigures/'+record.id+'/'+figure.id,{recordId:record.id,figure});for await(const block of reader.blocks())collections.set('figureBlocks/'+block.kind+'/'+block.revision,block.node);
 const input={native:true,document:{collectionNames:()=>['retainedFigures','figureBlocks'],get:async(name,key)=>collections.get(name+'/'+key)??null},get:async(name,id)=>name==='records'&&id===record.id?{id,selection}:null,async *navigation(){},record:async()=>record},plan={target:'entry:'+record.id,originals:new Map([[record.id,record]]),collections:[]};book.entries=[record];const selected={...book,homeEnabled:true,assets:[],entries:[record]},context=projectPublication(book,selected,{publicationTarget:plan.target,entryDestinations:[record],edition:{version:1,records:[selection]}}),files=new Map(),blockedValues=[sourceId,sourceRevision,figure.document.data.root,figure.document.presentation.root],writer={retain:async(name,stream)=>{const text=await collect(stream);assertPublicFiles(new Map([[name,text]]),blockedValues);files.set(name,text);},addChoice:async()=>{}};
 return {input,plan,context,record,figure,writer,files,blockedValues,inputFigure,collections};
}
test('publication adapter streams frozen figures and full consented data without private sources or storage roots',async()=>{
 const f=await fixture(),parts=await publicationEditionParts(f.input,f.plan,{writer:f.writer,media:{},mediaFiles:new Map(),context:f.context,esc:value=>String(value),blockedValues:f.blockedValues}),page=renderPublication(f.context,{editionParts:parts,emitBrowse:false,blockedValues:f.blockedValues.slice(0,2)});parts.attach(page);
 const path='entries/'+f.record.id+'.html',html=await collect(parts.fragments.expand(page.files.get(path)));assert.match(html,/figure-reading-view/);assert.equal((html.match(/data-point-id=/g)??[]).length,137);assert.equal((f.files.get('figures/'+f.record.id+'-'+f.figure.id+'.csv').match(/"measurement",/g)??[]).length,137);assert.equal((f.files.get('figures/'+f.record.id+'-'+f.figure.id+'.svg').match(/class="figure-observation"/g)??[]).length,137);assert.ok(![...page.files.keys()].some(name=>name.startsWith('figures/')),'Streamed files must pass through the output writer');assert.ok(!html.includes('observanda-'));for(const privateValue of f.blockedValues)assert.ok(![html,...f.files.values()].join('\n').includes(privateValue));
 assert.equal(f.record.figures[0].source.id,f.blockedValues[0]);
});
test('chart-only selection never emits data tables or CSV and exact frozen descriptor changes are rejected',async()=>{
 const f=await fixture({data:false}),html=await collect(publicationFigureContents(f.input,f.record.id,f.figure,{writer:f.writer}));assert.equal(f.files.size,1);assert.doesNotMatch(html,/<table|\.csv|data-point-id/);await assert.rejects(collect(publicationFigureContents(f.input,f.record.id,f.figure,{writer:f.writer,data:true})),{code:'JOB_DAMAGED'});
 await assert.rejects(collect(publicationFigureContents(f.input,f.record.id,{...f.figure,title:'Uncaptured title'},{writer:f.writer})),{code:'JOB_DAMAGED'});
});
test('retained composition keeps panel interpretation links and stops immediately on cancellation',async()=>{
 const f=await fixture({panels:true}),statement={id:randomUUID(),kind:'figure',figureId:f.inputFigure.panels[1].figure.id,title:'Second panel conclusion',basis:'authored'},results={version:1,statements:[statement]},html=await collect(publicationFigureContents(f.input,f.record.id,f.figure,{writer:f.writer,results}));assert.match(html,new RegExp('#result-'+statement.id));assert.match(html,/Second panel conclusion/);assert.match(html,/figure-panel-results/);
 const abort=new AbortController(),before=f.files.size;abort.abort();await assert.rejects(collect(publicationFigureContents(f.input,f.record.id,f.figure,{writer:f.writer,signal:abort.signal})),{name:'AbortError'});assert.equal(f.files.size,before);
});
