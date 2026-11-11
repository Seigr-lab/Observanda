import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {WebsiteFileStore} from '../src/website-file-store.js';
import {PublicationConversion} from '../src/publication-conversion.js';
import {executeResearchRequest} from '../src/research-requests.js';
import {recordRevision} from '../src/research.js';
import {enumerateFeedMembers,readFeedSource} from '../src/website-feed-query.js';
import {seedEligibleWebsiteOwner} from '../src/website-library-discovery.js';
import {upgradeControl} from '../src/website-upgrade-lease.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {createFigure} from '../src/web/figure-model.js';

test('eligible lab edits update saved live feed files and matching rules while an ordinary website copy keeps its authored composition',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-feed-')),book=sampleNotebook(),record=book.entries[2],hidden=randomUUID();
 record.share=false;record.title='First survey';record.body='The baseline measurement.';record.tags=['Co'];
 record.sections=[{id:hidden,title:'Field notes',body:'Withheld sample',share:false}];book.entries=[record];
 const {workspace,vault}=await encryptedFixture(directory,book);t.after(async()=>{await closeIdleMutationFiles();await clearVault(vault);await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:100});});
 const store=new WebsiteFileStore(workspace),conversion=new PublicationConversion(workspace,{store}),target={workspaceId:book.id,recordId:record.id};
 const call=(route,data)=>executeResearchRequest(workspace,'/api/research/records/'+route,data,{publicationConversion:conversion});
 const value=async(field,value)=>{const base=await call('values/read',{...target,field});return call('values/save',{...target,field,expectedRevision:base.revision,value:{value}});};
 const writing=async(sectionId,body)=>{const base=await call('writing/read',{...target,sectionId});return call('writing/save',{...target,sectionId,expectedRevision:base.revision,value:{...base.value,body}});};
 await value('share',true);const source=await store.sourceForRecord({...target,target:'website'}),created=await store.create({name:'Coastal survey'});
 const placed=await store.insertSource(created.site.id,{sourceId:source.id,sourceRevision:source.revision,expectedRevision:created.site.revision});
 const saved=await store.save(created.site.id,{path:placed.path,expectedRevision:placed.site.revision,html:placed.html.replace('The baseline measurement.','An authored passage.'),css:placed.css});
 const live=()=>store.scope(()=>readFeedSource(store,source.id)),fragment=source=>store.scope(()=>store.readText(source.html));
 assert.equal((await live()).revision,source.revision);
 await value('title','Second survey');await value('status','completed');await value('occurredOn','2026-11-03');await value('type','analysis');await writing(null,'Live measurement after the storm.');
 const current=await live();assert.notEqual(current.revision,source.revision);assert.equal(current.feedRow.status,'completed');assert.equal(current.feedRow.recordType,'analysis');
 const html=await fragment(current);assert.match(html,/Second survey/);assert.match(html,/Live measurement after the storm/);assert.doesNotMatch(html,/Withheld sample/);
 const rule={search:'Second survey',searchField:'exact-title',tags:['Co'],dateFrom:'2026-11-03',status:'completed',recordType:'analysis'};
 assert.deepEqual((await enumerateFeedMembers(store,rule)).map(m=>m.id),[source.id]);assert.deepEqual(await enumerateFeedMembers(store,{search:'First survey',searchField:'exact-title'}),[]);
 const ordinary=await store.open(created.site.id);assert.equal(ordinary.html,saved.html);assert.equal(ordinary.site.revision,saved.site.revision);
 await writing(hidden,'Private text changed');assert.equal((await live()).revision,current.revision);
 await store.scope(()=>assert.rejects(readFeedSource(store,source.id,source.revision),{code:'CONFLICT'}));
 // A figure added through its selected value is new to the live site: the site is fenced before the write and refreshed after it.
 const beforeFigure=await live(),figure=createFigure();figure.title='Storm response';figure.series[0].points=[{x:1,y:2,error:null}];await value('figure:'+figure.id,figure);
 const withFigure=await live();assert.notEqual(withFigure.revision,beforeFigure.revision);assert.match(await fragment(withFigure),/Storm response/);
 await value('share',false);await store.scope(()=>assert.rejects(readFeedSource(store,source.id),{code:'NOT_FOUND'}));assert.deepEqual(await enumerateFeedMembers(store,rule),[]);
 await value('share',true);assert.deepEqual((await enumerateFeedMembers(store,rule)).map(m=>m.id),[source.id]);
 const afterRestore=await store.open(created.site.id),currentRecord=(await workspace.read()).book.entries[0];
 await call('remove',{...target,expectedRevision:recordRevision(currentRecord)});
 assert.deepEqual(await enumerateFeedMembers(store,rule),[]);await store.scope(()=>assert.rejects(readFeedSource(store,source.id),{code:'NOT_FOUND'}));
 assert.equal((await store.open(created.site.id)).html,afterRestore.html);
});

