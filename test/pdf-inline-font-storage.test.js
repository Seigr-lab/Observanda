import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './project-domain-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {initializeProjectLocation,ProjectStorage} from '../src/project-storage.js';
import {WorkspaceFonts} from '../src/workspace-fonts.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {PdfDocuments} from '../src/pdf-documents.js';
import {PdfDocumentStore} from '../src/pdf-document-store.js';
import {retainPdfResearch} from '../src/pdf-research-sources.js';
import {executePdfRequest,pdfDocumentRequest} from '../src/pdf-document-requests.js';
import {readPdfDocumentFont} from '../src/pdf-document-fonts.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {compilePdfDocument} from '../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../src/pdf-font-assets.js';
import {backupCatalogue} from '../src/postgres.js';
import {workspaceFile} from '../src/storage.js';
import {verifyCatalogueArchive} from '../src/research-catalogue.js';
const prose=(font,text)=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text,marks:[{type:'font_family',attrs:{font}}]}]}]});
async function compiled(documents,id,revision){return documents.domains.run(['pdf'],async get=>{const store=get('pdf'),owner=new PdfDocumentStore(store),saved=await owner.open(id,{revision}),customFonts=new Map();for(const pin of saved.header.fonts??[])customFonts.set(pin.id,await readPdfDocumentFont(store,id,pin));return embedPdfFonts(await compilePdfDocument(saved.header,owner.content(id,revision)),{customFonts});});}
test('inline research fonts use the actual source owner and remain exact through replay, editing and archive reopen',{timeout:150000},async t=>{
 const f=await fixture(t),bytes=await readFile(new URL('../src/fonts/atkinson.ttf',import.meta.url)),access=JSON.parse(await readFile(path.join(f.storage.root,'.observanda/access.json'),'utf8')),book=sampleNotebook();book.title=book.projects[0].title='source';const source=await initializeProjectLocation(path.join(f.root,'source'),book.projects[0].id,book,access,f.vault),font=await new WorkspaceFonts(source).import(bytes,{embed:true});
 // The host has the identical bytes but explicitly denies embedding. Capture
 // must use the authenticated selected source, not the destination library.
 await new WorkspaceFonts(f.storage).import(bytes,{embed:false});const record=structuredClone(book.entries[0]),expectedRevision=recordRevision(record);record.body=prose(font.id,'Selected source typography');
 await new ResearchRecords(source,new MediaStore(source)).save({workspaceId:book.id,changes:[{id:record.id,expectedRevision,record}]});
 const snapshotId=await source.catalogue(store=>store.head()),sourceReader=async()=>({use:async(id,pin,consume)=>{assert.equal(id,book.id);assert.equal(pin,snapshotId);return {value:await source.catalogue(async store=>consume(store,await store.snapshot(pin),{snapshotId:pin,storage:source}))};},verify:async()=>{},close:async()=>{}}),documents=new PdfDocuments(f.storage,f.book.id),id=randomUUID(),sectionId=randomUUID(),header={version:1,id,name:'Independent inline fonts',language:'en',direction:'ltr',layout:pdfLayoutPreset()},empty={id:randomUUID(),title:'Introduction',content:'Bundled text',layout:null,start:null};
 const first=await documents.change({id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header,section:empty}}),command={id,commandId:randomUUID(),expectedRevision:first.revision,sectionId,replace:false,source:{sourceId:book.id,snapshotId,recordId:record.id,collection:'body',itemId:record.id}},saved=await retainPdfResearch(documents,sourceReader,command);
 assert.equal(saved.fonts.length,1);assert.equal(saved.fonts[0].id,font.id);assert.ok((await compiled(documents,id,saved.revision)).html.includes(bytes.toString('base64')));
 for(const storage of [source,f.storage])await storage.withLock(async()=>{await storage.writeMetadata('.observanda/fonts/library.json','[]');await storage.removeMetadata('.observanda/fonts/'+font.id+'.json');});
 const unavailable=async()=>{throw Error('Source must not be reopened');};assert.deepEqual(await retainPdfResearch(documents,unavailable,command),{...saved,replayed:true});await assert.rejects(retainPdfResearch(documents,unavailable,{...command,source:{...command.source,itemId:randomUUID()}}),{code:'MODULE_REPLAY'});
 const section=(await documents.read('section',{id,sectionId})).section;section.notes=[{id:randomUUID(),kind:'footnote',block:0,content:prose(font.id,'Retained inline note')}];const edit={id,commandId:randomUUID(),expectedRevision:saved.revision,operation:{type:'section',section}},changed=await documents.change(edit);assert.deepEqual(changed.fonts,saved.fonts);assert.deepEqual(await documents.change(edit),{...changed,replayed:true});
 const request=pdfDocumentRequest('/api/pdf/font-read');assert.equal(request.write,false);assert.equal(request.binary,true);const binary=await executePdfRequest(f.storage,request,{workspaceId:f.book.id,id,revision:changed.revision,fontId:font.id},{binary:value=>value});assert.equal(binary.mime,'font/ttf');assert.deepEqual(binary.content,bytes);
 await assert.rejects(executePdfRequest(f.storage,request,{workspaceId:f.book.id,id,revision:first.revision,fontId:font.id},{binary:value=>value}),{code:'NOT_FOUND'});
 await assert.rejects(documents.change({...edit,commandId:randomUUID(),expectedRevision:changed.revision,operation:{type:'section',section:{...section,content:prose('modern','No substitution')}}}),{code:'PDF_FONT'});assert.equal((await documents.read('open',{id})).revision,changed.revision);
 const before=await compiled(documents,id,changed.revision);assert.ok(before.html.includes('Retained inline note'));assert.equal((await documents.read('verify')).documents,1);
 const descriptor=await f.storage.readFile(await workspaceFile(f.storage.root),'utf8'),archiveRoot=path.join(f.root,'archive');await mkdir(path.join(archiveRoot,'.observanda'),{recursive:true});for(const file of [path.basename(await workspaceFile(f.storage.root)),'.observanda/access.json'])await copyFile(path.join(f.storage.root,file),path.join(archiveRoot,file));const db=await f.storage.openCatalogue();try{await backupCatalogue(f.storage.root,archiveRoot,{connection:db});}finally{await db.close();}
 const archive=new ProjectStorage(archiveRoot,f.projectId,f.vault);await verifyCatalogueArchive(archive,JSON.parse(descriptor));assert.equal((await compiled(new PdfDocuments(archive,f.book.id),id,changed.revision)).html,before.html);
});
