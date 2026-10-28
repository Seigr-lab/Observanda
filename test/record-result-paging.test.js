import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {RecordDocument,withRecordDocument} from '../src/record-document.js';
import {RecordContent} from '../src/record-content.js';
import {RecordHistory} from '../src/record-history.js';
import {RetainedRecordDocuments} from '../src/retained-record-documents.js';
import {RecordFigureCommands} from '../src/record-figure-commands.js';
import {figureCopySource} from '../src/record-figure-copy-values.js';
import {createComposition,figureTargets} from '../src/web/figure-composition.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {recordRevision} from '../src/research.js';
import {validateRecordDocument} from '../src/record-document-validation.js';
import {validateDocumentSources} from '../src/record-document-sources.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {publicationWorkspace} from '../src/publication-pin.js';
import {WebsiteSites} from '../src/website-sites.js';
import {contentBuffer} from '../src/file-content.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {retainedTable} from '../src/retained-tables.js';
const media={get:async()=>{throw Error('Unexpected media access');}};
const target=f=>({workspaceId:f.book.id,recordId:f.record.id});
async function inspect(f,consume){return f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),f.record.id);return withRecordDocument(store,row.id,row.revision,consume);});}
async function fixture(t){
 const f=await figureValueFixture();t.after(f.close);
 const ready=await f.workspace.read(),record=ready.book.entries[0],compound=record.figures[8],figures=figureTargets([compound]).slice(0,3);
 record.results={version:1,statements:Array.from({length:97},(_,i)=>({id:randomUUID(),kind:i%4===3?'conclusion':'figure',title:'Paging result '+String(i).padStart(3,'0'),text:'Exact interpretation '+i+' 9007199254740993/6',limitations:'Retained limitation '+i,basis:i%4===3?'authored':'retained',source:i%4===3?null:f.analysis,...(i%4===3?{}:{figureId:figures[i%4].id})}))};
 record.share=true;await f.workspace.save(ready.book,ready.etag);
 const original=await inspect(f,document=>document.tree.read(document.root)),ref=await f.materials.pinRecord(record.id,recordRevision(original));
 return {...f,record:original,ref,compound,etag:(await f.workspace.outline()).etag};
}
function selectedOnly(t){
 const field=RecordDocument.prototype.field;
 t.mock.method(RecordDocument.prototype,'field',function(path,...rest){if(path[0]==='results'&&(path.length===1||path.length===2&&path[1]==='statements'))throw Error('Selected operation reconstructed all results');return field.call(this,path,...rest);});
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Selected operation reconstructed a record');});
}
const content=value=>{const {id,figureId,...rest}=value;return rest;};

test('result windows and anchors retain all 97 statements across current and exact historical readers',async t=>{
 const f=await fixture(t),reader=new RecordContent(f.workspace),retained=new RetainedRecordDocuments(f.workspace),statements=f.record.results.statements,figureId=f.compound.panels[0].figure.id;
 selectedOnly(t);const items=RecordDocument.prototype.items;
 t.mock.method(RecordDocument.prototype,'items',function(path,...rest){if(path[0]==='results')throw Error('Indexed reader scanned result statements');return items.call(this,path,...rest);});
 const page=await reader.read({...target(f),pagedHeader:true,offset:72,windows:{results:92,figures:8}});
 assert.deepEqual(page.header.results.statements,statements.slice(92,96));assert.deepEqual(page.collections.results,{offset:92,total:97,count:4});
 assert.equal(page.resultFigures[f.compound.id],25);assert.equal(page.resultFigures[figureId],24);
 const filtered=await reader.read({...target(f),pagedHeader:true,resultFigure:figureId,windows:{results:20}});
 assert.deepEqual(filtered.header.results.statements,statements.filter(s=>s.figureId===figureId).slice(20));assert.deepEqual(filtered.collections.results,{offset:20,total:24,count:4});assert.equal(filtered.resultWindow.figureId,figureId);
 for(const prefix of ['result-','record-result-']){
  const anchor=prefix+statements[96].id,current=await reader.read({...target(f),pagedHeader:true,anchor,resultFigure:figureId});
  assert.deepEqual(current.header.results.statements,[statements[96]]);assert.equal(current.resultWindow.figureId,null);
  const pinned=await retained.read({ref:f.ref,anchor,resultFigure:figureId,compare:true});
  assert.equal(pinned.search,undefined);assert.deepEqual(pinned.previous.header.results.statements,[statements[96]]);assert.equal(pinned.previous.resultWindow.figureId,null);assert.deepEqual(pinned.current.header.results.statements,[statements[96]]);
 }
 RecordDocument.prototype.items.mock.restore();
 const command={...target(f),field:'result:'+statements[96].id},base=await f.values.read(command),changed={...statements[96],text:'Later independent interpretation'};
 await f.values.save({...command,expectedRevision:base.revision,value:{value:changed}});
 const history=new RecordHistory(f.workspace,media),review=await history.read({...target(f),paged:true,source:{kind:'workspace',id:f.etag},revision:f.ref.revision,anchor:'result-'+statements[96].id,resultFigure:figureId});
 assert.ok(review.changed.includes('results'));assert.deepEqual(review.previous.header.results.statements,[statements[96]]);assert.deepEqual(review.next.header.results.statements,[changed]);assert.equal(review.previous.resultWindow.figureId,null);assert.equal(review.next.resultWindow.figureId,null);
 const exact=await retained.value(f.ref);assert.equal(recordRevision(exact),f.ref.revision);assert.deepEqual(exact.results,f.record.results);
});