test('a content save answers after its research write while the website copy stays fenced until rebuilt, and an interrupted rebuild recovers',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-feed-background-')),book=sampleNotebook(),record=book.entries[2];
 record.share=false;record.title='Before the storm';book.entries=[record];
 const {workspace,vault}=await encryptedFixture(directory,book);t.after(async()=>{await closeIdleMutationFiles();await clearVault(vault);await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:100});});
 const store=new WebsiteFileStore(workspace),conversion=new PublicationConversion(workspace,{store}),target={workspaceId:book.id,recordId:record.id};
 const value=async(field,value,options={})=>{const base=await executeResearchRequest(workspace,'/api/research/records/values/read',{...target,field});return executeResearchRequest(workspace,'/api/research/records/values/save',{...target,field,expectedRevision:base.revision,value:{value}},{publicationConversion:conversion,...options});};
 await value('share',true);const source=await store.sourceForRecord({...target,target:'website'}),created=await store.create({name:'Storm notes'});
 const placed=await store.insertSource(created.site.id,{sourceId:source.id,sourceRevision:source.revision,expectedRevision:created.site.revision});
 const live=()=>store.scope(()=>readFeedSource(store,source.id)),fragment=source=>store.scope(()=>store.readText(source.html)),pending=async()=>(await store.sourceStatus(source.id)).pending;
 const compose=conversion.composition,before=await live();let release;const held=new Promise(resolve=>release=resolve);
 conversion.composition=async function(...args){await held;return compose.apply(this,args);};
 // The author's save returns while the website rebuild still waits.
 const saved=await value('title','During the storm',{publicationBackground:true});assert.equal(saved.saved,true);
 assert.equal((await workspace.read()).book.entries[0].title,'During the storm');assert.ok(await pending());
 await assert.rejects(async()=>store.save(created.site.id,{path:placed.path,expectedRevision:placed.site.revision,html:placed.html,css:placed.css}),{code:'CONFLICT'});
 release();await conversion.settled();
 const rebuilt=await live();assert.notEqual(rebuilt.revision,before.revision);assert.match(await fragment(rebuilt),/During the storm/);assert.ok(!await pending());
 // A rebuild that stops after the research write keeps the copy fenced and is resumed with the committed record.
 let interrupt=true;conversion.composition=async function(...args){if(interrupt){interrupt=false;throw Error('Interrupted website rebuild');}return compose.apply(this,args);};
 await value('title','After the storm',{publicationBackground:true});await conversion.settled();
 assert.equal(interrupt,false);assert.match(await fragment(await live()),/After the storm/);assert.ok(!await pending());
});

