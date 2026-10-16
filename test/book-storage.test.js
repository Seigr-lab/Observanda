import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {journeyBook,block} from './book-fixture.js';
import {researchReference} from '../src/web/research-reference.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {buildPublication} from '../src/publication.js';
import {contentBuffer} from '../src/file-content.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {populateImageEvidence} from './image-evidence-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {bookSelectors,selectorExists} from '../src/web/book-selectors.js';
import {copyWorkspace,copyPlan} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {migrationFixture} from './migration-fixture.js';
import {inventorySource} from '../src/migration/inventory.js';
import {MigrationImport} from '../src/migration/import-service.js';
import {renderRichText} from '../src/web/rich-text-model.js';
import {assertPublicFields} from '../src/privacy.js';

test('content selectors survive rename, reorder, retained archive and encrypted backup',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-archive-')),f=journeyBook(),storage=await encryptedFixture(directory,f.book),materials=new ResearchMaterials(storage.workspace),records=new ResearchRecords(storage.workspace,{});
 t.after(async()=>{clearVault(storage.vault);await rm(directory,{recursive:true,force:true,maxRetries:4,retryDelay:100});});
 const selector={version:1,kind:'table',id:f.table.attrs.id},old=await storage.workspace.withLock(()=>materials.retainRecord(f.concept)),changed=structuredClone(f.concept);changed.title='Changed definition';changed.body.content.reverse();changed.body.content.find(n=>n.type==='book_table').attrs.title='Changed table heading';
 await records.save({workspaceId:f.book.id,changes:[{id:changed.id,expectedRevision:recordRevision(f.concept),record:changed}]});
 assert.ok(selectorExists(changed,selector));assert.ok(selectorExists(await materials.read(old),selector));assert.equal(bookSelectors(changed).find(s=>s.id===selector.id).label,'Changed table heading');
 const saved=(await storage.workspace.read()).book.entries.find(r=>r.id===changed.id);await records.remove({workspaceId:f.book.id,recordId:changed.id,expectedRevision:recordRevision(saved)});
 assert.ok(!(await storage.workspace.read()).book.entries.some(r=>r.id===changed.id));assert.deepEqual(await materials.read(old),f.concept);
 const copy=await copyWorkspace(await copyPlan(storage.workspace.root,path.join(directory,'archive')),{vault:storage.vault}),restored=new ResearchMaterials(new Workspace(copy,storage.vault));assert.deepEqual(await restored.read(old),f.concept);assert.ok(selectorExists(await restored.read(old),selector));
 assert.doesNotThrow(()=>assertPublicFields([{field:'equation',value:f.concept.body}]));
 for(const privateText of [String.raw`\\server\private\capture`,String.raw`C:\private\source`, 'github_pat_'+ 'a'.repeat(30)])assert.throws(()=>assertPublicFields([{field:'source',value:{nested:[privateText]}}]),{code:'PRIVACY'});
});

