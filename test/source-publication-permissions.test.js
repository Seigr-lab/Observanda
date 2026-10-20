import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {selectionBook} from './publication-selection-fixture.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {RecordWriting} from '../src/record-writing.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {publicationSelection} from '../src/publication-selection.js';
import {defaultEditionRecord,selectEditionRecord} from '../src/web/publication-selection.js';
import {websiteRecordShare} from '../src/web/website-selection.js';
import {recordRevision} from '../src/research.js';
import {buildPublication} from '../src/publication.js';
import {publicationText} from './publication-fixture.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace,workspaceFile,atomicWrite} from '../src/storage.js';
import {exactPublicationRecord} from '../src/publication-revisions.js';
import {MediaStore} from '../src/media.js';
import {serialize} from '../src/storage-format.js';
import {websitePreviewSource} from '../src/website-preview-source.js';
import {catalogueFormat,catalogueRequiresSourcePublicationControls,catalogueRequiresWebsiteSourceSelections,requireSourcePublicationControls,requireWebsiteSourceSelections} from '../src/catalogue-format.js';
import {rekeyCatalogue,verifyCatalogueArchive} from '../src/research-catalogue.js';
import {backupCatalogue,CATALOGUE_ARCHIVE} from '../src/postgres.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-source-permissions-')),data=selectionBook();
 // Keep this test focused on the source permissions, without a deliberate link
 // to the withheld section (that belongs to publication reference validation).
 data.other.body='Another allowed observation.';data.record.sections[1].body='An initially allowed procedure.';
 const f=await encryptedFixture(directory,data.book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...data,...f,directory};
}

test('website and edition choices cannot authorize source-private records or writing sections',()=>{
 const {record,secret}=selectionBook();
 const selection={includeProjects:[],defaultShare:true,records:[{id:secret.id,share:true,attachments:[]}]};
 assert.equal(websiteRecordShare(selection,secret),false);
 record.sections[1].share=false;
 const choice=defaultEditionRecord(record,recordRevision(record));
 assert.deepEqual(choice.sections,[record.sections[0].id]);
 choice.sections.push(record.sections[1].id);
 assert.deepEqual(selectEditionRecord(record,choice).sections.map(s=>s.id),[record.sections[0].id]);
 assert.equal(selectEditionRecord(secret,{...defaultEditionRecord(secret,recordRevision(secret)),include:true}).share,false);
});

test('section permission saves with its source revision and bounds inventory, preview, export and portable reopening',async t=>{
 const f=await fixture(t),writing=new RecordWriting(f.workspace),target={workspaceId:f.book.id,recordId:f.record.id,sectionId:f.record.sections[1].id};
 const before=await writing.read(target);
 await writing.save({...target,expectedRevision:before.revision,value:{...before.value,share:false}});
 assert.deepEqual((await writing.read(target)).value,{...before.value,share:false});
 const saved=await f.workspace.read(),record=saved.book.entries.find(r=>r.id===f.record.id),jobs=new PublicationJobs(f.workspace),source={...await jobs.workspace.outline(),workspaceId:f.book.id};
 const item=(await publicationSelection(f.workspace,{source})).items.find(r=>r.id===record.id);
 assert.ok(!item.sections.some(s=>s.id===target.sectionId));
 const candidate=await jobs.inline(source),output=await publicationText(candidate);
 assert.ok(!output.includes('WITHHELD_SECTION_TITLE'));
 assert.ok(!output.includes(target.sectionId));assert.ok(output.includes('Public steps for the method.'));
 const direct=await publicationText(buildPublication(saved.book));
 assert.ok(!direct.includes('WITHHELD_SECTION_TITLE'));assert.ok(!direct.includes(target.sectionId));
 const destination=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'Portable copy')),{vault:f.vault});
 const restored=new Workspace(destination,f.vault),copied=await new RecordWriting(restored).read(target);
 assert.deepEqual(copied.value,{...before.value,share:false});
 assert.deepEqual(await f.workspace.read(),saved);
});

