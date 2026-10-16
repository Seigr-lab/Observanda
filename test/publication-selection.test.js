import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {selectionBook} from './publication-selection-fixture.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {publicationSelection} from '../src/publication-selection.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {ResearchCatalogue,catalogueDescriptor} from '../src/research-catalogue.js';
import {RecordQueryDocuments} from '../src/record-query-documents.js';
import {digest,serialize} from '../src/storage-format.js';
import {recordEditionInventory} from '../src/web/publication-inventory.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {recordRevision} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {buildPublication,verifyPublication} from '../src/publication.js';
import {contentBuffer} from '../src/file-content.js';
import {publicationText} from './publication-fixture.js';
import {defaultEditionRecord} from '../src/web/publication-selection.js';
import {readPublicationRecord} from '../src/publication-input.js';

async function fixture(t,count){const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-edition-selection-')),data=selectionBook(count),f=await encryptedFixture(directory,data.book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});return {...data,...f,releases:new PublicationJobs(f.workspace),source:{workspaceId:data.book.id,etag:(await f.workspace.outline()).etag}};}

test('edition choices exclude writing, sections, charts, attachments and CSV before all output surfaces without changing originals',async t=>{
 const f=await fixture(t),media=new MediaStore(f.workspace.root,f.vault),asset=await media.import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>'),'image'),before=await f.workspace.read();
 before.book.entries[0].attachments=[{id:asset.id,kind:'image',caption:'WITHHELD_ATTACHMENT',alt:'Image',transcript:'WITHHELD_TRANSCRIPT',share:true}];await f.workspace.save(before.book,before.etag);
 const saved=await f.workspace.read(),record=saved.book.entries[0],source={etag:saved.etag,workspaceId:saved.book.id};
 const choice=defaultEditionRecord(record,recordRevision(record));choice.body=false;choice.sections=[record.sections[0].id];choice.attachments=[];choice.fields=['public'];
 const edition={version:1,records:[choice]},candidate=await f.releases.inline({...source,edition}),text=await publicationText(candidate);
 for(const value of ['WITHHELD_',record.sections[1].id,asset.id,f.secret.id,'C:/Users/private',f.workspace.root])assert.ok(!text.includes(value),value);
 assert.ok(text.includes('Public steps'));assert.ok([...candidate.files.keys()].some(p=>p.endsWith('.svg')));assert.ok(![...candidate.files.keys()].some(p=>p.endsWith('.csv')));assert.ok(!text.includes('View the data'));
 assert.equal(candidate.researchReview.references.count,1);assert.deepEqual(candidate.sourceRevisions[record.id],recordRevision(record));
 assert.deepEqual(await f.workspace.read(),saved);assert.ok(text.includes('9007199254740993'));verifyPublication(candidate);
 const direct=buildPublication(saved.book,{edition});for(const [name,value] of direct.files)if(!['styles.css','publication.json'].includes(name))assert.deepEqual(await contentBuffer(candidate.files.get(name)),await contentBuffer(value),name);
 const downloads=structuredClone(edition);downloads.records[0].figures[0].data=true;
 const withData=await f.releases.inline({...source,edition:downloads});assert.ok([...withData.files.keys()].some(p=>p.endsWith('.csv')));assert.match(await publicationText(withData),/View the data/);
 const withoutChart=structuredClone(edition);withoutChart.records[0].figures=[];
 const without=await f.releases.inline({...source,edition:withoutChart});assert.ok(![...without.files.keys()].some(p=>p.startsWith('figures/')));assert.ok(!(await publicationText(without)).includes(record.figures[0].title));assert.deepEqual(await f.workspace.read(),saved);
});

test('publication inventories use authenticated labels without loading private prose or figure values',async t=>{
 const f=await fixture(t,43),read=ResearchCatalogue.prototype.read,record=ResearchCatalogue.prototype.record,loaded=[];
 ResearchCatalogue.prototype.read=()=>{throw Error('Whole workspace loaded');};ResearchCatalogue.prototype.record=function(id,...args){assert.notEqual(id,f.secret.id);loaded.push(id);return record.call(this,id,...args);};
 try{
  const first=await publicationSelection(f.workspace,{source:f.source});assert.equal(first.items.length,20);assert.equal(first.next,20);assert.equal(loaded.length,0);
  assert.deepEqual(first.items[0],{...recordEditionInventory(f.record,recordRevision(f.record)),notebook:f.book.notebooks.find(n=>n.id===f.record.notebookId).title});
  loaded.length=0;const last=await publicationSelection(f.workspace,{source:f.source,offset:40});assert.equal(last.items.length,3);assert.equal(last.next,null);assert.equal(loaded.length,0);
  const json=JSON.stringify(first);for(const secret of ['WITHHELD_MAIN_WRITING','C:/Users/private','WITHHELD_RECORD_', '"points"'])assert.ok(!json.includes(secret));assert.equal(first.items[0].choice.figures[0].data,false);
 }finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record=record;}
});