test('figure duplicate and retained panel copy preserve every associated result beyond 64 in original order',async t=>{
 const f=await fixture(t),statements=f.record.results.statements,originalTargets=figureTargets([f.compound]),targetIds=new Set(originalTargets.map(item=>item.id)),associated=statements.filter(s=>targetIds.has(s.figureId));
 assert.ok(associated.length>64);selectedOnly(t);
 const base=await f.values.read(f.target(f.compound.id)),commands=new RecordFigureCommands(f.workspace),command={...target(f),id:randomUUID(),figureId:f.compound.id,action:'duplicate',expectedRevision:base.revision},saved=await commands.run(command);
 assert.deepEqual(await commands.run(command),saved);
 const duplicate=(await f.values.read(f.target(saved.figureId))).value.value,to=figureTargets([duplicate]),mapping=new Map(originalTargets.map((item,i)=>[item.id,to[i].id]));
 let all=await inspect(f,async document=>{const values=[];for await(const item of document.items(['results','statements']))values.push(await document.tree.read(item.value));return values;});
 assert.deepEqual(all.slice(0,97),statements);assert.equal(all.length,97+associated.length);
 assert.deepEqual(all.slice(97).map(content),associated.map(content));assert.deepEqual(all.slice(97).map(s=>s.figureId),associated.map(s=>mapping.get(s.figureId)));assert.equal(new Set(all.map(s=>s.id)).size,all.length);
 const plotId=f.compound.panels[0].figure.id,source=await figureCopySource(f.workspace,{...target(f),source:f.ref,figureId:f.compound.id,plotId});assert.equal(source.statementCount,24);
 const figure=createComposition([source.figure,source.figure]),empty=await f.values.read(f.target(figure.id)),value={value:figure,copies:figure.panels.map(panel=>({source:f.ref,figureId:f.compound.id,plotId,targetId:panel.figure.id}))},copyCommand={...f.target(figure.id),expectedRevision:empty.revision,value},copy=await f.values.save(copyCommand);
 assert.deepEqual(await f.values.save(copyCommand),copy);
 all=await inspect(f,async document=>{const values=[];for await(const item of document.items(['results','statements']))values.push(await document.tree.read(item.value));return values;});
 const expected=statements.filter(s=>s.figureId===plotId);assert.equal(all.length,97+associated.length+expected.length*2);
 for(const panel of figure.panels){const linked=all.filter(s=>s.figureId===panel.figure.id);assert.equal(linked.length,24);assert.deepEqual(linked.map(content),expected.map(content));}
 assert.equal(new Set(all.map(s=>s.id)).size,all.length);assert.deepEqual((await new RetainedRecordDocuments(f.workspace).value(f.ref)).results,f.record.results);
});

