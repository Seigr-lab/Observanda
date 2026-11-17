import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {selectionBook} from './publication-selection-fixture.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {catalogueDescriptor} from '../src/research-catalogue.js';
import {RecordQueryDocuments} from '../src/record-query-documents.js';
import {digest,serialize} from '../src/storage-format.js';
import {recordRevision} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {buildPublication} from '../src/publication.js';
import {verifyPublicationCandidate} from '../src/retained-publication-files.js';
import {openPublicationInput} from '../src/publication-input-reader.js';
import {contentBuffer} from '../src/file-content.js';
import {publicationText} from './publication-fixture.js';
import {defaultEditionRecord} from '../src/web/publication-selection.js';
import {readPublicationRecord} from '../src/publication-input.js';

async function fixture(t,count,configure=()=>{}){const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-edition-selection-')),data=selectionBook(count);configure(data.book);const f=await encryptedFixture(directory,data.book);t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true});});const releases=new PublicationJobs(f.workspace),{etag,websitePin}=await releases.workspace.outline();return {...data,...f,releases,source:{workspaceId:data.book.id,etag,websitePin}};}

test('edition choices exclude writing, sections, charts, attachments and CSV before all output surfaces without changing originals',async t=>{
 const f=await fixture(t),media=new MediaStore(f.workspace.root,f.vault),asset=await media.import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>'),'image'),before=await f.workspace.read();
 before.book.entries[0].attachments=[{id:asset.id,kind:'image',caption:'WITHHELD_ATTACHMENT',alt:'Image',transcript:'WITHHELD_TRANSCRIPT',share:true}];await f.workspace.save(before.book,before.etag);
 const saved=await f.workspace.read(),record=saved.book.entries[0],source={...await f.releases.workspace.outline(),workspaceId:saved.book.id};
 const choice=defaultEditionRecord(record,recordRevision(record));choice.body=false;choice.sections=[record.sections[0].id];choice.attachments=[];choice.fields=['public'];
 const edition={version:1,records:[choice]},candidate=await f.releases.inline({...source,edition}),text=await publicationText(candidate);
 for(const value of ['WITHHELD_',record.sections[1].id,asset.id,f.secret.id,'C:/Users/private',f.workspace.root])assert.ok(!text.includes(value),value);
 assert.ok(text.includes('Public steps'));assert.ok((await Array.fromAsync(candidate.files.keys())).some(p=>p.endsWith('.svg')));assert.ok(!(await Array.fromAsync(candidate.files.keys())).some(p=>p.endsWith('.csv')));assert.ok(!text.includes('View the data'));
 assert.equal(candidate.researchReview.references.count,1);assert.equal((await (await openPublicationInput(f.releases.workspace,await f.releases.source(candidate.jobId))).get('records',record.id)).revision,recordRevision(record));
 assert.deepEqual(await f.workspace.read(),saved);assert.ok(text.includes('9007199254740993'));await verifyPublicationCandidate(candidate);
 const direct=buildPublication({...source.metadata,entries:saved.book.entries},{edition});for(const [name,value] of direct.files)if(!['styles.css','publication.json'].includes(name))assert.deepEqual(await contentBuffer(await candidate.files.get(name)),await contentBuffer(value),name);
 const downloads=structuredClone(edition);downloads.records[0].figures[0].data=true;
 const withData=await f.releases.inline({...source,edition:downloads});assert.ok((await Array.fromAsync(withData.files.keys())).some(p=>p.endsWith('.csv')));assert.match(await publicationText(withData),/View the data/);
 const withoutChart=structuredClone(edition);withoutChart.records[0].figures=[];
 const without=await f.releases.inline({...source,edition:withoutChart});assert.ok(!(await Array.fromAsync(without.files.keys())).some(p=>p.startsWith('figures/')));assert.ok(!(await publicationText(without)).includes(record.figures[0].title));assert.deepEqual(await f.workspace.read(),saved);
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
   change(value,args[0]);const revision=digest(serialize(value)),next=kind+':'+args[0].id+':'+revision;
   await this.store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT DO NOTHING',next,this.store.encode('state',next,value));references[key]=revision;
  }
  return references;
 };
 try{return await run();}finally{RecordQueryDocuments.prototype.retain=retain;}
}

test('catalogue verification rejects internally rehashed inventory labels that disagree with the original',async t=>{
 const f=await fixture(t),saved=await f.workspace.read();saved.book.entries[0].title='Amended title';
 await withInventory(value=>{value.editionInventory.title='Incorrect cached label';},()=>f.workspace.save(saved.book,saved.etag));
 await assert.rejects(f.workspace.catalogue(store=>store.verify(catalogueDescriptor(f.book))),{code:'CATALOGUE_DAMAGED'});
});

test('edition choices reject stale revisions, unselected records, duplicate identities and forged section/data consent',async t=>{
 const f=await fixture(t),choice=defaultEditionRecord(f.record,recordRevision(f.record));
 for(const [change,code] of [[{revision:'0'.repeat(64)},'RECORD_CHANGED'],[{sections:[randomUUID()]},'INVALID'],[{id:f.secret.id},'RECORD_CHANGED'],[{figures:[{id:randomUUID(),data:true}]},'INVALID'],[{body:'yes'},'INVALID'],[{extra:'ignored'},'INVALID']])await assert.rejects(f.releases.inline({...f.source,edition:{version:1,records:[{...choice,...change}]}}),{code});
 await assert.rejects(f.releases.inline({...f.source,edition:{version:1,records:[choice,choice]}}),{code:'INVALID'});
 assert.equal((await f.workspace.outline()).etag,f.source.etag);
});

test('unsaved public selection keeps the original research revision and exact links to a newly included record',async t=>{
 const f=await fixture(t),current=await f.workspace.read(),[run,other,method]=current.book.entries;
 Object.assign(method,{title:'Newly selected method',body:'Original method text',share:true});Object.assign(run,{body:'A run using an exact method',sections:[]});other.body='Other public record';
 await f.workspace.save(current.book,current.etag);const linked=await f.workspace.read(),methodRevision=recordRevision(linked.book.entries.find(r=>r.id===method.id));
 linked.book.entries.find(r=>r.id===run.id).relations=[{id:randomUUID(),type:'Uses method',target:{workspaceId:current.book.id,kind:'record',id:method.id,revision:methodRevision},label:method.title}];
 await f.workspace.save(linked.book,linked.etag);const saved=await f.workspace.read(),source={...await f.releases.workspace.outline(),draft:{workspaceId:saved.book.id,baseEtag:saved.etag,metadata:{},projects:[],changes:[],removed:[],selection:{includeProjects:[],records:[{id:method.id,share:true,attachments:[]}]}}};
 const choice=defaultEditionRecord(saved.book.entries.find(r=>r.id===method.id),methodRevision);
 assert.equal(choice.revision,methodRevision);const candidate=await f.releases.inline({...source,edition:{version:1,records:[choice]}});
 assert.equal((await (await openPublicationInput(f.releases.workspace,await f.releases.source(candidate.jobId))).get('records',method.id)).revision,methodRevision);assert.equal(candidate.researchReview.references.count,0);
 const html=(await contentBuffer(await candidate.files.get('entries/'+run.id+'.html'))).toString();assert.ok(html.includes('entries/'+method.id+'.html'));assert.ok(html.includes('Newly selected method'));
 const pinned=await f.releases.source(candidate.jobId),row=await (await openPublicationInput(f.releases.workspace,pinned)).get('records',method.id);assert.equal((await readPublicationRecord(f.workspace,pinned,row)).share,true);assert.equal(row.selection.include,true);assert.deepEqual(await f.workspace.read(),saved);
});


