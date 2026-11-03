import {test,expect} from '@playwright/test';
import {EventEmitter} from 'node:events';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../../src/storage.js';
import {websiteFilesHttp} from '../../src/website-files-http.js';
import {defaultPublishing} from '../../src/publishing.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {githubFixture} from '../github-fixture.js';
import {mountFilesEditor} from './mount-files-editor.js';

test('the saved editor resumes a GitHub transfer, displays its receipt after reopen, and verifies the served website independently',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-editor-remote-')),id=randomUUID();
 try{
  await mkdir(path.join(directory,'.observanda'));
  const workspace=new Workspace(directory,{id,key:randomBytes(32)}),remote=githubFixture({branch:'main',initialFiles:{'README.md':'Keep this reference'}});
  workspace.catalogue=()=>{throw Error('The editor opened a research database');};
  const requests=[],request=async(route,data={})=>{
   requests.push(route);let answer;
   await websiteFilesHttp({method:'POST',headers:{}},new EventEmitter(),{url:new URL(route,'https://website.test'),workspace,contextId:id,title:'Research offline',body:async()=>data,check:async()=>{},preparation:async()=>({state:'ready'}),json:value=>{answer=value;},publisherOptions:{request:remote.request,liveRequest:remote.request,connection:{summary:()=>({connected:true}),token:()=> 'synthetic-token'}}});
   return answer;
  };
  const {site}=await request('/api/website-files/create',{name:'Field atlas'}),config=defaultPublishing();
  config.publicUrl='https://public.example/research/';Object.assign(config.github,{owner:'example',repository:'notebook',directory:'atlas',pages:false});
  await request('/api/website-files/destination/save',{siteId:site.id,config,etag:'new'});
  await page.exposeFunction('filesAPI',async(route,data)=>{try{return await request(route,data);}catch(error){return {errorCode:error.code??'PUBLISH_REMOTE',message:error.message};}});
  await mountFilesEditor(page);
  await page.getByRole('button',{name:'Publish update',exact:true}).click();
  const review=page.locator('[data-website-files-review]');
  await expect(review).toContainText('example/notebook / main / atlas');
  await expect(review.getByRole('button',{name:'Publish website'})).toBeDisabled();
  let lost=false;remote.setHook((row,phase)=>{if(!lost&&phase==='after'&&row.method==='PATCH'&&row.route.includes('/git/refs/heads/')){lost=true;throw Error('Synthetic lost acknowledgement');}});
  await review.getByRole('checkbox').check();await review.getByRole('button',{name:'Publish website'}).click();
  const transfer=page.locator('[data-website-files-transfer]');
  await expect(transfer).toContainText('has not confirmed the final result');
  remote.setHook(null);await transfer.getByRole('button',{name:'Resume reviewed transfer'}).click();
  await expect(transfer).toContainText(remote.head);
  await expect(transfer).toContainText('Repository files uploaded and verified');
  await page.reload();
  await page.getByRole('button',{name:'Publish update',exact:true}).click();
  await expect(transfer).toContainText(remote.head);
  expect(requests.filter(route=>route.endsWith('/plan'))).toHaveLength(1);
  await transfer.getByRole('button',{name:'Verify live website'}).click();
  await expect(transfer).toContainText('last live check failed');
  const manifest=[...remote.blobs.values()].find(bytes=>bytes.toString().includes('"generator": "Observanda"')||bytes.toString().includes('"generator":"Observanda"'));
  expect(manifest).toBeTruthy();remote.setManifest(manifest.toString());
  await transfer.getByRole('button',{name:'Verify live website'}).click();
  await expect(transfer).toContainText('live website is verified');
  expect(remote.calls.filter(row=>row.method==='PATCH'&&row.route.includes('/git/refs/heads/'))).toHaveLength(1);
 }finally{
  await page.close();await closeIdleMutationFiles();await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:150});
 }
});
