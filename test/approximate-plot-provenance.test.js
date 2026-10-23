import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {plotComputation,plotComputationHeader} from '../src/dataset-plot-selection.js';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {RetainedFigureAuthoring} from '../src/retained-figure-authoring.js';
import {changeRetainedFigure} from '../src/retained-figure-presentation.js';
import {createFigure,figureCSV,validFigure} from '../src/web/figure-model.js';
import {createComposition} from '../src/web/figure-composition.js';
import {renderFigure,figureTable} from '../src/web/figure-renderer.js';
import {retainedFigureSVG} from '../src/web/retained-figure-svg.js';
import {retainedFigureTable,retainedFigureCSV} from '../src/web/retained-figure-data.js';
import {publicFigureReader} from '../src/publication-figure-renderer.js';
const marker={version:1,kind:'approximate-inputs'},recipe={kind:'analysis',id:randomUUID(),revision:'a'.repeat(64)},approximate={computation:{version:1,kind:'approximate',recipe}};
const collect=async chunks=>{let text='';for await(const chunk of chunks)text+=chunk;return text;};
const mapping={x:0,group:1,operation:'raw',values:[{column:2,error:3,xLower:4,xUpper:5,yLower:6,yUpper:7,count:8}]};
test('plot interpretation follows mapped coordinates, bounds and counts without taint from unused columns',()=>{
 for(let index=0;index<9;index++){const columns=Array.from({length:10},()=>({}));columns[index]=approximate;assert.deepEqual(plotComputation({columns,mapping}),{computation:marker});}
 const columns=Array.from({length:10},()=>({}));columns[9]=approximate;assert.deepEqual(plotComputation({columns,mapping}),{});
 columns[3]=approximate;assert.deepEqual(plotComputation({columns,mapping:{...mapping,operation:'mean'}}),{});columns[2]=approximate;assert.deepEqual(plotComputation({columns,mapping:{...mapping,operation:'count'}}),{});columns[0]=approximate;assert.deepEqual(plotComputation({columns,mapping:{...mapping,operation:'count'}}),{computation:marker});
 const original=createFigure(),selected={columns:[{},approximate],mapping:{x:0,group:null,values:[{column:1,error:null}]}};
 const header=plotComputationHeader(original,selected);assert.equal(original.computation,undefined);assert.deepEqual(header.computation,marker);assert.deepEqual(plotComputationHeader(header,{...selected,columns:[{},{}]}),original);
});
test('retained approximation survives presentation edits, public exports and complete JSON roundtrip without private recipe identity',async()=>{
 const values=new Map(),documents=new RetainedFigureDocuments({readMetadata:async key=>values.get(key)??null,writeMetadata:async(key,value)=>values.set(key,value)}),f=plotComputationHeader(createFigure(),{columns:[{},approximate],mapping:{x:0,group:null,values:[{column:1,error:null}]}});
 f.title='Computed finite values';f.source=recipe;f.series[0].points=[{x:0,y:1.414,error:null}];f.style={showTitle:false};
 const retained=await documents.retain(f),changed=await changeRetainedFigure(documents,retained,{type:'text',collection:'header',field:'title',offset:0,remove:f.title.length,text:'Renamed plot'}),reader=await documents.open(changed);
 assert.deepEqual((await reader.header()).header.computation,marker);assert.equal(changed.document.data.root,retained.document.data.root);
 await assert.rejects(changeRetainedFigure(documents,changed,{type:'patch',collection:'header',patch:{computation:null}}),{code:'MATERIAL_INVALID'});
 const publicReader=publicFigureReader(reader),svg=await collect(retainedFigureSVG(publicReader,{width:390})),html=await collect(retainedFigureTable(publicReader)),csv=await collect(retainedFigureCSV(publicReader));
 for(const output of [svg,html])assert.match(output,/Computed from approximate inputs/);
 assert.match(csv,/approximate-inputs/);for(const output of [svg,html,csv]){assert.equal(output.includes(recipe.id),false);assert.equal(output.includes(recipe.revision),false);assert.equal(output.includes(changed.document.data.root),false);}
 const complete=JSON.parse(await collect(reader.json()));assert.deepEqual(complete.computation,marker);assert.equal(validFigure(complete),true);
 assert.match(renderFigure(complete,{width:390}),/Computed from approximate inputs/);assert.match(figureTable(complete),/Computed from approximate inputs/);assert.match(figureCSV(complete),/approximate-inputs/);
 assert.equal(validFigure({...complete,computation:approximate.computation}),false);
 const exact=createFigure();exact.series[0].points=[{x:1,y:2,error:null}];const exactReader=await documents.open(await documents.retain(exact));assert.equal(Object.hasOwn((await exactReader.header()).header,'computation'),false);assert.doesNotMatch(await collect(retainedFigureSVG(exactReader)),/Computed from approximate inputs/);
});

