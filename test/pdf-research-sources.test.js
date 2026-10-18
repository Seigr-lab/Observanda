import {upgradeRecord} from '../src/web/record-model.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './project-domain-fixture.js';
import {PdfDocuments} from '../src/pdf-documents.js';
import {readPdfResearch,retainPdfResearch} from '../src/pdf-research-sources.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {pdfResearchChanges} from '../src/web/pdf-research-model.js';
import {createFigure} from '../src/web/figure-model.js';
import {compilePdfDocument} from '../src/pdf-document-renderer.js';
import {scopePdfIds} from '../src/pdf-figure-renderer.js';

test('selected private research is retained independently, updates require acceptance, and original editions keep their figures',{timeout:180000},async t=>{
 const f=await fixture(t),record=upgradeRecord(f.book.entries[0]),figure=createFigure();figure.title='Measured values';figure.series[0].points=[{x:1,y:3,error:null},{x:2,y:5,error:null}];record.figures=[figure];record.share=false;
 const part={id:randomUUID(),title:'Private result',body:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'9007199254740993'}]},{type:'book_figure',attrs:{version:1,id:randomUUID(),figureId:figure.id,alternative:'Two measured values'}}]}};record.sections=[part];
 const records=new ResearchRecords(f.storage,new MediaStore(f.storage));let row=await f.storage.catalogue(async s=>s.member(await s.snapshot(),record.id));await records.save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:await f.storage.catalogue(async store=>recordRevision(await store.record(row.id,row.revision))),record}]});
 let closed=0;const sourceReader=async()=>({use:async(id,revision,consume)=>({value:await f.storage.catalogue(async store=>{assert.equal(id,f.book.id);const snapshotId=revision??await store.head();return consume(store,await store.snapshot(snapshotId),{snapshotId});})}),verify:async()=>{},close:async()=>{closed++;}});
 const list=await readPdfResearch(sourceReader,{operation:'records',sourceId:f.book.id,snapshotId:null,after:null,search:record.title});assert.equal(list.items.length,1);
 const parts=await readPdfResearch(sourceReader,{operation:'parts',sourceId:f.book.id,snapshotId:list.snapshotId,recordId:record.id,collection:'sections',offset:0});assert.equal(parts.items[0].id,part.id);
 const source={sourceId:f.book.id,snapshotId:list.snapshotId,recordId:record.id,collection:'sections',itemId:part.id},capture=await readPdfResearch(sourceReader,{operation:'selection',...source});assert.equal(capture.figures[0].series[0].points[1].y,5);
 const d=new PdfDocuments(f.storage,f.book.id),id=randomUUID(),sectionId=randomUUID(),first={id:randomUUID(),title:'Authored',content:'Independent text',layout:null,start:null};let head=await d.change({id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header:{version:1,id,name:'Research report',language:'en',direction:'ltr',layout:pdfLayoutPreset()},section:first}});
 const command={id,commandId:randomUUID(),expectedRevision:head.revision,sectionId,replace:false,source};head=await retainPdfResearch(d,sourceReader,command);assert.equal((await retainPdfResearch(d,sourceReader,command)).revision,head.revision);const retained=(await d.read('section',{id,sectionId})).section;assert.equal(retained.research.recordRevision,capture.recordRevision);
 const compiled=await compilePdfDocument((await d.read('open',{id})).header,[retained]);assert.match(compiled.html,/9007199254740993/);assert.match(compiled.html,/<svg/);assert.ok(!compiled.html.includes(capture.workspaceId));assert.ok(!compiled.html.includes(capture.recordRevision));
 row=await f.storage.catalogue(async s=>s.member(await s.snapshot(),record.id));record.sections[0].body='Changed source text';record.figures[0].series[0].points[1].y=8;await records.save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:await f.storage.catalogue(async store=>recordRevision(await store.record(row.id,row.revision))),record}]});
 const incoming=await readPdfResearch(sourceReader,{operation:'selection',...source,snapshotId:null});assert.equal(pdfResearchChanges(retained,incoming).sourceChanged,true);assert.equal((await d.read('section',{id,sectionId})).section.research.recordRevision,capture.recordRevision);
 const updated=await retainPdfResearch(d,sourceReader,{id,commandId:randomUUID(),expectedRevision:head.revision,sectionId,replace:true,source:{...source,snapshotId:incoming.snapshotId}});assert.equal((await d.read('section',{id,sectionId})).section.content,'Changed source text');assert.equal((await d.read('section',{id,sectionId,revision:head.revision})).section.figures[0].series[0].points[1].y,5);
 assert.notEqual(updated.revision,head.revision);assert.ok(closed>=7);assert.equal((await d.read('verify')).documents,1);
});
test('PDF SVG identifier scoping preserves clip paths and marker references',()=>{
 const html='<svg><clipPath id="clip"><path/></clipPath><path clip-path="url(#clip)"/><use href="#clip"/></svg>',scoped=scopePdfIds(html,'section-');assert.match(scoped,/id="section-clip"/);assert.match(scoped,/url\(#section-clip\)/);assert.match(scoped,/href="#section-clip"/);
});