test('a private lab book excludes its records even when a website selects its project',async t=>{
 const f=await fixture(t),saved=await f.workspace.read(),notebook=saved.book.notebooks.find(n=>n.id===f.record.notebookId);
 notebook.share=false;await f.workspace.save(saved.book,saved.etag);
 const jobs=new PublicationJobs(f.workspace),source={...await jobs.workspace.outline(),workspaceId:f.book.id};
 const inventory=await publicationSelection(f.workspace,{source});
 assert.ok(!inventory.items.some(r=>r.id===f.record.id));
 const candidate=await jobs.inline(source),output=await publicationText(candidate);
 assert.ok(!output.includes(f.record.title));assert.ok(!output.includes(f.record.id));
});


test('prepared editions survive text edits but source withdrawal blocks preview, export and historical reuse',async t=>{
 const f=await fixture(t),jobs=new PublicationJobs(f.workspace),source={...await jobs.workspace.outline(),workspaceId:f.book.id};
 const before=await f.workspace.read(),record=before.book.entries.find(row=>row.id===f.record.id),revision=recordRevision(record);
 const candidate=await jobs.inline(source),prepared=await jobs.read(candidate.reviewId);
 const edited=await f.workspace.read();edited.book.entries.find(row=>row.id===record.id).body='An ordinary later text edit.';await f.workspace.save(edited.book,edited.etag);
 assert.equal((await jobs.read(candidate.reviewId)).id,prepared.id);
 const privateWriting=await f.workspace.read();privateWriting.book.entries.find(row=>row.id===record.id).sections[1].share=false;await f.workspace.save(privateWriting.book,privateWriting.etag);
 await assert.rejects(jobs.read(candidate.reviewId),{code:'PUBLICATION_PERMISSIONS_CHANGED'});
 await assert.rejects(jobs.assertSourcePermissions(prepared),{code:'PUBLICATION_PERMISSIONS_CHANGED'});
 await jobs.verifyFiles(candidate.reviewId);
 const historical=await exactPublicationRecord(f.workspace,{workspaceId:f.book.id,kind:'record',id:record.id,revision});
 assert.equal(historical.sections[1].share,false);assert.equal(selectEditionRecord(historical).sections.length,1);
 const withdrawn=await f.workspace.read();withdrawn.book.entries.find(row=>row.id===record.id).share=false;await f.workspace.save(withdrawn.book,withdrawn.etag);
 await assert.rejects(exactPublicationRecord(f.workspace,{workspaceId:f.book.id,kind:'record',id:record.id,revision}),{code:'MATERIAL_MISSING'});
});

test('withdrawing attachment permission blocks an already prepared edition and older candidate markers require preparation',async t=>{
 const f=await fixture(t),media=new MediaStore(f.workspace.root,f.vault),asset=await media.import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle cx="4" cy="4" r="3"/></svg>'),'image');
 const before=await f.workspace.read();before.book.entries[0].attachments=[{id:asset.id,kind:'image',caption:'Selected evidence',alt:'Circle',transcript:'',share:true}];await f.workspace.save(before.book,before.etag);
 const jobs=new PublicationJobs(f.workspace),candidate=await jobs.inline({...await jobs.workspace.outline(),workspaceId:f.book.id}),saved=await f.workspace.read();
 saved.book.entries[0].attachments[0].share=false;await f.workspace.save(saved.book,saved.etag);
 await assert.rejects(jobs.read(candidate.reviewId),{code:'PUBLICATION_PERMISSIONS_CHANGED'});
 const stored=await jobs.stored(candidate.reviewId);delete stored.sourcePermissionVersion;
 await jobs.workspace.withLock(()=>jobs.workspace.writeMetadata('.observanda/release-candidates/'+candidate.reviewId+'.json',serialize(stored)));
 await assert.rejects(jobs.read(candidate.reviewId),{code:'PUBLICATION_PERMISSIONS_CHANGED'});await jobs.verifyFiles(candidate.reviewId);
});