test('late result source admission and complete publication use originals independently of reader windows',async t=>{
 const f=await fixture(t),head=(await f.workspace.outline()).etag,last=f.record.results.statements[96];
 const check=async statement=>f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),row=await store.member(snapshot,f.record.id);
  return withRecordDocument(store,row.id,row.revision,async original=>{
   const document=await original.replace(['results','statements','96'],statement),header=await validateRecordDocument(document,snapshot.metadata);
   assert.deepEqual(header.results,{version:1,statements:[]});
   await validateDocumentSources(store,snapshot,document,header,original,media);
  },{mutable:true});
 }));
 await assert.rejects(check({...last,figureId:randomUUID()}),{code:'ANALYSIS_INVALID'});
 await assert.rejects(check({...last,source:{...f.analysis,revision:'0'.repeat(64)}}),{code:'MATERIAL_MISSING'});
 await check(last);assert.equal((await f.workspace.outline()).etag,head);
 const bytes=Buffer.from('State,Count,Private\nA,10000000000000001,PRIVATE_RESULT_COLUMN\nB,0.3,PRIVATE_RESULT_COLUMN'),upload=await f.materials.startImport({recordId:f.record.id,name:'result-table.csv',size:bytes.length});await f.materials.appendImport(upload.id,0,[bytes]);
 const source=await f.materials.dataset({recordId:f.record.id,title:'Exact table input',artifact:await f.materials.finishImport(upload.id),columns:[defaultColumn({label:'State'}),{...defaultColumn({label:'Count'}),representation:'radix-fraction',radix:6},defaultColumn({label:'Private'})]});
 const table=await retainedTable(f.materials,{ref:source,selection:{columns:[0,1],offset:0,count:2,includeExcluded:false}}),statement={id:randomUUID(),kind:'table',title:'Late retained table',text:'Selected exact observations',limitations:'Two retained rows only',basis:'retained',source,table},command={...target(f),field:'result:'+statement.id},base=await f.values.read(command);
 await f.values.save({...command,expectedRevision:base.revision,value:{value:statement}});
 const late=await new RecordContent(f.workspace).read({...target(f),pagedHeader:true,windows:{results:97}});assert.deepEqual(late.header.results.statements,[statement]);assert.deepEqual(late.collections.results,{offset:97,total:98,count:1});
 const sites=new WebsiteSites(f.workspace),site=await sites.read(null),selection=structuredClone(site.site.selection);
 selection.records=selection.records.filter(row=>row.id!==f.record.id);selection.records.push({id:f.record.id,share:true,attachments:[]});
 await sites.save(null,{workspaceId:f.book.id,baseEtag:site.etag,websitePin:site.websitePin,metadata:{},projects:[],changes:[],removed:[],selection});
 const expected={version:1,statements:[...f.record.results.statements,statement]},outline=await publicationWorkspace(f.workspace).outline();
 const output=await new PublicationJobs(f.workspace).inline({etag:outline.etag,websitePin:outline.websitePin}),html=(await contentBuffer(await output.files.get('entries/'+f.record.id+'.html'))).toString();
 for(const statement of expected.statements){assert.ok(html.includes('id="result-'+statement.id+'"'));assert.ok(html.includes(statement.text));assert.ok(html.includes(statement.limitations));}
 assert.ok(!html.includes(f.analysis.id));assert.ok(!html.includes(source.id));assert.ok(!html.includes('PRIVATE_RESULT_COLUMN'));assert.ok(html.includes('10000000000000001'));
 const exported=await f.workspace.read();assert.deepEqual(exported.book.entries[0].results,expected);
 await f.workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));
});


test('selected result validation reuses admitted owners while rejecting duplicate and invalid changed statements',async t=>{
 const f=await fixture(t);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),row=await store.member(snapshot,f.record.id);
  await withRecordDocument(store,row.id,row.revision,async original=>{
   const statements=f.record.results.statements;
   original.items=async function*(){throw Error('Rescanned admitted source collection');};
   const check=async document=>{
    document.items=async function*(){throw Error('Rescanned unchanged record collection');};
    const header=await validateRecordDocument(document,snapshot.metadata,{admitted:original});assert.deepEqual(header.results,{version:1,statements:[]});
   };
   let changed=await original.replace(['results','statements','96'],{...statements[96],text:'Selected corrected interpretation'});
   await check(changed);
   const added={id:randomUUID(),kind:'conclusion',basis:'authored',source:null,title:'New conclusion',text:'Later finding',limitations:'Retained limitations'};
   await check(await original.splice(['results','statements'],97,0,[added]));
   await assert.rejects(check(await original.replace(['results','statements','96'],{...statements[96],id:statements[0].id})),{code:'INVALID'});
   await assert.rejects(check(await original.replace(['results','statements','96'],{...statements[96],kind:'unsupported'})),{code:'INVALID'});
   changed=await original.replace(['results','statements','95'],statements[96]);changed=await changed.replace(['results','statements','96'],statements[95]);await check(changed);
   changed=await original.splice(['results','statements'],97,0,[added,added]);await assert.rejects(check(changed),{code:'INVALID'});
   // A changed unrelated collection cannot borrow the result-only proof.
   changed=await original.replace(['sections','0','body'],'Changed writing');
   await assert.rejects(check(changed),/Rescanned unchanged record collection/);
  },{mutable:true});
 }));
 assert.deepEqual((await f.workspace.read()).book.entries[0].results,f.record.results);
});
