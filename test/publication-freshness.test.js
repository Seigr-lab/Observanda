import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {WebsiteSites} from '../src/website-sites.js';
import {websiteWorkspace} from '../src/website-workspace.js';
import {publicationRevisionCurrent} from '../src/publication-freshness.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {AppError} from '../src/errors.js';

const edit=site=>({workspaceId:site.book.id,baseEtag:site.etag,websitePin:site.websitePin,metadata:{},projects:[],changes:[],removed:[],selection:site.site.selection});

test('website freshness ignores only unrelated website edits and rejects changed content or consent',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-publication-freshness-'));let fixture;
 try{
  fixture=await encryptedFixture(directory,sampleNotebook());const sites=new WebsiteSites(fixture.workspace),ids=[];
  for(const name of ['Field journal','Course website'])ids.push((await sites.change({workspaceId:(await fixture.workspace.outline()).metadata.id,etag:(await fixture.workspace.outline()).etag,operation:'create',name})).id);
  const [journal,course]=ids.map(id=>websiteWorkspace(fixture.workspace,id)),base=await journal.outline(),courseBase=await course.outline(),defaultBase=await websiteWorkspace(fixture.workspace,null).outline();
  assert.equal(await publicationRevisionCurrent(journal,base),true);
  const other=await sites.read(ids[1]),change=edit(other);change.metadata.website={...other.book.website,footer:'Other website footer'};await sites.save(ids[1],change);
  const record=ResearchCatalogue.prototype.record;ResearchCatalogue.prototype.record=()=>{throw Error('Freshness loaded an original record');};
  try{assert.equal(await publicationRevisionCurrent(journal,base),true);assert.equal(await publicationRevisionCurrent(course,courseBase),false);assert.equal(await publicationRevisionCurrent(fixture.workspace,defaultBase),true);await assert.rejects(publicationRevisionCurrent(journal,base.etag),{code:'INVALID'});}finally{ResearchCatalogue.prototype.record=record;}
  assert.equal(await publicationRevisionCurrent(journal,{etag:'f'.repeat(64),websitePin:{...base.websitePin,researchSnapshotId:'f'.repeat(64)}}),false);assert.equal(await publicationRevisionCurrent(journal,'invalid'),false);
  const own=await sites.read(ids[0]),ownChange=edit(own);ownChange.metadata.website={...own.book.website,footer:'Changed journal footer'};await sites.save(ids[0],ownChange);assert.equal(await publicationRevisionCurrent(journal,{etag:own.etag,websitePin:own.websitePin}),false);
  const consent=await sites.read(ids[0]),command=edit(consent),saved=await fixture.workspace.read();command.selection={defaultShare:false,includeProjects:[],records:[{id:saved.book.entries[0].id,share:true,attachments:[]}]};await sites.save(ids[0],command);assert.equal(await publicationRevisionCurrent(journal,{etag:consent.etag,websitePin:consent.websitePin}),false);
  const beforeResearch=await journal.outline(),current=await fixture.workspace.read();current.book.entries[0].body='Changed research original';await fixture.workspace.save(current.book,current.etag);assert.equal(await publicationRevisionCurrent(journal,beforeResearch),false);
  const beforeShared=await journal.outline(),shared=await fixture.workspace.read();shared.book.notebooks[0].title='Changed shared collection title';await fixture.workspace.save(shared.book,shared.etag);assert.equal(await publicationRevisionCurrent(journal,beforeShared),false);
 }finally{if(fixture)clearVault(fixture.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-publication-freshness-'));await rm(directory,{recursive:true,force:true});}
});

test('freshness propagates damaged authenticated snapshots and keeps legacy workspace checks strict',async()=>{
 const current={etag:'a'.repeat(64)},revision='b'.repeat(64),damage=new AppError('CATALOGUE_DAMAGED'),workspace={websiteContext:true,websiteId:randomUUID(),storageKind:async()=>'catalogue',currentOutline:async()=>current,catalogue:async use=>use({snapshot:async()=>{throw damage;}})};
 await assert.rejects(publicationRevisionCurrent(workspace,revision),error=>error===damage);
 assert.equal(await publicationRevisionCurrent({...workspace,websiteId:null,storageKind:async()=>'file'},revision),false);
});
