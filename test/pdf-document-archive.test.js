import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PdfDocumentStore} from '../src/pdf-document-store.js';
import {PdfDocuments} from '../src/pdf-documents.js';
import {PdfExportJobs} from '../src/pdf-export-jobs.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {digest} from '../src/storage-format.js';
import {fixture} from './project-domain-fixture.js';
const section=(title='Evidence',content='Retained observation')=>({id:randomUUID(),title,content,layout:null,start:null});
const creation=(name='Report')=>{const id=randomUUID();return {id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header:{version:1,id,name,language:'en',direction:'ltr',layout:pdfLayoutPreset()},section:section()}};};
const command=(id,expectedRevision,type)=>({id,commandId:randomUUID(),expectedRevision,operation:{type}});
function memory(){
 const data=new Map(),owner={domain:'pdf',async object(id){return structuredClone(data.get(id)??null);},async putObject(id,value){data.set(id,structuredClone(value));},async *objectIdEntries(prefix){for(const key of [...data.keys()].sort())if(key.startsWith(prefix))yield key;}};
 return {data,owner,documents:new PdfDocumentStore(owner)};
}

test('PDF archive and restore preserve exact editions, issue distinct CAS pins and replay without another lifecycle change',async()=>{
 const {documents:d,data}=memory(),create=creation(),saved=await d.change(create),extra=section('Second','Pinned second section'),appended=await d.change({...command(create.id,saved.revision,'append'),operation:{type:'append',section:extra}}),other=creation('Other document');await d.change(other);
 const retained=new Map([...data].filter(([key])=>key.startsWith('pdf:block:'+create.id+':')||key.startsWith('pdf:revision:'+create.id+':')));
 assert.equal((await d.revision(create.id,saved.revision)).version,1);
 const remove=command(create.id,appended.revision,'remove'),archived=await d.change(remove);assert.notEqual(archived.revision,appended.revision);assert.deepEqual(await d.change(remove),{revision:archived.revision,replayed:true});
 assert.deepEqual((await d.list()).items.map(row=>row.id),[other.id]);assert.equal((await d.archive()).items[0].revision,archived.revision);await assert.rejects(d.open(create.id),{code:'NOT_FOUND'});
 assert.equal((await d.openArchived(create.id)).archived,true);assert.equal((await d.openArchived(create.id,{revision:saved.revision})).count,1);
 await assert.rejects(d.openArchived(other.id),{code:'NOT_FOUND'});await assert.rejects(d.change({...command(create.id,archived.revision,'section'),operation:{type:'section',section:extra}}),{code:'NOT_FOUND'});
 await assert.rejects(d.change({...remove,operation:{type:'restore-document'}}),{code:'MODULE_REPLAY'});
 await assert.rejects(d.change(command(create.id,appended.revision,'restore-document')),{code:'CONFLICT'});
 const restore=command(create.id,archived.revision,'restore-document'),restored=await d.change(restore);
 assert.notEqual(restored.revision,archived.revision);assert.notEqual(restored.revision,appended.revision);assert.deepEqual(await d.change(restore),{revision:restored.revision,replayed:true});
 assert.equal((await d.archive()).items.length,0);assert.equal((await d.open(create.id)).count,2);assert.equal((await d.section(create.id,extra.id)).section.content,extra.content);
 assert.equal((await d.open(create.id,{revision:saved.revision})).count,1);await assert.rejects(d.openArchived(create.id),{code:'NOT_FOUND'});
 await assert.rejects(d.change(command(create.id,appended.revision,'remove')),{code:'CONFLICT'});
 const history=await d.history(create.id);assert.deepEqual(history.items.map(row=>row.revision),[restored.revision,archived.revision,appended.revision,saved.revision]);assert.deepEqual(await d.verify(),{documents:2,editions:5});
 for(const [key,value] of retained)assert.deepEqual(data.get(key),value);
 // Retrying a completed restore after a later archive acknowledges its receipt,
 // without undoing the new archive. A fresh old-pin restore must conflict.
 const later=await d.change(command(create.id,restored.revision,'remove'));assert.deepEqual(await d.change(restore),{revision:restored.revision,replayed:true});assert.equal((await d.openArchived(create.id)).revision,later.revision);
 await assert.rejects(d.change(command(create.id,archived.revision,'restore-document')),{code:'CONFLICT'});
 const live=await d.change(command(create.id,later.revision,'restore-document'));
 const edition=await d.change({...command(create.id,live.revision,'restore'),operation:{type:'restore',revision:archived.revision}});
 assert.equal((await d.open(create.id)).revision,edition.revision);assert.equal((await d.revision(create.id,edition.revision)).lifecycle.archived,false);assert.equal((await d.archive()).items.length,0);await d.verify();
});

