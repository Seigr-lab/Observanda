import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {Publisher} from '../../src/publishing.js';
import {workspaceJobs} from '../../src/workspace-jobs.js';
import {websiteFilesHttp} from '../../src/website-files-http.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';

export const githubToken='synthetic_github_token_1234567890';
// The website editor over a database workspace with its durable job worker,
// connected to a synthetic GitHub account that owns example/notebook.
export async function githubEditor(page,remote){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-editor-github-')),f=await encryptedFixture(directory,sampleNotebook());
 const publisher=new Publisher(f.workspace.root,{request:remote.request},f.vault),jobs=workspaceJobs(f.workspace,publisher);await publisher.connect(githubToken);jobs.worker.start();
 const request=async(route,data={})=>{let answer;
  await websiteFilesHttp({method:'POST',headers:{}},new EventEmitter(),{url:new URL(route,'https://website.test'),workspace:f.workspace,contextId:f.vault.id,title:'Field journal',body:async()=>data,check:async()=>{},preparation:async()=>({state:'ready'}),json:value=>{answer=value;},
   publisherOptions:{request:remote.request,liveRequest:remote.request,connection:{summary:()=>({connected:true}),token:()=>githubToken}},
   repositoryJobs:{queue:()=>jobs.queue,wake:()=>jobs.worker.wake(),cancel:id=>jobs.worker.cancel(id)},
   githubAccount:async operation=>{if(operation!=='status')throw Object.assign(Error('Unavailable in this test'),{code:'INVALID'});answer={available:true,connected:true,accounts:['example'],selected:{id:'example',login:'example'},signIn:null,error:null};}});
  return answer;};
 const {site}=await request('/api/website-files/create',{name:'Field atlas'});
 await page.exposeFunction('filesAPI',async(route,data)=>{try{return await request(route,data);}catch(error){return {errorCode:error.code??'PUBLISH_REMOTE',message:error.message};}});
 const close=async()=>{await jobs.worker.stop();await closeIdleMutationFiles();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:150});};
 return {request,site,close};
}