async function withInventory(change,run){
 const retain=RecordQueryDocuments.prototype.retain;
 RecordQueryDocuments.prototype.retain=async function(...args){
  const references=await retain.apply(this,args);
  for(const [key,kind] of [['queryRevision','record-query'],['summaryRevision','record-summary']]){
   const slot=kind+':'+args[0].id+':'+references[key],value=this.store.decode('state',slot,(await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot)).payload);
   // Browse summaries deliberately omit inventory details; mutate the retained
   // inventory envelope only, leaving unrelated summary references intact.
   if(!Object.hasOwn(value,'editionInventory'))continue;
   change(value);const revision=digest(serialize(value)),next=kind+':'+args[0].id+':'+revision;
   await this.store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT DO NOTHING',next,this.store.encode('state',next,value));references[key]=revision;
  }
  return references;
 };
 try{return await run();}finally{RecordQueryDocuments.prototype.retain=retain;}
}

test('older inventory summaries load only the selected page and remain verifiable through portable recovery',async t=>{
 const f=await withInventory(value=>delete value.editionInventory,()=>fixture(t,43)),record=ResearchCatalogue.prototype.record,loaded=[];
 ResearchCatalogue.prototype.record=function(id,...args){assert.notEqual(id,f.secret.id);loaded.push(id);return record.call(this,id,...args);};
 try{
  const last=await publicationSelection(f.workspace,{source:f.source,offset:40});assert.equal(last.items.length,3);assert.equal(loaded.length,3);
  assert.deepEqual(last.items.map(item=>item.id),f.book.entries.filter(r=>r.share).slice(40).map(r=>r.id));
 }finally{ResearchCatalogue.prototype.record=record;}
 const before=await f.workspace.outline(),backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(path.dirname(f.workspace.root),'backup')),{vault:f.vault});
 assert.equal((await f.workspace.outline()).etag,before.etag);
 const restored=new Workspace(backup,f.vault),items=await publicationSelection(restored,{source:f.source});
 assert.deepEqual(items.items[0].choice,defaultEditionRecord(f.record,recordRevision(f.record)));
});

test('catalogue verification rejects internally rehashed inventory labels that disagree with the original',async t=>{
 const f=await fixture(t),saved=await f.workspace.read();saved.book.entries[0].title='Amended title';
 await withInventory(value=>{value.editionInventory.title='Incorrect cached label';},()=>f.workspace.save(saved.book,saved.etag));
 await assert.rejects(f.workspace.catalogue(store=>store.verify(catalogueDescriptor(f.book))),{code:'CATALOGUE_DAMAGED'});
});

