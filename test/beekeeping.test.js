import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {beekeepingFixture} from './beekeeping-fixture.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {validateNotebook} from '../src/model.js';
import {enabledLabBookTypes,labBookTypeModules,validLabBookTypeSelection} from '../src/web/feature-modules.js';
import {activityContext,activityTemplates,documentRecord} from '../src/web/record-activity.js';
import {templateFrom} from '../src/web/notebook-schema.js';
import {RecordQuery} from '../src/record-query.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {recordBrowse,recordQueryDocument} from '../src/web/record-query.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {buildPublication,publicProjection} from '../src/publication.js';
import {digest,serialize} from '../src/storage-format.js';

const query=()=>({projectId:null,notebookId:null,filter:'all',search:'',browse:recordBrowse()});
const relatedTo=(book,id)=>({workspaceId:book.id,id});
test('beekeeping is opt-in in the shared registry and retains editable independent blank observations',()=>{
 const {book,notebook,hive,inspection}=beekeepingFixture();validateNotebook(book);
 assert.ok(labBookTypeModules().some(m=>m.id==='laboratory-beekeeping'));assert.ok(validLabBookTypeSelection(['laboratory-beekeeping']));
 assert.equal(enabledLabBookTypes({enabledModules:[]}).length,0);assert.equal(enabledLabBookTypes({enabledModules:['laboratory-beekeeping']})[0].id,'beekeeping');
 assert.equal(activityTemplates(book,hive,{enabledModules:[]}).length,0);
 assert.equal(activityTemplates(book,hive,{enabledModules:['laboratory-beekeeping']}).length,9);
 assert.equal(activityContext(book,hive).subject,true);assert.equal(activityContext(book,inspection).event,true);
 const fresh=templateFrom(notebook.configuration.sections.find(s=>s.key==='inspection'));assert.deepEqual(fresh.values,{});
 const old=structuredClone(inspection.template);notebook.configuration.sections.find(s=>s.key==='inspection').fields[0].label='Changed';assert.deepEqual(inspection.template,old);
 assert.equal(fresh.fields.find(f=>f.key==='queen').choices.includes('Not checked'),true);
 assert.equal(fresh.fields.find(f=>f.key==='queen').choices.includes('Queenless'),false);
 assert.equal(documentRecord(book.id,inspection,hive),false);assert.throws(()=>documentRecord(book.id,hive,hive));
});

test('linked history stays paged, private and revision-anchored across saves and backup',async t=>{
 const {book,hive,other,colony,inspection,record}=beekeepingFixture();
 for(let i=0;i<24;i++){const r=record('inspection','Visit '+i,'2026-09-'+String(i+1).padStart(2,'0'));r.status=i===23?'incomplete':'completed';r.body='PRIVATE BODY '.repeat(200);documentRecord(book.id,r,hive);book.entries.push(r);}
 const external=record('inspection','Same ID in another workspace');documentRecord(randomUUID(),external,hive);book.entries.push(external);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-bees-')),f=await encryptedFixture(directory,book),queries=new RecordQuery(f.workspace),records=new ResearchRecords(f.workspace,{});
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const command={workspaceId:book.id,query:query(),relatedTo:relatedTo(book,hive.id),limit:10},read=ResearchCatalogue.prototype.read,load=ResearchCatalogue.prototype.record;let first;
 ResearchCatalogue.prototype.read=()=>{throw Error('Whole workspace loaded for hive history');};ResearchCatalogue.prototype.record=()=>{throw Error('Record body loaded for hive history');};
 try{
  first=await queries.list(command);assert.equal(first.total,25);assert.equal(first.records.length,10);assert.equal(first.records[0].status,'incomplete');assert.ok(!JSON.stringify(first).includes('PRIVATE BODY'));assert.ok(!JSON.stringify(first).includes('PRIVATE HEALTH'));assert.ok(first.records.every(r=>!r.referenceTargets));
  assert.equal((await queries.list({...command,query:query(),relatedTo:relatedTo(book,other.id)})).total,0);assert.equal((await queries.list({...command,query:query(),relatedTo:relatedTo(book,colony.id)})).total,1);
 }finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record=load;}
 await records.save({workspaceId:book.id,changes:[{id:inspection.id,expectedRevision:recordRevision(inspection),record:{...inspection,relations:[]}}]});
 const next=await queries.list({...command,cursor:first.nextCursor});assert.equal(next.changed,true);assert.equal(next.total,25);assert.equal((await queries.list(command)).total,24);
 await assert.rejects(queries.list({...command,query:query(),relatedTo:relatedTo(book,other.id),cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
 await assert.rejects(queries.list({...command,relatedTo:{workspaceId:randomUUID(),id:hive.id}}),{code:'INVALID'});
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'backup')),{vault:f.vault});
 assert.deepEqual((await new RecordQuery(new Workspace(copy,f.vault)).list({...command,cursor:first.nextCursor})).records,next.records);
 const restored=(await new Workspace(copy,f.vault).read()).book;assert.equal(restored.entries.find(r=>r.id===inspection.id).template.values.queen,'Not seen');
 clearVault(f.vault);await assert.rejects(queries.list(command),{code:'ACCESS_LOCKED'});
});

test('old query summaries fall back for linked histories without silently dropping references',async t=>{
 const {book,hive}=beekeepingFixture(),directory=await mkdtemp(path.join(os.tmpdir(),'observanda-bees-old-'));
 const original=ResearchCatalogue.prototype.putQuery;
 ResearchCatalogue.prototype.putQuery=async function(record){const value=recordQueryDocument(record);delete value.referenceTargets;const revision=digest(serialize(value)),slot='record-query:'+record.id+':'+revision;await this.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO NOTHING',slot,this.encode('state',slot,value));return {queryRevision:revision};};
 let f;try{f=await encryptedFixture(directory,book);}finally{ResearchCatalogue.prototype.putQuery=original;}
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 assert.equal((await new RecordQuery(f.workspace).list({workspaceId:book.id,query:query(),relatedTo:relatedTo(book,hive.id)})).total,1);
 await f.workspace.catalogue(store=>store.verify({format:'observanda-research-catalogue',version:2,workspaceId:book.id}));
});

test('a published hive never discloses its private linked inspections or query metadata',()=>{
 const {book,hive,inspection}=beekeepingFixture();hive.share=true;
 const projected=publicProjection(book);assert.ok(!projected.entries.some(e=>e.id===inspection.id));
 for(const file of buildPublication(book).files.values()){const text=Buffer.from(file).toString();assert.ok(!text.includes('PRIVATE HEALTH NOTES'));assert.ok(!text.includes(inspection.id));assert.ok(!text.includes('referenceTargets'));}
});
