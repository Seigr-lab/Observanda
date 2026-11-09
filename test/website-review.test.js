import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,readdir,rm} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../src/storage.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {websiteFilesHttp} from '../src/website-files-http.js';

const author={kind:'user',label:'ada'},reviewer={kind:'user',label:'grace'};
async function fixture(t){
 const area=await mkdtemp(path.join(os.tmpdir(),'observanda-review-')),root=path.join(area,'workspace'),folder=path.join(area,'published');
 await mkdir(path.join(root,'.observanda'),{recursive:true});await mkdir(folder);
 t.after(async()=>{await closeIdleMutationFiles();await rm(area,{recursive:true,force:true,maxRetries:8,retryDelay:150});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
 workspace.catalogue=()=>assert.fail('Website review opened the research catalogue');
 const request=async(operation,data={},actor=author)=>{let answer;await websiteFilesHttp({method:'POST',headers:{}},new EventEmitter(),{workspace,actor,url:new URL('/api/website-files/'+operation,'http://localhost'),body:async()=>data,check:async()=>{},json:value=>{answer=value;}});return answer;};
 const created=await request('create',{name:'Plankton atlas'}),siteId=created.site.id;
 return {folder,created,call:(operation,data,actor)=>request(operation,{siteId,...data},actor)};
}

test('an approval belongs to one saved edition, becomes stale after a change and gates publication only when required',async t=>{
 const {folder,created,call}=await fixture(t);
 let site=created.site;
 const publishFolder=async edition=>{
  const plan=await call('folder/plan',{expectedRevision:site.revision,directory:folder,...(edition?{edition}:{})});
  return call('folder/apply',{expectedRevision:site.revision,directory:folder,id:plan.id,reviewed:true});
 };
 let review=await call('review/read',{expectedRevision:site.revision});
 assert.equal(review.settings.requireApproval,false);assert.deepEqual(review.requests,[]);assert.equal(review.approved,false);

 // Without a required approval, a single author publishes without any review.
 assert.equal((await publishFolder()).state,'completed');

 review=await call('review/settings',{expectedRevision:site.revision,requireApproval:true});assert.equal(review.settings.requireApproval,true);
 let saved=await call('save',{expectedRevision:site.revision,path:'index.html',html:created.html.replace('</main>','<figure><figcaption>Copepod counts</figcaption></figure></main>'),css:''});site=saved.site;
 await assert.rejects(publishFolder(),{code:'WEBSITE_APPROVAL_REQUIRED'});

 review=await call('review/request',{expectedRevision:site.revision,note:'Please check the figure caption.',reviewers:['grace','grace',' ']});
 const request=review.requests[0];assert.equal(request.state,'open');assert.deepEqual(request.reviewers,['grace']);assert.equal(request.releaseId,review.releaseId);
 assert.equal(request.files,undefined,'The stored file inventory is not sent to the editor');

 // A comment anchors to an element address and stores only the reviewer's words.
 review=await call('review/comment',{expectedRevision:site.revision,path:'index.html',anchor:{path:'0/1',tag:'figure',fingerprint:'a'.repeat(64)},body:'Add the sampling depth to this caption.'},reviewer);
 const comment=review.comments[0];assert.equal(comment.request,request.id);assert.equal(comment.anchor.path,'0/1');assert.equal(review.openOnPage,1);
 assert.doesNotMatch(JSON.stringify(comment),/Copepod/);
 review=await call('review/assign',{expectedRevision:site.revision,id:comment.id,assignee:'ada'},reviewer);assert.equal(review.comments[0].assignee,'ada');
 review=await call('review/reply',{expectedRevision:site.revision,id:comment.id,body:'Added 0–50 m.'});assert.equal(review.comments[0].replies.length,1);

 // Requesters cannot approve their own edition when both are identified.
 review=await call('review/decide',{expectedRevision:site.revision,id:request.id,decision:'approved',note:''});
 assert.equal(review.requests[0].state,'approved');assert.equal(review.approved,false);
 await assert.rejects(publishFolder(),{code:'WEBSITE_APPROVAL_REQUIRED'});

 // The corrected edition is requested again and approved by the reviewer.
 saved=await call('save',{expectedRevision:site.revision,path:'index.html',html:saved.html.replace('Copepod counts','Copepod counts, 0–50 m'),css:''});site=saved.site;
 review=await call('review/read',{expectedRevision:site.revision});assert.equal(review.requests[0].stale,true);
 await assert.rejects(call('review/decide',{expectedRevision:site.revision,id:request.id,decision:'approved',note:''},reviewer),{code:'STALE'});
 const changes=await call('review/changes',{expectedRevision:site.revision,id:request.id});
 assert.equal(changes.current,false);assert.ok(changes.changes.samples.changed.includes('index.html'));
 review=await call('review/request',{expectedRevision:site.revision,note:'Caption corrected.',reviewers:['grace']});
 const second=review.requests[0];
 review=await call('review/decide',{expectedRevision:site.revision,id:second.id,decision:'approved',note:'Looks right.'},reviewer);
 assert.equal(review.approved,true);
 review=await call('review/resolve',{expectedRevision:site.revision,id:comment.id},reviewer);assert.equal(review.openComments,0);
 assert.equal((await publishFolder()).state,'completed');

 // Any later change invalidates the approval for publication.
 saved=await call('save',{expectedRevision:site.revision,path:'index.html',html:saved.html.replace('0–50 m','0–40 m'),css:''});site=saved.site;
 review=await call('review/read',{expectedRevision:site.revision});assert.equal(review.approved,false);assert.equal(review.requests[0].stale,true);
 await assert.rejects(publishFolder(),{code:'WEBSITE_APPROVAL_REQUIRED'});

 // Withdrawal is never blocked by the approval gate.
 assert.equal((await publishFolder('withdrawal')).state,'completed');
 assert.deepEqual((await readdir(folder)).sort(),['index.html','publication.json']);

 await assert.rejects(call('review/comment',{expectedRevision:site.revision,anchor:{path:'../0',tag:'p',fingerprint:null},body:'x'}),{code:'INVALID'});
 await assert.rejects(call('review/decide',{expectedRevision:site.revision,id:second.id,decision:'merged',note:''},reviewer),error=>['INVALID','STALE'].includes(error.code));
});

test('a single workspace author can approve an edition without a second identity',async t=>{
 const {created,call}=await fixture(t),local={kind:'workspace'};
 const site=created.site;
 await call('review/settings',{expectedRevision:site.revision,requireApproval:true},local);
 const review=await call('review/request',{expectedRevision:site.revision,note:'',reviewers:[]},local);
 const approved=await call('review/decide',{expectedRevision:site.revision,id:review.requests[0].id,decision:'approved',note:''},local);
 assert.equal(approved.approved,true);
});