test('owner preparation catches up previously converted writing once, resuming an interrupted live-only write',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-feed-history-')),book=sampleNotebook(),record=book.entries[2];book.entries=[record];record.share=false;record.body='Earlier saved writing.';
 const {workspace,vault}=await encryptedFixture(directory,book);t.after(async()=>{await closeIdleMutationFiles();await clearVault(vault);await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:100});});
 const files=new WebsiteFileStore(workspace),publicationConversion=new PublicationConversion(workspace,{store:files}),scope={workspaceId:book.id,recordId:record.id};
 const read=await executeResearchRequest(workspace,'/api/research/records/values/read',{...scope,field:'share'});
 await executeResearchRequest(workspace,'/api/research/records/values/save',{...scope,field:'share',expectedRevision:read.revision,value:{value:true}},{publicationConversion});
 const source=await files.sourceForRecord({...scope,target:'website'}),site=await files.create({name:'Historical atlas'});
 const placed=await files.insertSource(site.site.id,{sourceId:source.id,expectedRevision:site.site.revision});
 const writing={...scope,sectionId:null},prior=await executeResearchRequest(workspace,'/api/research/records/writing/read',writing);
 // A predecessor writer saved this edit before live projections existed.
 await executeResearchRequest(workspace,'/api/research/records/writing/save',{...writing,expectedRevision:prior.revision,value:{...prior.value,body:'Historical edit from the lab.'}});
 const reader={use:async(id,_pin,work)=>({value:await workspace.catalogue(async store=>{const snapshotId=await store.head();return work(store,await store.snapshot(snapshotId),{snapshotId,storage:workspace});})})};
 await files.scope(()=>files.writeControl(upgradeControl('eligible-entries-'+book.id),{version:1,complete:true}),{write:true});
 const finish=files.finishSourceUpdate;let interrupt=true;
 files.finishSourceUpdate=async function(...args){if(interrupt){interrupt=false;throw Error('Interrupted historical file update');}return finish.apply(this,args);};
 await assert.rejects(seedEligibleWebsiteOwner(files,reader,book.id),/Interrupted historical file update/);files.finishSourceUpdate=finish;
 assert.equal((await files.sourceStatus(source.id)).pending.feedBackfill,true);
 await seedEligibleWebsiteOwner(files,reader,book.id);
 const live=await files.scope(()=>readFeedSource(files,source.id));assert.match(await files.scope(()=>files.readText(live.html)),/Historical edit from the lab/);
 assert.equal((await files.open(site.site.id)).html,placed.html);
 await seedEligibleWebsiteOwner(files,{use:()=>assert.fail('Reopened an already reconciled owner')},book.id);
});

test('owner upgrade checks predecessor sources missing from the grant scan and repairs withdrawn parts',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-feed-orphans-')),book=sampleNotebook();
 const [absent,hidden,changed]=book.entries;book.entries=[absent,hidden,changed];
 const section={id:randomUUID(),title:'Formerly visible method',body:'A now private calibration',share:true};
 changed.sections=[section];hidden.body='Withhold this originally approved field note.';for(const item of book.entries)item.share=false;
 const {workspace,vault}=await encryptedFixture(directory,book);t.after(async()=>{await closeIdleMutationFiles();await clearVault(vault);await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:100});});
 const files=new WebsiteFileStore(workspace),publicationConversion=new PublicationConversion(workspace,{store:files});
 const cmd=(name,data,options)=>executeResearchRequest(workspace,'/api/research/records/'+name,data,options);
 const source=new Map(),sites=new Map();
 for(const record of book.entries){
  const target={workspaceId:book.id,recordId:record.id,field:'share'},base=await cmd('values/read',target);
  await cmd('values/save',{...target,expectedRevision:base.revision,value:{value:true}},{publicationConversion});
  const saved=await files.sourceForRecord({...target,target:'website'}),{site}=await files.create({name:'Collection '+record.title});
  source.set(record.id,saved);sites.set(record.id,await files.insertSource(site.id,{sourceId:saved.id,expectedRevision:site.revision}));
 }
 const current=(await workspace.read()).book.entries.find(r=>r.id===absent.id);await cmd('remove',{workspaceId:book.id,recordId:absent.id,expectedRevision:recordRevision(current)});
 const privacy={workspaceId:book.id,recordId:hidden.id,field:'share'};
 await cmd('values/save',{...privacy,expectedRevision:(await cmd('values/read',privacy)).revision,value:{value:false}});
 const writing={workspaceId:book.id,recordId:changed.id,sectionId:section.id},base=await cmd('writing/read',writing);
 await cmd('writing/save',{...writing,expectedRevision:base.revision,value:{...base.value,share:false}});
 const reader={use:async(id,_pin,work)=>({value:await workspace.catalogue(async store=>{const snapshotId=await store.head();return work(store,await store.snapshot(snapshotId),{snapshotId,storage:workspace});})})};
 await seedEligibleWebsiteOwner(files,reader,book.id);
 assert.deepEqual((await enumerateFeedMembers(files,{})).map(m=>m.id),[source.get(changed.id).id]);
 const ordinary=async record=>(await files.open(sites.get(record.id).site.id)).html;
 assert.equal(await ordinary(absent),sites.get(absent.id).html);assert.doesNotMatch(await ordinary(hidden),/Withhold this originally approved field note/);assert.doesNotMatch(await ordinary(changed),/A now private calibration/);
});