test('book import requires preservation review and commits source mappings with authenticated original bytes',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-import-')),source=path.join(directory,'source'),f=journeyBook(),storage=await encryptedFixture(directory,f.book);
 t.after(async()=>{clearVault(storage.vault);await rm(directory,{recursive:true,force:true,maxRetries:4,retryDelay:100});});
 const declared=await migrationFixture(source,{creative:true}),html='<section id="chapter"><h2>\u00c9vidence</h2><p>Original meaning</p><pre><code class="language-native">  EMIT 105\n\tJOIN 0001  \n</code></pre><table><caption>Readings</caption><tr><th>Code</th><th>Value</th></tr><tr><td>005</td><td>9007199254740993</td></tr></table><svg><path d="M1 2"/></svg></section>',bytes=Buffer.from(html),file={path:'chapter.html',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),selector:{kind:'anchor',value:'chapter'}};
 await writeFile(path.join(source,file.path),bytes);declared.manifest.objects.push({...structuredClone(declared.manifest.objects[0]),id:'chapter',title:'Authored book chapter',kind:'record',mapping:{kind:'record'},files:[file],links:[]});await writeFile(path.join(source,'inventory.observanda-source.json'),JSON.stringify(declared.manifest));
 const report=await inventorySource({source}),service=new MigrationImport(storage.workspace),command={workspaceId:f.book.id,id:randomUUID()};let batch=await service.create({...command,source,expectedPin:report.source.pin,notebookId:f.concept.notebookId});while(batch.state==='staging')batch=await service.stage(command);
 let row=await service.detail({...command,index:4});batch=await service.mapping({...command,index:4,edit:batch.edit,mapping:{...row.mapping,contentMode:'html-book'}});
 const review=async()=>{batch=await service.beginReview({...command,edit:batch.edit});while(batch.state==='reviewing')batch=await service.review(command);};await review();row=await service.detail({...command,index:4});assert.equal(row.problem.code,'IMPORT_CONVERSION');assert.equal(batch.state,'mapping');
 batch=await service.mapping({...command,index:4,edit:batch.edit,mapping:{...row.mapping,acknowledgeConversion:true}});await review();assert.equal(batch.state,'ready');await service.commit({...command,review:batch.review});
 row=await service.detail({...command,index:4});const record=(await storage.workspace.read()).book.entries.find(r=>r.title==='Authored book chapter');assert.equal(record.share,false);assert.equal(record.body.type,'doc');assert.equal(record.body.content[2].content[0].text,'  EMIT 105\n\tJOIN 0001  \n');assert.equal(record.body.content[3].attrs.rows[0][1],'9007199254740993');assert.ok(!renderRichText(record.body).includes('<svg>'));
 const provenance=await service.provenance({workspaceId:f.book.id,recordId:record.id}),conversion=provenance.items[0].conversion;assert.equal(conversion.kind,'html-book-v1');assert.deepEqual(conversion.mappings,row.prepared.conversion.mappings);
 const retained=await service.store.original(file.sha256),original=[];for await(const part of retained.read())original.push(part);assert.deepEqual(Buffer.concat(original),bytes);assert.ok(!(await readFile(retained.file)).includes(Buffer.from('Original meaning')));
 for(const m of conversion.mappings){const fragment=bytes.subarray(m.offset,m.offset+m.length).toString('utf8');assert.ok(fragment.startsWith('<'));if(m.kind==='table')assert.ok(fragment.includes('9007199254740993'));if(m.kind==='preserved')assert.equal(fragment,'<svg><path d="M1 2"/></svg>');}
});

test('retained card excerpts and book pages share public reference and inline figure admission',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-public-')),f=journeyBook(),privateImage=randomUUID();
 f.concept.attachments=[{id:privateImage,kind:'image',caption:'PRIVATE diagram caption',alt:'PRIVATE image description',transcript:'Private steps',share:false}];
 const linked=record=>({type:'text',text:record.title,marks:[{type:'link',attrs:{href:researchReference({workspaceId:f.book.id,kind:'record',id:record.id}),title:'',target:'_self',nofollow:false}}]});
 f.concept.body.content.unshift(block('figure',{figureId:privateImage,alternative:'PRIVATE inline diagram narrative'}),{type:'paragraph',content:[linked(f.privateRecord),{type:'text',text:' then '},linked(f.method)]});
 const storage=await encryptedFixture(directory,f.book,{populate:workspace=>populateImageEvidence(workspace,[privateImage])});t.after(async()=>{clearVault(storage.vault);await rm(directory,{recursive:true,force:true,maxRetries:4,retryDelay:100});});
 const snapshot=await storage.workspace.outline(),actual=await new PublicationJobs(storage.workspace).inline({workspaceId:f.book.id,etag:snapshot.etag}),expected=buildPublication(f.book);
 for(const [name,value] of actual.files)if(name.endsWith('.html')){
  const html=(await contentBuffer(value)).toString('utf8');assert.ok(!html.includes('PRIVATE'));assert.ok(!html.includes(privateImage));assert.ok(!html.includes(f.privateRecord.id));assert.equal(html,expected.files.get(name),name);
 }
 const project=(await contentBuffer(actual.files.get('projects/'+f.book.projects[0].id+'.html'))).toString('utf8');assert.ok(project.includes(f.method.title));
});
