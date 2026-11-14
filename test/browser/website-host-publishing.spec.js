import {test,expect} from '@playwright/test';
import {EventEmitter} from 'node:events';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../../src/storage.js';
import {websiteFilesHttp} from '../../src/website-files-http.js';
import {HostCredentials} from '../../src/host-credentials.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {memoryHost} from '../remote-host-fixture.js';
import {mountFilesEditor} from './mount-files-editor.js';

// Shared hosting from the website editor: the author chooses an FTPS host,
// enters its password once, reviews and publishes; the website lands in the
// host's web folder and the password is never shown again or stored in the site.
test('an author publishes a website to an FTPS host from the editor, with the password kept off the workspace',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-host-publishing-')),id=randomUUID();
 try{
  await mkdir(path.join(directory,'.observanda'));
  const workspace=new Workspace(directory,{id,key:randomBytes(32)}),host=memoryHost(),passwords=[];
  workspace.catalogue=()=>{throw Error('The editor opened a research database');};
  const ftp={open:async(c,options)=>{passwords.push([c.host,c.security,options.password]);return host.transport.open(c,options);}};
  const hostCredentials=new HostCredentials({file:path.join(directory,'computer-preferences.json.host-credentials.json'),deviceStore:{available:()=>false}});
  const request=async(route,data={})=>{
   let answer;
   await websiteFilesHttp({method:'POST',headers:{}},new EventEmitter(),{url:new URL(route,'https://website.test'),workspace,contextId:id,title:'Research offline',body:async()=>data,check:async()=>{},preparation:async()=>({state:'ready'}),json:value=>{answer=value;},publisherOptions:{ftp,hostCredentials}});
   return answer;
  };
  const {site}=await request('/api/website-files/create',{name:'Field atlas'});
  await page.exposeFunction('filesAPI',async(route,data)=>{try{return await request(route,data);}catch(error){return {errorCode:error.code??'PUBLISH_REMOTE',message:error.message};}});
  await mountFilesEditor(page);
  await page.getByRole('button',{name:'Publish update',exact:true}).click();
  await page.getByRole('button',{name:'Publishing destination',exact:true}).click();
  const form=page.locator('.website-files-publish');
  await form.getByLabel('Publishing destination').selectOption('ftp');
  await form.getByLabel('Server name').fill('shared.example');
  await form.getByLabel('User name').fill('atlas');
  await form.getByLabel('Website folder on the server').fill('/public_html');
  await expect(form.getByLabel('Connection')).toHaveValue('explicit');
  await form.getByLabel('Connection').selectOption('none');await expect(form.getByRole('note')).toContainText('Without encryption');
  await form.getByLabel('Connection').selectOption('explicit');await expect(form.getByRole('note')).toHaveCount(0);
  await expect(form).toContainText('Save the destination first, then enter its password.');
  await form.getByRole('button',{name:'Save destination',exact:true}).click();
  await form.getByLabel('Password',{exact:true}).fill('host secret');
  await form.getByRole('button',{name:'Use password',exact:true}).click();
  await expect(form).toContainText('The password is held until Observanda closes');
  await expect(form.getByLabel('Password',{exact:true})).toHaveValue('');
  expect(JSON.stringify(await request('/api/website-files/destination',{siteId:site.id})).includes('host secret')).toBe(false);
  await form.getByRole('button',{name:'Review publication',exact:true}).click();
  const review=page.locator('[data-website-files-review]');
  await expect(review.getByRole('button',{name:'Publish website'})).toBeDisabled();
  await review.getByRole('checkbox').check();await review.getByRole('button',{name:'Publish website'}).click();
  const transfer=page.locator('[data-website-files-transfer]');
  await expect(transfer).toContainText('Remote publication confirmed');
  await expect(transfer).not.toContainText('SSH');
  expect(passwords.every(([name,security,password])=>name==='shared.example'&&security==='explicit'&&password==='host secret')).toBe(true);
  expect([...host.files.keys()].some(name=>name==='/public_html/index.html')).toBe(true);
  expect([...host.files.keys()].some(name=>name==='/public_html/.observanda-owner')).toBe(true);
  expect([...host.directories].some(name=>name.startsWith('/public_html/.observanda-upload-'))).toBe(false);
  // Each website keeps its own destination and its own record of published
  // files; a second website can publish to a completely different server.
  const second=(await request('/api/website-files/create',{name:'Bee yard diary'})).site,config=structuredClone((await request('/api/website-files/destination',{siteId:site.id})).config);
  config.ftp={...config.ftp,host:'other.example',user:'diary',directory:'/www'};
  const secondSaved=await request('/api/website-files/destination/save',{siteId:second.id,config,etag:'new'});
  expect(secondSaved.config.ftp.host).toBe('other.example');expect(secondSaved.hostPassword).toEqual({saved:false,persistent:false});
  expect((await request('/api/website-files/destination',{siteId:site.id})).config.ftp.host).toBe('shared.example');
  expect((await request('/api/website-files/destination',{siteId:site.id})).hostPassword).toEqual({saved:true,persistent:false});
  expect(await readdir(path.join(directory,'.observanda','website-files','sites',site.id,'publication','publishing-remote-files'))).toHaveLength(1);
  await expect(readdir(path.join(directory,'.observanda','publishing-remote-files'))).rejects.toThrow();
  await expect(readdir(path.join(directory,'.observanda','website-files','sites',second.id,'publication','publishing-remote-files'))).rejects.toThrow();
 }finally{
  await page.close();await closeIdleMutationFiles();await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:150});
 }
});
