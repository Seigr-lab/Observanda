import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../src/storage.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {websiteFilesHttp} from '../src/website-files-http.js';
import {defaultPublishing} from '../src/publishing.js';
import {githubFixture} from './github-fixture.js';
import {sshFixture} from './ssh-fixture.js';
import {withOperationProgress} from '../src/operation-progress.js';

async function fixture(t,options){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-file-transfer-'));await mkdir(path.join(root,'.observanda'));
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
 workspace.catalogue=()=>assert.fail('File publication opened the research catalogue');
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:150});});
 const request=async(operation,data={})=>{
  let answer;await websiteFilesHttp({method:'POST',headers:{}},new EventEmitter(),{workspace,url:new URL('/api/website-files/'+operation,'http://localhost'),body:async()=>data,check:async()=>{},json:value=>{answer=value;},publisherOptions:options});return answer;
 };
 const page=await request('create',{name:'Field atlas'}),siteId=page.site.id;
 return {page,call:(operation,data)=>request(operation,{siteId,...data})};
}
const confirmation=(plan,site,config)=>({expectedRevision:site.revision,configEtag:config.etag,destinationReview:plan.id,destinationReviewed:true});
test('the remote destination receives only included pages and removes a withdrawn page on the next reviewed delivery',async t=>{
 const remote=githubFixture({branch:'main',initialFiles:{'README.md':'Independent document'}});
 const receiver=createServer(async(req,res)=>{
  try{
   if(req.url.startsWith('/git-api/')){
    const body=Buffer.concat(await Array.fromAsync(req)).toString();
    const reply=await remote.request('https://api.github.com'+req.url.slice(8),{method:req.method,body});
    res.writeHead(reply.status);res.end(Buffer.from(await reply.arrayBuffer()));return;
   }
   const entries=remote.trees.get(remote.commits.get(remote.head).tree);
   const file=entries.find(entry=>entry.path===req.url.slice(1));
   res.writeHead(file?200:404);res.end(file?remote.blobs.get(file.sha):undefined);
  }catch{res.writeHead(500);res.end();}
 });
 await new Promise((resolve,reject)=>receiver.once('error',reject).listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>receiver.close(resolve)));
 const origin='http://127.0.0.1:'+receiver.address().port;
 const request=(url,options)=>fetch(origin+'/git-api'+new URL(url).pathname,options);
 const {page,call}=await fixture(t,{request,connection:{summary:()=>({connected:true}),token:()=> 'synthetic-token'}});
 const cfg=defaultPublishing();Object.assign(cfg.github,{owner:'example',repository:'notebook',branch:'main',directory:'atlas',pages:false});
 const config=await call('destination/save',{config:cfg,etag:'new'}),path='reports/findings.html';
 let current=await call('page/create',{expectedRevision:page.site.revision,path,title:'Internal draft canary'});
 const pin=()=>({expectedRevision:current.site.revision,path});
 const publish=async(included=false)=>{
  const plan=await call('plan',{...pin(),configEtag:config.etag});
  const reviewed=await call('review/catalogue',pin());
  const {receipt}=await call('publish',confirmation(plan,current.site,config));
  const files=remote.trees.get(remote.commits.get(remote.head).tree);
  assert.deepEqual(files.map(f=>f.path).sort(),['README.md',...reviewed.files.map(name=>'atlas/'+name)].sort());
  assert.equal(await (await fetch(origin+'/README.md')).text(),'Independent document');
  const manifest=await (await fetch(origin+'/atlas/publication.json')).json();
  assert.equal(manifest.releaseId,receipt.releaseId);
  assert.deepEqual(manifest.files.map(f=>f.path).sort(),reviewed.files.filter(name=>name!=='publication.json').sort());
  for(const file of manifest.files){
   const response=await fetch(origin+'/atlas/'+file.path);assert.equal(response.status,200);
   const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,file.bytes);
   assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
   if(!included)assert.ok(!bytes.includes('Internal draft canary'));
  }
  const visible=await fetch(origin+'/atlas/'+path);assert.equal(visible.status,included?200:404);
  if(included)assert.match(await visible.text(),/Internal draft canary/);
  return files;
 };
 const visibility=async inclusion=>{
  const options={...pin(),inclusion},review=await call('page/review-inclusion',options);
  current=await call('page/apply-inclusion',{...options,reviewId:review.reviewId});
 };
 let files=await publish();
 assert.ok(!files.some(f=>f.path==='atlas/'+path));
 assert.ok(![...remote.blobs.values()].some(b=>b.toString().includes('Internal draft canary')));
 assert.equal((await call('page/delivery',pin())).state,'excluded');
 await visibility('included');assert.equal((await call('page/delivery',pin())).state,'pending');
 files=await publish(true);assert.ok(files.some(f=>f.path==='atlas/'+path));assert.equal((await call('page/delivery',pin())).state,'delivered');
 await visibility('private');assert.equal((await call('page/delivery',pin())).state,'withdrawal');
 files=await publish();assert.ok(!files.some(f=>f.path==='atlas/'+path));assert.ok(files.some(f=>f.path==='README.md'));
 assert.equal((await call('page/delivery',pin())).state,'excluded');
});
test('saved HTML GitHub publication recovers a lost ref reply without a second branch update and keeps a verifiable durable receipt',async t=>{
 const remote=githubFixture({branch:'main',initialFiles:{'README.md':'Preserve this file'}});
 const {page,call}=await fixture(t,{request:remote.request,liveRequest:remote.request,connection:{summary:()=>({connected:true}),token:()=> 'synthetic-token'}});
 const cfg=defaultPublishing();cfg.publicUrl='https://public.example/research/';Object.assign(cfg.github,{owner:'example',repository:'notebook',directory:'atlas',pages:false});
 const config=await call('destination/save',{config:cfg,etag:'new'}),plan=await call('plan',{expectedRevision:page.site.revision,configEtag:config.etag}),intent=confirmation(plan,page.site,config);
 let lost=false;remote.setHook((call,phase)=>{if(!lost&&phase==='after'&&call.method==='PATCH'&&call.route.includes('/git/refs/heads/')){lost=true;throw Error('Lost branch acknowledgement');}});
 await assert.rejects(call('publish',intent));assert.ok(lost);
 const failed=(await call('publish-target')).destination.transfer;
 assert.equal(failed.state,'failed');assert.equal(failed.uncertain,true);assert.equal(failed.id,plan.id);
 const head=remote.head,writes=()=>remote.calls.filter(c=>c.method==='PATCH'&&c.route.includes('/git/refs/heads/')).length;
 remote.setHook(null);
 const result=await call('publish',intent);assert.equal(result.receipt.commit,head);assert.equal(result.receipt.status,'uploaded-repository-only');
 assert.equal(result.transfer.state,'completed');const repeated=await call('publish',intent);
 assert.equal(repeated.receipt.commit,head);assert.equal(writes(),1);
 const destination=await call('destination');assert.equal(destination.receipt.commit,head);assert.equal(destination.transfer.revision,page.site.revision);
 await assert.rejects(call('publish/verify',{expectedRevision:page.site.revision,configEtag:config.etag,commit:'wrong'}),{code:'PUBLISH_STALE'});
 const proof={expectedRevision:page.site.revision,configEtag:config.etag,commit:head};
 await assert.rejects(call('publish/verify',proof),{code:'PUBLISH_NOT_LIVE'});
 assert.equal((await call('destination')).receipt.verification.failed,true);
 const manifest=[...remote.blobs.values()].find(bytes=>bytes.toString().includes(result.receipt.releaseId));
 assert.ok(manifest);remote.setManifest(manifest.toString());
 assert.ok((await call('publish/verify',proof)).verification.files>=2);
 assert.equal((await call('destination')).receipt.verification.failed,undefined);
});

