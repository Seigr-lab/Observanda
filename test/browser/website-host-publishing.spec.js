import {test,expect} from '@playwright/test';
import {EventEmitter} from 'node:events';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../../src/storage.js';
import {websiteFilesHttp} from '../../src/website-files-http.js';
import {HostCredentials} from '../../src/host-credentials.js';
import {serverLoginRequest} from '../../src/server-login-requests.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {memoryHost} from '../remote-host-fixture.js';
import {mountFilesEditor} from './mount-files-editor.js';

// Shared hosting from the website editor. The server login is set up once for
// the workspace with its password on this computer; each website chooses that
// login and its own folder, so two websites publish to one server side by side.
test('websites publish to one FTPS server login, each into its own folder, with the password kept off the workspace',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-host-publishing-')),id=randomUUID();
 try{
  await mkdir(path.join(directory,'.observanda'));
  const workspace=new Workspace(directory,{id,key:randomBytes(32)}),host=memoryHost(),passwords=[];
  workspace.catalogue=()=>{throw Error('The editor opened a research database');};
  const ftp={open:async(c,options)=>{passwords.push([c.host,c.security,options.password]);return host.transport.open(c,options);}};
  const hostCredentials=new HostCredentials({file:path.join(directory,'computer-preferences.json.host-credentials.json'),deviceStore:{available:()=>false}});
  const request=async(route,data={})=>{
   if(route.startsWith('/api/server-logins/'))return serverLoginRequest(route.slice('/api/server-logins/'.length),data,{workspace,hostCredentials,ftp});
   let answer;
   await websiteFilesHttp({method:'POST',headers:{}},new EventEmitter(),{url:new URL(route,'https://website.test'),workspace,contextId:id,title:'Research offline',body:async()=>data,check:async()=>{},preparation:async()=>({state:'ready'}),json:value=>{answer=value;},publisherOptions:{ftp,hostCredentials}});
   return answer;
  };
  // Preferences → Integrations: one server login, its password on this computer.
  let logins=await request('/api/server-logins/save',{login:{name:'Shared hosting',protocol:'ftp',host:'shared.example',port:21,user:'account',security:'explicit'},etag:'new'});
  const login=logins.logins[0];logins=await request('/api/server-logins/password',{id:login.id,password:'host secret'});
  expect(logins.logins[0].password).toEqual({saved:true,persistent:false});expect(JSON.stringify(logins).includes('host secret')).toBe(false);
  const {site}=await request('/api/website-files/create',{name:'Field atlas'});
  await page.exposeFunction('filesAPI',async(route,data)=>{try{return await request(route,data);}catch(error){return {errorCode:error.code??'PUBLISH_REMOTE',message:error.message};}});
  await mountFilesEditor(page);
  await page.getByRole('button',{name:'Publish update',exact:true}).click();
  await page.getByRole('button',{name:'Publishing destination',exact:true}).click();
  const form=page.locator('.website-files-publish');
  await form.getByLabel('Publishing destination').selectOption('ftp');
  await form.getByLabel('Server login').selectOption(login.id);
  await expect(form.getByRole('note')).toHaveCount(0);
  await form.getByLabel("This website's folder on the server").fill('/public_html/atlas');
  await form.getByRole('button',{name:'Save destination',exact:true}).click();
  await form.getByRole('button',{name:'Review publication',exact:true}).click();
  const review=page.locator('[data-website-files-review]');
  await expect(review).toContainText('Shared hosting · account@shared.example:/public_html/atlas');
  await expect(review.getByRole('button',{name:'Publish website'})).toBeDisabled();
  await review.getByRole('checkbox').check();await review.getByRole('button',{name:'Publish website'}).click();
  const transfer=page.locator('[data-website-files-transfer]');
  await expect(transfer).toContainText('Remote publication confirmed');await expect(transfer).not.toContainText('SSH');
  expect(passwords).toEqual([['shared.example','explicit','host secret']]);
  expect(host.files.has('/public_html/atlas/index.html')).toBe(true);expect(host.files.has('/public_html/atlas/.observanda-owner')).toBe(true);
  expect([...host.directories].some(name=>name.includes('/.observanda-upload-'))).toBe(false);
  // A second website uses the same login with its own folder and its own record.
  const second=(await request('/api/website-files/create',{name:'Bee yard diary'})).site,config=structuredClone((await request('/api/website-files/destination',{siteId:site.id})).config);
  config.ftp={...config.ftp,directory:'/public_html/diary'};
  const secondSaved=await request('/api/website-files/destination/save',{siteId:second.id,config,etag:'new'});
  expect(secondSaved.server.name).toBe('Shared hosting');expect(secondSaved.config.ftp.login).toBe(login.id);
  expect((await request('/api/website-files/destination',{siteId:site.id})).config.ftp.directory).toBe('/public_html/atlas');
  expect(await readdir(path.join(directory,'.observanda','website-files','sites',site.id,'publication','publishing-remote-files'))).toHaveLength(1);
  await expect(readdir(path.join(directory,'.observanda','website-files','sites',second.id,'publication','publishing-remote-files'))).rejects.toThrow();
 }finally{
  await page.close();await closeIdleMutationFiles();await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:150});
 }
});
