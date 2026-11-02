import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore} from '../src/website-file-store.js';
import {websiteFilesHttp} from '../src/website-files-http.js';
import {EventEmitter} from 'node:events';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {githubFixture,sha} from './github-fixture.js';
import {defaultPublishing} from '../src/publishing.js';

test('website folder selection requires the same live grant when the native dialog returns',async()=>{
 const siteId=randomUUID(),workspace={catalogue:()=>assert.fail('Folder selection opened research')};
 let selected=false,active=true;
 const choose=async operation=>{
  let result;
  await websiteFilesHttp({method:'POST'},new EventEmitter(),{
   workspace,url:new URL('/api/website-files/folder/'+operation,'http://localhost'),
   body:async()=>({siteId,path:''}),check:async()=>{if(!active&&selected)throw Error('Grant expired');},
   folderPicker:{capabilities:()=>({mode:'native'}),choose:async({path,signal})=>{assert.equal(path,'');assert.equal(signal.aborted,false);selected=true;return {cancelled:true,folder:null};}},
   json:value=>{result=value;}
  });
  return result;
 };
 assert.deepEqual(await choose('chooser'),{mode:'native'});assert.equal(selected,false);
 assert.deepEqual(await choose('choose'),{cancelled:true,folder:null});
 selected=false;active=false;await assert.rejects(choose('choose'),/Grant expired/);
});

test('reviewed publication writes the saved HTML and CSS to a real folder without a catalogue, and refuses stale reviews',async()=>{
 const area=await mkdtemp(path.join(os.tmpdir(),'obs-site-publish-')),root=path.join(area,'workspace'),folder=path.join(area,'published');
 try{
  await mkdir(path.join(root,'.observanda'),{recursive:true});await mkdir(folder);await writeFile(path.join(folder,'unrelated.txt'),'preserve');
  const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
  for(const method of ['outline','catalogue','openCatalogue','withLock','readMetadata','writeMetadata'])workspace[method]=()=>assert.fail('Unexpected research database call: '+method);
  const store=new WebsiteFileStore(workspace),{site}=await store.create({name:'Laboratory'});
  const call=async(operation,data)=>{let result;const res=new EventEmitter();await websiteFilesHttp({method:'POST'},res,{url:new URL('/api/website-files/'+operation,'http://localhost'),workspace,contextId:'test',body:async()=>data,check:async()=>{},json:value=>{result=value;}});return result;};
  assert.deepEqual(await call('version',{siteId:site.id}),{revision:site.revision});
  assert.deepEqual(await call('pdf-version',{}),{revision:null});
  const command={siteId:site.id,expectedRevision:site.revision,directory:folder};
  const plan=await call('folder/plan',command);assert.equal(plan.counts.added,3);
  await assert.rejects(call('folder/apply',{...command,id:plan.id,reviewed:false}),{code:'LOCAL_EXPORT_REVIEW'});
  const saved=await store.open(site.id),receipt=await call('folder/apply',{...command,id:plan.id,reviewed:true});assert.equal(receipt.state,'completed');
  assert.equal(await readFile(path.join(folder,'index.html'),'utf8'),saved.html);assert.equal(await readFile(path.join(folder,'style.css'),'utf8'),saved.css);
  const next=await call('save',{siteId:site.id,path:'index.html',html:saved.html.replace('Laboratory</h1>','Published edit</h1>'),css:'main{color:navy}',expectedRevision:site.revision});
  await assert.rejects(call('folder/plan',command),{code:'CONFLICT'});
  const updated={...command,expectedRevision:next.site.revision};const review=await call('folder/plan',updated);await call('folder/apply',{...updated,id:review.id,reviewed:true});
  assert.match(await readFile(path.join(folder,'index.html'),'utf8'),/Published edit/);assert.equal(await readFile(path.join(folder,'unrelated.txt'),'utf8'),'preserve');
 }finally{await closeIdleMutationFiles();await rm(area,{recursive:true,force:true});}
});

test('GitHub destination review, ownership and upload use the file revision with research offline',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'obs-site-review-'));await mkdir(path.join(root,'.observanda'));
 try{
  const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),remote=githubFixture();
  for(const method of ['catalogue','outline','openCatalogue','readMetadata','writeMetadata'])workspace[method]=()=>assert.fail('Research access: '+method);
  const initial=await new WebsiteFileStore(workspace).create({name:'Reviewed website'}),siteId=initial.site.id,expectedRevision=initial.site.revision;
  const publisherOptions={request:remote.request,connection:{summary:async()=>({connected:true}),token:async()=>'synthetic_session_secret_1234567890'}};
  const call=async(operation,options={})=>{let result;await websiteFilesHttp({method:'POST'},new EventEmitter(),{url:new URL('/api/website-files/'+operation,'http://localhost'),workspace,publisherOptions,body:async()=>({siteId,expectedRevision,...options}),check:async()=>{},json:value=>{result=value;}});return result;};
  const config=defaultPublishing();Object.assign(config.github,{owner:'example',repository:'notebook',branch:'observanda-site',pages:true});
  const saved=await call('destination/save',{config,etag:'new'});const reviewed=await call('plan',{configEtag:saved.etag});
  const page=await call('plan/page',{configEtag:saved.etag,id:reviewed.id,kind:'added',offset:0});assert.ok(page.items.includes('index.html'));
  await assert.rejects(call('publish',{configEtag:saved.etag,destinationReviewed:true}),{code:'PUBLISH_STALE'});
  await assert.rejects(call('publish',{configEtag:saved.etag,destinationReview:reviewed.id,destinationReviewed:false}),{code:'PUBLISH_STALE'});
  const {receipt}=await call('publish',{configEtag:saved.etag,destinationReview:reviewed.id,destinationReviewed:true});assert.equal(receipt.status,'uploaded-awaiting-pages');
  assert.ok(remote.blobs.has(sha('blob',Buffer.from(initial.html))));assert.ok(remote.blobs.has(sha('blob',Buffer.from(initial.css))));
 }finally{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true});}
});