test('appending retained approximate series preserves interpretation through draft proofs and strict finish',async()=>{
 const values=new Map(),workspace={readMetadata:async key=>values.get(key)??null,writeMetadata:async(key,value)=>values.set(key,value)},documents=new RetainedFigureDocuments(workspace),owner=new RetainedFigureAuthoring(workspace),base=createFigure(),source=createFigure();
 base.series[0].name='Exact baseline';base.series[0].points=[{x:0,y:1,error:null}];source.series[0].name='Approximate source';source.series[0].points=[{x:0,y:1.414,error:null}];source.computation=marker;
 const original=await documents.retain(base),retained=await documents.retain(source);let draft=await owner.start(original);const panel=(await (await owner.open(draft)).window({collection:'panels',limit:1})).items[0];
 draft=await owner.import(draft,retained,{mode:'append',plotId:panel.plotId});await owner.verify(draft);
 const saved=await owner.finish(draft),reader=await documents.open(saved);assert.deepEqual((await reader.header()).header.computation,marker);assert.deepEqual((await reader.header({plotId:panel.plotId})).header.computation,marker);assert.equal(saved.document.counts.points,2);
 const untouched=await documents.open(original);assert.equal(Object.hasOwn((await untouched.header()).header,'computation'),false);
 const other=createFigure();other.series[0].name='Another exact source';other.series[0].points=[{x:1,y:2,error:null}];draft=await owner.start(saved);draft=await owner.import(draft,await documents.retain(other),{mode:'append',plotId:panel.plotId});await owner.verify(draft);const final=await documents.open(await owner.finish(draft));assert.deepEqual((await final.header()).header.computation,marker);assert.equal((await final.header()).counts.points,3);
 assert.match(await collect(retainedFigureSVG(publicFigureReader(final))),/Computed from approximate inputs/);
});


test('direct retained figure verification requires approximation admission for root and selected panel headers',async()=>{
 const values=new Map(),workspace={readMetadata:async key=>values.get(key)??null,writeMetadata:async(key,value)=>values.set(key,value)},documents=new RetainedFigureDocuments(workspace),exact=createFigure();
 exact.series[0].points=[{x:1,y:2,error:null}];const approximate={...structuredClone(exact),id:randomUUID(),computation:marker};
 const ordinary=await documents.retain(exact),single=await documents.retain(approximate),composition=await documents.retain(createComposition([exact,approximate]));
 let generation=122;workspace.storageKind=async()=> 'catalogue';workspace.catalogue=async operation=>operation({catalogueDb:{all:async sql=>{assert.equal(sql,'SELECT version FROM catalogue_format');return [{version:String(generation)}];}},db:{all:async()=>{throw new Error('Figure admission must use the parent catalogue');}}});
 await (await documents.open(ordinary)).verify();
 for(const retained of [single,composition]){
  generation=122;await assert.rejects((await documents.open(retained)).verify(),{code:'CATALOGUE_DAMAGED'});
  generation=1610612736+122;await (await documents.open(retained)).verify();
 }
});