test('saved HTML SSH publication settles a lost activation after an edit, without uploading the stale files, then publishes the reviewed new page',async t=>{
 const remote=await sshFixture(t),{page,call}=await fixture(t,{ssh:remote.host});
 const cfg=defaultPublishing();cfg.kind='ssh';cfg.ssh=remote.config;
 const config=await call('destination/save',{config:cfg,etag:'new'}),plan=await call('plan',{expectedRevision:page.site.revision,configEtag:config.etag}),intent=confirmation(plan,page.site,config);
 let lost=false;remote.setHook((command,phase)=>{if(!lost&&phase==='after'&&command.args.at(-1).includes('mv -Tf')){lost=true;throw Error('Lost SSH switch reply');}});
 const observed=[];await assert.rejects(withOperationProgress(value=>observed.push(value),()=>call('publish',intent)));assert.ok(lost);remote.setHook(null);
 const upload=observed.map(v=>v.transfer).filter(v=>v?.phase==='remoteUpload'&&v.files===plan.counts.included).at(-1);
 const delivered=await Promise.all(plan.included.map(name=>readFile(path.join(remote.directory,'site','current',name))));
 assert.equal(upload?.bytes,delivered.reduce((total,file)=>total+file.length,0));
 const failed=(await call('destination')).transfer;assert.equal(failed.uncertain,true);
 const changed=await call('save',{expectedRevision:page.site.revision,path:page.path,css:page.css,html:page.html.replace('</main>','<p>Revised field notes.</p></main>')});
 assert.notEqual(changed.site.revision,page.site.revision);
 const sends=remote.calls.filter(c=>c.program==='sftp').length;
 await assert.rejects(call('publish',{...intent,expectedRevision:changed.site.revision}),{code:'PUBLISH_STALE'});
 const settle={expectedRevision:changed.site.revision,configEtag:config.etag,id:failed.id};
 const remotePage=path.join(remote.directory,'site','current','index.html'),original=await readFile(remotePage);
 await writeFile(remotePage,'Changed outside the publisher');await assert.rejects(call('publish/settle',settle));
 assert.equal((await call('destination')).transfer.uncertain,true);await writeFile(remotePage,original);
 const settled=await call('publish/settle',settle);
 assert.equal(settled.state,'settled');assert.equal(settled.receipt.releaseId,failed.releaseId);assert.equal(remote.calls.filter(c=>c.program==='sftp').length,sends);
 const updated=await call('plan',{expectedRevision:changed.site.revision,configEtag:config.etag}),result=await call('publish',confirmation(updated,changed.site,config));
 assert.notEqual(result.receipt.releaseId,failed.releaseId);assert.equal(result.receipt.status,'uploaded-remote-verified');
 assert.match(await readFile(path.join(remote.directory,'site','current','index.html'),'utf8'),/Revised field notes/);
});