test('native website drafts omit source-private writing and an old tab cannot restore withdrawn content',async t=>{
 const f=await fixture(t),jobs=new PublicationJobs(f.workspace),old=await jobs.workspace.outline();
 const command=outline=>({workspaceId:f.book.id,baseEtag:outline.etag,metadata:{},projects:[],changes:[],removed:[]});
 const target='entry:'+f.record.id,preview=await websitePreviewSource(f.workspace,command(old),{websitePin:old.websitePin,designTarget:target});
 assert.ok(JSON.stringify(preview.context).includes(f.record.sections[1].title));
 const current=await f.workspace.read();current.book.entries.find(row=>row.id===f.record.id).sections[1].share=false;await f.workspace.save(current.book,current.etag);
 await assert.rejects(websitePreviewSource(f.workspace,command(old),{websitePin:old.websitePin,designTarget:target}),{code:'PUBLICATION_PERMISSIONS_CHANGED'});
 const latest=await jobs.workspace.outline(),allowed=await websitePreviewSource(f.workspace,command(latest),{websitePin:latest.websitePin,designTarget:target}),text=JSON.stringify(allowed.context);
 assert.ok(!text.includes(f.record.sections[1].title));assert.ok(!text.includes(f.record.sections[1].id));
 assert.ok(text.includes('Public steps for the method.'));
 await assert.rejects(websitePreviewSource(f.workspace,command(latest),{websitePin:latest.websitePin,designTarget:'entry:'+f.secret.id}),{code:'INVALID'});
});


test('paged website source admission rolls back atomically and survives portable copies, archived reopening and fresh-key recovery',{timeout:180000},async t=>{
 const f=await fixture(t),format=workspace=>workspace.catalogue(store=>catalogueFormat(store.db)),before=await format(f.workspace),failure=Error('Rollback source-choice admission');
 await assert.rejects(f.workspace.withLock(()=>f.workspace.catalogue(async store=>{await requireWebsiteSourceSelections(store.db);throw failure;})),error=>error===failure);
 assert.equal(await format(f.workspace),before);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{await requireSourcePublicationControls(store.db);await requireWebsiteSourceSelections(store.db);}));
 const generation=await format(f.workspace),expected=await f.workspace.read(),descriptorText=await f.workspace.readFile(await workspaceFile(f.workspace.root),'utf8'),descriptor=JSON.parse(descriptorText);
 async function check(workspace){
  const current=await format(workspace);assert.equal(current,generation);assert.equal(catalogueRequiresSourcePublicationControls(current),true);assert.equal(catalogueRequiresWebsiteSourceSelections(current),true);
  assert.deepEqual(await workspace.read(),expected);await verifyCatalogueArchive(workspace,descriptor);
 }
 await check(new Workspace(f.workspace.root,f.vault));
 const copied=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'Portable source choices')),{vault:f.vault});await check(new Workspace(copied,f.vault));
 async function archive(name){
  const root=path.join(f.directory,name);await mkdir(path.join(root,'.observanda'),{recursive:true});
  for(const file of [path.basename(await workspaceFile(f.workspace.root)),'.observanda/access.json'])await copyFile(path.join(f.workspace.root,file),path.join(root,file));
  const db=await f.workspace.openCatalogue();try{await backupCatalogue(f.workspace.root,root,{connection:db});}finally{await db.close();}
  const header=JSON.parse((await readFile(path.join(root,CATALOGUE_ARCHIVE),'utf8')).split('\n')[0]);assert.equal(header.catalogueVersion,generation);
  return new Workspace(root,f.vault);
 }
 await check(await archive('Archived source choices'));
 async function rekey(source,name){
  const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(f.directory,name+'-device')})),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
  const destination=new Workspace(path.join(f.directory,name),vault);await mkdir(path.join(destination.root,'.observanda'),{recursive:true});
  await atomicWrite(path.join(destination.root,'.observanda/access.json'),serialize(access));await destination.writeFile(await workspaceFile(destination.root,{secure:true}),descriptorText);
  await rekeyCatalogue(source,destination,descriptor);await check(destination);
 }
 await rekey(f.workspace,'Recovered live source choices');await rekey(await archive('Source choices for recovery'),'Recovered archived source choices');
});
