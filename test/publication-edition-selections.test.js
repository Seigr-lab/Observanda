import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {selectionBook} from './publication-selection-fixture.js';
import {historicalFixture} from './publication-revisions-fixture.js';
import {clearVault} from '../src/encryption.js';
import {PublicationEditionSelections,publicationEditionChoices} from '../src/publication-edition-selections.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {defaultEditionRecord,editionRevisionKey,editionAvailabilityKey} from '../src/web/publication-selection.js';
import {revisionPageId} from '../src/publication-revisions.js';
import {recordRevision} from '../src/research.js';
import {contentBuffer} from '../src/file-content.js';
import {openPublicationInput} from '../src/publication-input-reader.js';
import {Workspace} from '../src/storage.js';

async function fixture(t){const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-retained-edition-')),data=selectionBook(),f=await encryptedFixture(directory,data.book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});const releases=new PublicationJobs(f.workspace),{etag,websitePin}=await releases.workspace.outline();return {...f,...data,releases,source:{workspaceId:data.book.id,etag,websitePin}};}
const change=(collection,value,id)=>({collection,id:id??(collection==='records'?value.id:collection==='history'?editionRevisionKey(value):editionAvailabilityKey(value)),value});

test('native edition checkpoints exceed aggregate request and count limits with bounded reads, restart, replay and discard', {timeout:600000},async t=>{
 const f=await fixture(t),owner=new PublicationEditionSelections(f.workspace),opened=await owner.operate('open',{source:f.source});let selection=opened.selection,firstCommand;
 const prototype={...defaultEditionRecord(f.record,recordRevision(f.record)),body:false,sections:[],fields:[],figures:[],attachments:[]},ids=Array.from({length:10001},()=>randomUUID()).sort();let bytes=0;
 for(let at=0;at<ids.length;at+=32){const changes=ids.slice(at,at+32).map(id=>change('records',{...prototype,id})),command={selection,commandId:randomUUID(),changes};bytes+=Buffer.byteLength(JSON.stringify(changes));assert.ok(Buffer.byteLength(JSON.stringify(command))<1024*1024);const result=await owner.operate('checkpoint',command);selection=result.selection;if(!at)firstCommand=command;if(at%2048===0)t.diagnostic('Checkpointed '+result.counts.records+' choices');}
 assert.ok(bytes>2*1024*1024);const resumed=await new PublicationEditionSelections(f.workspace).operate('open',{source:f.source});assert.equal(resumed.resumed,true);assert.deepEqual(resumed.selection,selection);assert.equal(resumed.counts.records,10001);
 let reads=0;const read=Workspace.prototype.readMetadata;Workspace.prototype.readMetadata=async function(...args){reads++;return read.apply(this,args);};
 try{const page=await owner.operate('window',{selection,collection:'records',offset:9990,limit:20});assert.equal(page.items.length,11);assert.deepEqual(page.items.map(row=>row.id),ids.slice(9990));assert.ok(reads>0&&reads<80,'Late page must seek its index, not read all choices: '+reads);}finally{Workspace.prototype.readMetadata=read;}
 const replay=await owner.operate('checkpoint',firstCommand);assert.notDeepEqual(replay.selection,selection);await assert.rejects(owner.operate('read',{selection:replay.selection,keys:[]}),{code:'CONFLICT'});
 await assert.rejects(owner.operate('checkpoint',{...firstCommand,changes:[change('records',{...prototype,id:ids[0],body:true})]}),{code:'CONFLICT'});
 await assert.rejects(publicationEditionChoices(f.workspace,selection,{source:{...f.source,workspaceId:randomUUID()}}),{code:'WORKSPACE_CHANGED'});
 const current={selection,commandId:randomUUID(),changes:[change('records',null,ids[0])]},changed=await owner.operate('checkpoint',current);assert.deepEqual(await owner.operate('checkpoint',current),changed);assert.equal(changed.counts.records,10000);
 await assert.rejects(owner.operate('discard',{selection}),{code:'CONFLICT'});selection=changed.selection;
 const remove=f.workspace.removeMetadata;let failCleanup=true;f.workspace.removeMetadata=async function(file,...args){if(failCleanup&&file.startsWith('.observanda/publication-selection-blocks/'+selection.id+'/')){failCleanup=false;throw Error('Interrupted discard cleanup');}return remove.call(this,file,...args);};
 try{await assert.rejects(owner.operate('discard',{selection}),/Interrupted discard cleanup/);}finally{delete f.workspace.removeMetadata;}
 assert.equal(await f.workspace.readMetadata('.observanda/publication-selections/'+selection.source+'.json',8192),null);
 await new PublicationEditionSelections(f.workspace).recover();assert.deepEqual(await owner.operate('discard',{selection}),{discarded:true});assert.equal((await f.workspace.metadataPage('.observanda/publication-selection-blocks/'+selection.id,{limit:1})).items.length,0);assert.equal((await f.workspace.metadataPage('.observanda/publication-selection-receipts/'+selection.id,{limit:1})).items.length,0);await assert.rejects(publicationEditionChoices(f.workspace,selection),{code:'CONFLICT'});
 const fresh=await owner.operate('open',{source:f.source});assert.equal(fresh.counts.records,0);assert.notEqual(fresh.selection.id,selection.id);await assert.rejects(owner.operate('checkpoint',current),{code:'CONFLICT'});
 assert.equal((await f.workspace.outline()).etag,f.source.etag);
});

test('retained choices capture exact history and availability, reject stale sources, and remain independent after preparation',async t=>{
 const f=await historicalFixture(t),owner=new PublicationEditionSelections(f.workspace),opened=await owner.operate('open',{source:f.source}),old=defaultEditionRecord(f.old,f.target.revision);old.sections=[];
 const note={recordId:f.run.id,target:f.target,statement:'The procedure is available on request.'},saved=await owner.operate('checkpoint',{selection:opened.selection,commandId:randomUUID(),changes:[change('availability',note)]});
 const excluded=await f.releases.inline({...f.source,edition:saved.selection}),run=(await contentBuffer(await excluded.files.get('entries/'+f.run.id+'.html'))).toString();assert.match(run,/The procedure is available on request/);assert.ok(!run.includes('Exact older procedure'));
 const accepted=await owner.operate('checkpoint',{selection:saved.selection,commandId:randomUUID(),changes:[change('history',old)]});
 // Pause an admitted capture after it establishes its native read snapshot.
 // Discard reclaims the draft while the capture keeps its exact prior values.
 let notify,release,paused=false;const reached=new Promise(resolve=>notify=resolve),resume=new Promise(resolve=>release=resolve),read=f.workspace.readMetadata;
 f.workspace.readMetadata=async function(file,...args){const value=await read.call(this,file,...args);if(!paused&&file.startsWith('.observanda/publication-selection-blocks/'+accepted.selection.id+'/')){paused=true;notify();await resume;}return value;};
 const pending=f.releases.inline({...f.source,edition:accepted.selection});let candidate,timer;
 try{await Promise.race([reached,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Capture did not reach retained choices')),20000))]);await owner.operate('discard',{selection:accepted.selection});release();candidate=await pending;}finally{clearTimeout(timer);release();delete f.workspace.readMetadata;await pending.catch(()=>{});}
 const page=revisionPageId(f.book.id,f.old.id,f.target.revision),html=(await contentBuffer(await candidate.files.get('entries/'+page+'.html'))).toString();
 assert.match(html,/Exact older procedure/);assert.ok(!html.includes('HISTORICAL_PRIVATE_INSTRUCTIONS'));assert.ok(!html.includes('New procedure'));
 const input=await openPublicationInput(f.releases.workspace,await f.releases.source(candidate.jobId));assert.equal((await input.get('records',page)).revision,f.target.revision);
 await owner.operate('discard',{selection:accepted.selection});assert.equal((await contentBuffer(await (await f.releases.read(candidate.reviewId)).files.get('entries/'+page+'.html'))).toString(),html);
 const snapshot=await f.workspace.read();snapshot.book.entries.find(record=>record.id===f.method.id).body='Updated after selection';await f.workspace.save(snapshot.book,snapshot.etag);
 await assert.rejects(owner.operate('open',{source:f.source}),{code:'CONFLICT'});
});