test('closing an interrupted GitHub archive creation checks the reviewed repository and the actual archive ref',async t=>{
 const remote=githubFixture({branch:'main',initialFiles:{'README.md':'Original'}});
 const {page,call}=await fixture(t,{request:remote.request,connection:{summary:()=>({connected:true}),token:()=> 'synthetic-token'}});
 const cfg=defaultPublishing();Object.assign(cfg.github,{owner:'example',repository:'notebook',branch:'main',pages:false});
 const config=await call('destination/save',{config:cfg,etag:'new'}),archive='retained-original';
 const plan=await call('plan',{expectedRevision:page.site.revision,configEtag:config.etag,replaceExisting:true,archiveBranch:archive});
 const parent=remote.head;let lost=false;remote.setHook((row,phase)=>{if(phase==='after'&&row.method==='POST'&&row.data?.ref==='refs/heads/'+archive){lost=true;throw Error('Lost archive reply');}});
 await assert.rejects(call('publish',confirmation(plan,page.site,config)));assert.ok(lost);remote.setHook(null);
 const request={expectedRevision:page.site.revision,configEtag:config.etag,id:plan.id};
 remote.branches.set(archive,'d'.repeat(40));await assert.rejects(call('publish/settle',request),{code:'PUBLISH_ARCHIVE_BRANCH'});
 remote.branches.set(archive,parent);const finished=await call('publish/settle',request);
 assert.equal(finished.state,'settled');assert.equal(finished.receipt,null);assert.equal(remote.head,parent);
});

test('retrying a failed Pages setup reuses the confirmed branch commit and reviewed files',async t=>{
 const remote=githubFixture({branch:'main',initialFiles:{'README.md':'Keep'}});
 const {page,call}=await fixture(t,{request:remote.request,connection:{summary:()=>({connected:true}),token:()=> 'synthetic-token'}});
 const cfg=defaultPublishing();Object.assign(cfg.github,{owner:'example',repository:'notebook',branch:'main',directory:'atlas',pages:true});
 const config=await call('destination/save',{config:cfg,etag:'new'});
 const plan=await call('plan',{expectedRevision:page.site.revision,configEtag:config.etag}),intent=confirmation(plan,page.site,config);
 remote.setHook((row,phase)=>{if(phase==='before'&&row.route.endsWith('/pages')&&row.method==='POST')throw Error('Pages configuration unavailable');});
 const first=await call('publish',intent);assert.equal(first.receipt.status,'uploaded-pages-setup-required');
 const head=remote.head,writes=remote.calls.filter(c=>c.method==='POST'&&c.route.endsWith('/git/blobs')).length;
 remote.setHook(null);const retried=await call('publish',{...intent,retryPages:true});
 assert.equal(retried.receipt.status,'uploaded-awaiting-pages');assert.equal(retried.receipt.commit,head);
 assert.equal(remote.calls.filter(c=>c.method==='POST'&&c.route.endsWith('/git/blobs')).length,writes);
 assert.equal(remote.calls.filter(c=>c.method==='PATCH'&&c.route.includes('/git/refs/heads/')).length,1);
 assert.deepEqual(remote.pages.source,{branch:'main',path:'/'});
});
