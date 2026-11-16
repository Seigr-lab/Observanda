import {test,expect} from '@playwright/test';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {Publisher,defaultPublishing} from '../../src/publishing.js';
import {workspaceJobs} from '../../src/workspace-jobs.js';
import {websiteFilesHttp} from '../../src/website-files-http.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {repositoryFixture} from '../github-fixture.js';
import {mountFilesEditor} from './mount-files-editor.js';

const token='synthetic_github_token_1234567890';
// The website editor over a database workspace, its durable job worker and a
// synthetic GitHub account that owns example/notebook.
async function editor(page,remoteOptions){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-site-repository-ui-')),f=await encryptedFixture(directory,sampleNotebook()),remote=repositoryFixture(remoteOptions);
 const publisher=new Publisher(f.workspace.root,{request:remote.request},f.vault),jobs=workspaceJobs(f.workspace,publisher);await publisher.connect(token);jobs.worker.start();
 const request=async(route,data={})=>{let answer;
  await websiteFilesHttp({method:'POST',headers:{}},new EventEmitter(),{url:new URL(route,'https://website.test'),workspace:f.workspace,contextId:f.vault.id,title:'Field journal',body:async()=>data,check:async()=>{},preparation:async()=>({state:'ready'}),json:value=>{answer=value;},
   publisherOptions:{request:remote.request,liveRequest:remote.request,connection:{summary:()=>({connected:true}),token:()=>token,status:async()=>({available:true,connected:true,accounts:[],selected:null,signIn:null,error:null})}},
   repositoryJobs:{queue:()=>jobs.queue,wake:()=>jobs.worker.wake(),cancel:id=>jobs.worker.cancel(id)},
   githubAccount:async operation=>{if(operation!=='status')throw Object.assign(Error('Unavailable in this test'),{code:'INVALID'});answer={available:true,connected:true,accounts:['example'],selected:{id:'example',login:'example'},signIn:null,error:null};}});
  return answer;};
 const {site}=await request('/api/website-files/create',{name:'Field atlas'});
 await page.exposeFunction('filesAPI',async(route,data)=>{try{return await request(route,data);}catch(error){return {errorCode:error.code??'PUBLISH_REMOTE',message:error.message};}});
 const close=async()=>{await jobs.worker.stop();await closeIdleMutationFiles();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:150});};
 return {remote,request,site,close};
}
// From the destination panel, Review publication leads to the same reviewed transfer.
async function publish(page){
 await page.getByRole('button',{name:'Review publication',exact:true}).click();
 const review=page.locator('[data-website-files-review]');await expect(review).toContainText('example/notebook / main');
 await review.getByRole('checkbox').check();await review.getByRole('button',{name:'Publish website'}).click();
 await expect(page.locator('[data-website-files-transfer]')).toContainText('Repository files uploaded and verified',{timeout:60000});
}

test('an empty GitHub repository is initialized from the website editor, then the website is published to it',async({page})=>{
 test.setTimeout(120000);const e=await editor(page,{exists:true,defaultBranch:'master'});
 try{
  const config=defaultPublishing();Object.assign(config.github,{owner:'example',repository:'notebook',branch:'main',pages:false});
  await e.request('/api/website-files/destination/save',{siteId:e.site.id,config,etag:'new'});
  await mountFilesEditor(page);
  // Publishing to an empty repository opens the destination, ready to give it a first commit.
  await page.getByRole('button',{name:'Publish update',exact:true}).click();
  const panel=page.locator('[data-website-files-repository]');
  await expect(panel).toContainText('This repository is empty.');
  await panel.getByRole('button',{name:'Check repository',exact:true}).click();
  await expect(panel).toContainText('example/notebook is empty. Observanda will add one empty .nojekyll file and use main as the website branch.');
  const initialize=panel.getByRole('button',{name:'Initialize repository',exact:true});await expect(initialize).toBeDisabled();
  expect(e.remote.calls.some(call=>call.method!=='GET')).toBe(false);
  await panel.getByRole('checkbox',{name:'Initialize example/notebook for this website',exact:true}).check();await initialize.click();
  await expect(panel).toContainText('The repository is ready.',{timeout:30000});
  expect(e.remote.calls.filter(call=>call.route.endsWith('/contents/.nojekyll'))).toHaveLength(1);
  await publish(page);
  expect(e.remote.calls.some(call=>call.route.endsWith('/pages'))).toBe(false);
 }finally{await page.close();await e.close();}
});

test('a new GitHub repository is created from the website editor and the website is published to it',async({page})=>{
 test.setTimeout(120000);const e=await editor(page);
 try{
  await mountFilesEditor(page);
  const menu=page.locator('[data-website-site-menu]');if(!await menu.evaluate(node=>node.open))await menu.locator('summary').click();
  await menu.getByRole('button',{name:'Publishing destination',exact:true}).click();
  const destination=page.locator('.website-files-publish');
  await destination.locator('[data-website-file-field="owner"]').fill('example');await destination.locator('[data-website-file-field="repository"]').fill('notebook');
  const panel=page.locator('[data-website-files-repository]');
  await expect(panel).toContainText('Observanda can create example/notebook on GitHub');
  await panel.getByLabel('Who can see the repository',{exact:true}).selectOption('public');
  await panel.getByRole('checkbox',{name:'Create example/notebook on GitHub',exact:true}).check();
  await panel.getByRole('button',{name:'Create repository',exact:true}).click();
  await expect(panel).toContainText('The repository is ready.',{timeout:30000});
  expect(e.remote.calls.filter(call=>call.route==='/user/repos'&&call.data.private===false)).toHaveLength(1);
  const saved=await e.request('/api/website-files/destination',{siteId:e.site.id});expect(saved.configured).toBe(true);expect(saved.config.github.branch).toBe('main');
  await publish(page);
 }finally{await page.close();await e.close();}
});