test('inventory attachment defaults follow unsaved consent without changing the original revision',async t=>{
 const f=await fixture(t),media=new MediaStore(f.workspace.root,f.vault),asset=await media.import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle cx="4" cy="4" r="3"/></svg>'),'image'),before=await f.workspace.read();
 before.book.entries[0].attachments=[{id:asset.id,kind:'image',caption:'Private original image',alt:'Circle',transcript:'',share:false}];await f.workspace.save(before.book,before.etag);
 const saved=await f.workspace.read(),record=saved.book.entries[0],draft={workspaceId:saved.book.id,baseEtag:saved.etag,metadata:{},projects:[],changes:[],removed:[],selection:{includeProjects:[],records:[{id:record.id,share:true,attachments:[{id:asset.id,share:true}]}]}},source={etag:saved.etag,draft};
 const original=ResearchCatalogue.prototype.record;ResearchCatalogue.prototype.record=()=>{throw Error('Original requested by inventory');};
 try{
  const included=(await publicationSelection(f.workspace,{source})).items[0];assert.deepEqual(included.choice.attachments,[asset.id]);assert.equal(included.choice.revision,recordRevision(record));assert.equal(included.attachments[0].title,'Private original image');
  draft.selection.records[0].attachments[0].share=false;
  assert.deepEqual((await publicationSelection(f.workspace,{source})).items[0].choice.attachments,[]);
 }finally{ResearchCatalogue.prototype.record=original;}
 assert.deepEqual(await f.workspace.read(),saved);
});

test('edition choices reject stale revisions, unselected records, duplicate identities and forged section/data consent',async t=>{
 const f=await fixture(t),choice=(await publicationSelection(f.workspace,{source:f.source})).items[0].choice;
 for(const [change,code] of [[{revision:'0'.repeat(64)},'RECORD_CHANGED'],[{sections:[randomUUID()]},'INVALID'],[{id:f.secret.id},'RECORD_CHANGED'],[{figures:[{id:randomUUID(),data:true}]},'INVALID'],[{body:'yes'},'INVALID'],[{extra:'ignored'},'INVALID']])await assert.rejects(f.releases.inline({...f.source,edition:{version:1,records:[{...choice,...change}]}}),{code});
 await assert.rejects(f.releases.inline({...f.source,edition:{version:1,records:[choice,choice]}}),{code:'INVALID'});
 await assert.rejects(publicationSelection(f.workspace,{source:{...f.source,etag:'0'.repeat(64)}}),{code:'CONFLICT'});
 await assert.rejects(publicationSelection(f.workspace,{source:f.source,offset:-1}),{code:'INVALID'});
 assert.equal((await f.workspace.outline()).etag,f.source.etag);
});

test('unsaved public selection keeps the original research revision and exact links to a newly included record',async t=>{
 const f=await fixture(t),current=await f.workspace.read(),[run,other,method]=current.book.entries;
 Object.assign(method,{title:'Newly selected method',body:'Original method text'});Object.assign(run,{body:'A run using an exact method',sections:[]});other.body='Other public record';
 await f.workspace.save(current.book,current.etag);const linked=await f.workspace.read(),methodRevision=recordRevision(linked.book.entries.find(r=>r.id===method.id));
 linked.book.entries.find(r=>r.id===run.id).relations=[{id:randomUUID(),type:'Uses method',target:{workspaceId:current.book.id,kind:'record',id:method.id,revision:methodRevision},label:method.title}];
 await f.workspace.save(linked.book,linked.etag);const saved=await f.workspace.read(),source={etag:saved.etag,draft:{workspaceId:saved.book.id,baseEtag:saved.etag,metadata:{},projects:[],changes:[],removed:[],selection:{includeProjects:[],records:[{id:method.id,share:true,attachments:[]}]}}};
 const inventory=await publicationSelection(f.workspace,{source}),choice=inventory.items.find(i=>i.id===method.id).choice;
 assert.equal(choice.revision,methodRevision);const candidate=await f.releases.inline({...source,edition:{version:1,records:[choice]}});
 assert.equal(candidate.sourceRevisions[method.id],methodRevision);assert.equal(candidate.researchReview.references.count,0);
 const html=(await contentBuffer(candidate.files.get('entries/'+run.id+'.html'))).toString();assert.ok(html.includes('entries/'+method.id+'.html'));assert.ok(html.includes('Newly selected method'));
 const pinned=await f.releases.source(candidate.jobId),row=pinned.records.find(r=>r.id===method.id);assert.equal((await readPublicationRecord(f.workspace,pinned,row)).share,false);assert.equal(row.selection.include,true);assert.deepEqual(await f.workspace.read(),saved);
});
