import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './project-domain-fixture.js';
import {PdfDocuments} from '../src/pdf-documents.js';
import {readPdfResearch,retainPdfResearch} from '../src/pdf-research-sources.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {PdfExportJobs} from '../src/pdf-export-jobs.js';
import {digest} from '../src/storage-format.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {compilePdfDocument} from '../src/pdf-document-renderer.js';
import {scopePdfIds} from '../src/pdf-figure-renderer.js';

test('PDF composition uses only PDF-granted files, updates existing placements and refuses stale completed PDFs', {timeout:180000},async t=>{
 const f=await fixture(t),files=new WebsiteFileStore(f.storage),d=new PdfDocuments(f.storage,f.book.id,{publicationFiles:files}),sourceOwner=randomUUID(),recordId=randomUUID(),notebookId=randomUUID(),projectId=randomUUID(),component=randomUUID();
 // This source owner does not exist in any database. All selections use
 // explicitly converted PDF composition files under the destination workspace.
 const provenance={workspaceId:sourceOwner,recordId,notebookId,projectId,target:'pdf',revision:'1'.repeat(64),recordRevision:'2'.repeat(64)},sourceId=websiteSourceId(provenance);
 const update=async(content,visible=true)=>files.putSource({sourceId,target:'pdf',title:'Observation',provenance,visible,html:'',pdfParts:{version:1,entry:content,body:content,sections:[{id:component,title:'Measurements',content}],figures:[],images:[]}},{token:await files.beginSourceUpdate({sourceId})});
 const initial=await update('Permitted measurement');const list=await readPdfResearch(files,{operation:'records',after:null,search:'Observation'});assert.equal(list.items[0].id,recordId);
 const source={sourceId:sourceOwner,snapshotId:initial.revision,recordId,collection:'sections',itemId:component};const capture=await readPdfResearch(files,{operation:'selection',...source});assert.equal(capture.content,'Permitted measurement');
 const id=randomUUID(),sectionId=randomUUID(),first={id:randomUUID(),title:'Author text',content:'Independent text',layout:null,start:null};let head=await d.change({id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header:{version:1,id,name:'Report',language:'en',direction:'ltr',layout:pdfLayoutPreset()},section:first}});
 const command={id,commandId:randomUUID(),expectedRevision:head.revision,sectionId,replace:false,source};head=await retainPdfResearch(d,files,command);assert.equal((await retainPdfResearch(d,files,command)).revision,head.revision);
 const selected=(await d.read('section',{id,sectionId})).section;const html=await compilePdfDocument((await d.read('open',{id})).header,[selected]);assert.match(html.html,/Permitted measurement/);
 const bytes=Buffer.from('%PDF-1.7 test'),jobId=randomUUID(),jobs=new PdfExportJobs(d,{prepare:async()=>({bytes,sha256:digest(bytes),renderer:{engine:'chromium',electron:'test',chromium:'test',recipeVersion:1},preflight:{version:1,status:'ok',findings:[],truncated:false},sourceProof:[{workspaceId:sourceOwner,recordId,revision:initial.revision}]})});
 await jobs.start({jobId,documentId:id,revision:head.revision});assert.equal((await jobs.work(jobId)).state,'completed');assert.deepEqual((await jobs.download(jobId)).bytes,bytes);
 await update('Newly permitted section content');assert.equal((await d.read('section',{id,sectionId})).section.content,'Newly permitted section content');await assert.rejects(jobs.download(jobId),{code:'PDF_SOURCE_CONTENT'});
 await update('',false);const withdrawn=await d.read('section',{id,sectionId,revision:head.revision});assert.equal(withdrawn.section.content,'');assert.equal(withdrawn.section.research.content,'');assert.ok(!(await d.read('sections',{id})).items.some(item=>item.title==='Measurements'));await assert.rejects(readPdfResearch(files,{operation:'selection',...source,snapshotId:null}),{code:'PDF_SOURCE_CONTENT'});
 await update('Restored section');assert.equal((await d.read('section',{id,sectionId})).section.content,'Restored section');
 const summaries=(await d.read('sections',{id})).items;
 assert.equal(summaries.find(item=>item.id===sectionId).hasPublicationContent,true);
 assert.equal(summaries.find(item=>item.id===first.id).hasPublicationContent,undefined);
});
test('PDF SVG identifier scoping preserves clip paths and marker references',()=>{
 const html='<svg><clipPath id="clip"><path/></clipPath><path clip-path="url(#clip)"/><use href="#clip"/></svg>',scoped=scopePdfIds(html,'section-');assert.match(scoped,/id="section-clip"/);assert.match(scoped,/url\(#section-clip\)/);assert.match(scoped,/href="#section-clip"/);
});
