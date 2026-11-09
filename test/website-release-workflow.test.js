import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../src/storage.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {websiteFilesHttp} from '../src/website-files-http.js';
import {defaultPublishing} from '../src/publishing.js';
import {githubFixture} from './github-fixture.js';
import {withdrawalNotice,isWithdrawalRelease} from '../src/website-withdrawal-edition.js';
import {recordRelease,readReleaseLedger,maxReleaseEntries} from '../src/website-release-ledger.js';

async function fixture(t,publisherOptions){
 const area=await mkdtemp(path.join(os.tmpdir(),'observanda-release-')),root=path.join(area,'workspace'),folder=path.join(area,'published');
 await mkdir(path.join(root,'.observanda'),{recursive:true});await mkdir(folder);
 t.after(async()=>{await closeIdleMutationFiles();await rm(area,{recursive:true,force:true,maxRetries:8,retryDelay:150});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
 workspace.catalogue=()=>assert.fail('Release work opened the research catalogue');
 const request=async(operation,data={})=>{
  let answer;await websiteFilesHttp({method:'POST',headers:{}},new EventEmitter(),{workspace,url:new URL('/api/website-files/'+operation,'http://localhost'),body:async()=>data,check:async()=>{},json:value=>{answer=value;},publisherOptions});return answer;
 };
 const created=await request('create',{name:'Estuary survey'}),siteId=created.site.id;
 return {folder,created,call:(operation,data)=>request(operation,{siteId,...data})};
}

test('a folder release reports outstanding changes, withdraws only owned files and restores through a reviewed update',async t=>{
 const {folder,created,call}=await fixture(t);
 await writeFile(path.join(folder,'unrelated.txt'),'Independent file');
 let site=created.site,html=created.html;
 const publish=async(edition)=>{
  const plan=await call('folder/plan',{expectedRevision:site.revision,directory:folder,...(edition?{edition}:{})});
  assert.equal(plan.counts.conflict,0);
  const done=await call('folder/apply',{expectedRevision:site.revision,directory:folder,id:plan.id,reviewed:true});
  assert.equal(done.state,'completed');return plan;
 };
 let overview=await call('release/overview',{expectedRevision:site.revision});
 assert.equal(overview.destination.kind,'choose');assert.equal(overview.delivered,null);assert.deepEqual(overview.releases,[]);
 const first=await publish();
 overview=await call('release/overview',{expectedRevision:site.revision});
 assert.equal(overview.destination.kind,'folder');assert.equal(overview.delivered.releaseId,first.releaseId);assert.equal(overview.delivered.edition,'website');
 assert.equal(overview.current,true);assert.equal(overview.changes.counts.changed,0);assert.equal(overview.changes.counts.removed,0);
 assert.equal(overview.releases.length,1);assert.equal(overview.releases[0].versionAvailable,true);

 // An edit and a new page are outstanding until the next reviewed update.
 let saved=await call('save',{expectedRevision:site.revision,path:'index.html',html:html.replace('</main>','<p>Turbidity rose after the storm.</p></main>'),css:'main{color:#123}'});
 site=saved.site;saved=await call('page/create',{expectedRevision:site.revision,path:'stations.html',title:'Stations',inclusion:'included'});site=saved.site;
 overview=await call('release/overview',{expectedRevision:site.revision});
 assert.equal(overview.current,false);assert.ok(overview.changes.counts.changed>=2);assert.ok(overview.changes.samples.added.every(name=>name==='stations.html'||/^page-[a-f0-9-]{36}\.css$/.test(name)));
 assert.ok(overview.changes.samples.added.includes('stations.html'));assert.ok(overview.changes.samples.changed.includes('index.html'));

 // Withdrawal replaces the delivered pages with one notice and leaves
 // independent files in place.
 const delivered=(await readdir(folder)).sort();
 const withdrawal=await publish('withdrawal');
 assert.equal(withdrawal.edition,'withdrawal');assert.ok(isWithdrawalRelease(withdrawal.releaseId));
 assert.equal(withdrawal.counts.removed,delivered.filter(name=>!['index.html','publication.json','unrelated.txt'].includes(name)).length);
 assert.deepEqual((await readdir(folder)).sort(),['index.html','publication.json','unrelated.txt']);
 assert.equal(await readFile(path.join(folder,'index.html'),'utf8'),withdrawalNotice());
 assert.doesNotMatch(await readFile(path.join(folder,'publication.json'),'utf8'),/Estuary|Turbidity|stations/);
 assert.equal(await readFile(path.join(folder,'unrelated.txt'),'utf8'),'Independent file');
 overview=await call('release/overview',{expectedRevision:site.revision});
 assert.equal(overview.delivered.edition,'withdrawal');assert.equal(overview.changes.counts.removed,0);assert.ok(overview.changes.counts.added>=2);
 assert.deepEqual(overview.releases.map(row=>row.edition),['withdrawal','website']);
 assert.equal(overview.releases[1].revision,created.site.revision);

 // A withdrawal review is fenced to the revision it was made for.
 const stale=await call('folder/plan',{expectedRevision:site.revision,directory:folder});
 const index=(await call('open',{path:'index.html'})).html;
 saved=await call('save',{expectedRevision:site.revision,path:'index.html',html:index,css:'main{color:#124}'});
 await assert.rejects(call('folder/apply',{expectedRevision:site.revision,directory:folder,id:stale.id,reviewed:true}),error=>['CONFLICT','STALE','LOCAL_EXPORT_CHANGED'].includes(error.code));
 site=saved.site;
 await call('folder/discard',{expectedRevision:site.revision,directory:folder,id:stale.id});

 // Publishing the website again returns every current page.
 await publish();
 assert.ok((await readdir(folder)).includes('stations.html'));assert.match(await readFile(path.join(folder,'index.html'),'utf8'),/Turbidity rose/);
 overview=await call('release/overview',{expectedRevision:site.revision});
 assert.equal(overview.current,true);assert.deepEqual(overview.releases.map(row=>row.edition),['website','withdrawal','website']);

 // A file changed outside Observanda is never removed by a withdrawal.
 await writeFile(path.join(folder,'stations.html'),'Edited by hand');
 const blocked=await call('folder/plan',{expectedRevision:site.revision,directory:folder,edition:'withdrawal'});
 assert.equal(blocked.counts.conflict,1);
 await assert.rejects(call('folder/apply',{expectedRevision:site.revision,directory:folder,id:blocked.id,reviewed:true}),{code:'LOCAL_EXPORT_CHANGED'});
 assert.equal(await readFile(path.join(folder,'stations.html'),'utf8'),'Edited by hand');
});

test('a GitHub destination withdraws through the reviewed transfer and records the edition',async t=>{
 const remote=githubFixture({branch:'main',initialFiles:{'README.md':'Independent document'}});
 const {created,call}=await fixture(t,{request:remote.request,connection:{summary:async()=>({connected:true}),token:async()=>'synthetic_session_secret_1234567890'}});
 const cfg=defaultPublishing();Object.assign(cfg.github,{owner:'example',repository:'notebook',branch:'main',directory:'atlas',pages:false});
 const config=await call('destination/save',{config:cfg,etag:'new'}),site=created.site;
 const deliver=async edition=>{
  const plan=await call('plan',{expectedRevision:site.revision,configEtag:config.etag,...(edition?{edition}:{})});
  return call('publish',{expectedRevision:site.revision,configEtag:config.etag,destinationReview:plan.id,destinationReviewed:true,...(edition?{edition}:{})});
 };
 const tree=()=>remote.trees.get(remote.commits.get(remote.head).tree).map(entry=>entry.path).sort();
 await deliver();assert.ok(tree().includes('atlas/style.css'));
 const {receipt}=await deliver('withdrawal');assert.ok(isWithdrawalRelease(receipt.releaseId));
 assert.deepEqual(tree(),['README.md','atlas/index.html','atlas/publication.json']);
 const overview=await call('release/overview',{expectedRevision:site.revision});
 assert.equal(overview.destination.kind,'github');assert.equal(overview.delivered.edition,'withdrawal');
 assert.deepEqual(overview.releases.map(row=>[row.edition,row.destination.kind]),[['withdrawal','github'],['website','github']]);
 assert.equal(overview.changes.counts.removed,0);assert.ok(overview.changes.samples.added.includes('style.css'));
});

test('the release ledger is bounded, idempotent and rejects damaged rows',async()=>{
 const values=new Map(),metadata={withLock:task=>task(),readMetadata:async name=>values.get(name)??null,writeMetadata:async(name,value)=>{values.set(name,value);}};
 const row=i=>({releaseId:i.toString(16).padStart(64,'0'),revision:'a'.repeat(64),version:null,edition:'website',destination:{kind:'folder',directory:'/srv/site'},completedAt:new Date(Date.UTC(2026,0,1,0,0,i)).toISOString()});
 for(let i=0;i<maxReleaseEntries+5;i++)await recordRelease(metadata,row(i));
 await recordRelease(metadata,row(maxReleaseEntries+4));
 const entries=await readReleaseLedger(metadata);
 assert.equal(entries.length,maxReleaseEntries);assert.equal(entries[0].releaseId,row(maxReleaseEntries+4).releaseId);
 await assert.rejects(recordRelease(metadata,{...row(1),destination:{kind:'folder',directory:'relative/path'}}),{code:'INVALID'});
 values.set('.observanda/website-releases.json',JSON.stringify({version:1,entries:[{...row(1),edition:'draft'}]}));
 await assert.rejects(readReleaseLedger(metadata),{code:'JOB_DAMAGED'});
});
