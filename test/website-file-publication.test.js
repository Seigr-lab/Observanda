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

test('reviewed publication writes the saved HTML and CSS to a real folder without a catalogue, and refuses stale reviews',async()=>{
 const area=await mkdtemp(path.join(os.tmpdir(),'obs-site-publish-')),root=path.join(area,'workspace'),folder=path.join(area,'published');
 try{
  await mkdir(path.join(root,'.observanda'),{recursive:true});await mkdir(folder);await writeFile(path.join(folder,'unrelated.txt'),'preserve');
  const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
  for(const method of ['outline','catalogue','openCatalogue','withLock','readMetadata','writeMetadata'])workspace[method]=()=>assert.fail('Unexpected research database call: '+method);
  const store=new WebsiteFileStore(workspace),{site}=await store.create({name:'Laboratory'});
  const call=async(operation,data)=>{let result;const res=new EventEmitter();await websiteFilesHttp({method:'POST'},res,{url:new URL('/api/website-files/'+operation,'http://localhost'),workspace,contextId:'test',body:async()=>data,check:async()=>{},json:value=>{result=value;}});return result;};
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