test('PDF archive pages use the authenticated directory and reject missing, stale or cross-directory members',async()=>{
 const {documents:d,owner,data}=memory(),ids=[];
 for(let n=0;n<39;n++){const create=creation('Report '+n),saved=await d.change(create),archived=await d.change(command(create.id,saved.revision,'remove'));ids.push(create.id);assert.ok(archived.revision);}
 const live=creation('Live');await d.change(live);const scans=owner.objectIdEntries;
 owner.objectIdEntries=async function*(){throw new Error('ordinary archive reads must not scan metadata');};
 const found=[];let after=null;do{const page=await d.archive({after,limit:7});assert.ok(page.items.length<=7);found.push(...page.items.map(row=>row.id));after=page.next;}while(after!==null);
 assert.deepEqual(found,[...ids].sort());assert.equal(new Set(found).size,39);assert.equal((await d.openArchived(ids[0])).header.name,'Report 0');
 await assert.rejects(d.archive({limit:101}),{code:'INVALID'});owner.objectIdEntries=scans;
 await d.verify();const directory=structuredClone(data.get('pdf:archive'));
 data.set('pdf:archive',{version:1,root:null});await assert.rejects(d.verify(),{code:'CATALOGUE_DAMAGED'});data.set('pdf:archive',directory);
 const index=d.index('archive'),liveHead=await d.head(live.id),cross=await index.change(directory.root,live.id,liveHead.revision);await index.flush(cross);data.set('pdf:archive',{version:1,root:cross});await assert.rejects(d.verify(),{code:'CATALOGUE_DAMAGED'});data.set('pdf:archive',directory);
 const first=await d.head(ids[0],{removed:true}),stale=await index.change(directory.root,first.id,'a'.repeat(64));await index.flush(stale);data.set('pdf:archive',{version:1,root:stale});await assert.rejects(d.verify(),{code:'CATALOGUE_DAMAGED'});data.set('pdf:archive',directory);
 const headKey='pdf:head:'+first.id;data.delete(headKey);await assert.rejects(d.verify(),{code:'CATALOGUE_DAMAGED'});data.set(headKey,first);assert.deepEqual(await d.verify(),{documents:1,editions:79});
});

test('legacy removed v1 PDF documents remain explicitly recoverable without a migration or an archive read write',async()=>{
 const {documents:d,data}=memory(),create=creation('Legacy retained report'),saved=await d.change(create),head=await d.head(create.id),index=d.index(create.id),directoryIndex=d.index('directory');
 // The old remove protocol kept the v1 content hash and appended that same
 // edition to history. It had no archive directory.
 head.sequence++;head.history=await index.change(head.history,String(head.sequence).padStart(16,'0'),saved.revision);await index.flush(head.history);head.removed=true;data.set('pdf:head:'+create.id,head);
 const directory=await d.directory();directory.root=await directoryIndex.remove(directory.root,create.id);await directoryIndex.flush(directory.root);data.set('pdf:directory',directory);
 const before=structuredClone([...data]);assert.deepEqual(await d.archive(),{items:[],next:null});assert.equal((await d.openArchived(create.id)).revision,saved.revision);assert.deepEqual([...data],before);assert.deepEqual(await d.verify(),{documents:0,editions:2});
 const restored=await d.change(command(create.id,saved.revision,'restore-document'));assert.notEqual(restored.revision,saved.revision);assert.equal((await d.open(create.id,{revision:saved.revision})).header.name,create.operation.header.name);assert.deepEqual(await d.verify(),{documents:1,editions:3});
});

test('PDF domain archive transitions roll back atomically while retained exports and unrelated objects remain readable',{timeout:120000},async t=>{
 const f=await fixture(t),documents=new PdfDocuments(f.storage,f.book.id),create=creation('Transactional report'),saved=await documents.change(create);
 const run=(write,operation)=>documents.domains.run(['pdf'],get=>operation(new PdfDocumentStore(get('pdf')),get('pdf')),{write:write?['pdf']:[]});
 await run(true,async(_,store)=>store.putObject('unrelated:pdf-asset',{bytes:'retained synthetic asset'}));
 const bytes=Buffer.from('%PDF-1.7\nSynthetic retained output\n'),jobs=new PdfExportJobs(documents,{prepare:async()=>({bytes,sha256:digest(bytes),renderer:{engine:'chromium',electron:'synthetic',chromium:'synthetic',recipeVersion:1},preflight:{version:1,status:'ok',findings:[],truncated:false}})}),jobId=randomUUID();
 await jobs.start({jobId,documentId:create.id,revision:saved.revision});assert.equal((await jobs.work(jobId)).state,'completed');
 const remove=command(create.id,saved.revision,'remove');
 await assert.rejects(run(true,async d=>{await d.change(remove);assert.equal((await d.archive()).items.length,1);throw new Error('rollback archive');}),/rollback archive/);
 assert.equal((await documents.read('open',{id:create.id})).revision,saved.revision);assert.equal((await run(false,d=>d.archive())).items.length,0);
 const archived=await documents.change(remove);assert.deepEqual((await jobs.download(jobId)).bytes,bytes);assert.equal((await jobs.status(jobId)).documentName,create.operation.header.name);
 const restore=command(create.id,archived.revision,'restore-document'),controller=new AbortController();
 await assert.rejects(run(true,async(d,store)=>{const put=store.putObject.bind(store);store.putObject=async(key,value)=>{await put(key,value);if(key==='pdf:archive')controller.abort();};await d.change(restore,{signal:controller.signal});}),{name:'AbortError'});
 assert.equal((await run(false,d=>d.openArchived(create.id))).revision,archived.revision);
 // Independent PDF lifecycle transactions do not wait for the research writer.
 const writer=await f.storage.openCatalogue();try{await writer.run('BEGIN');await writer.lock();const restored=await documents.change(restore);assert.notEqual(restored.revision,archived.revision);assert.equal((await documents.read('open',{id:create.id})).revision,restored.revision);}finally{await writer.run('ROLLBACK');await writer.close();}
 assert.deepEqual(await documents.change(restore),{revision:(await documents.read('open',{id:create.id})).revision,replayed:true});
 await run(false,async(d,store)=>{assert.deepEqual(await d.verify(),{documents:1,editions:3});assert.deepEqual(await store.object('unrelated:pdf-asset'),{bytes:'retained synthetic asset'});for await(const row of store.verifiedObjects())assert.ok(row.id);});
 assert.deepEqual((await jobs.download(jobId)).bytes,bytes);
});
