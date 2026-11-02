import {test,expect} from '@playwright/test';
import {randomBytes,randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,readFile,rm,unlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../../src/storage.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {websiteFilesHttp} from '../../src/website-files-http.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {mountFilesEditor} from './mount-files-editor.js';

test('folder export reviews human-readable changes and binds keyboard approval to the current destination and plan',async({page},info)=>{
 test.setTimeout(90000);
 const base=await mkdtemp(path.join(os.tmpdir(),'observanda-folder-review-')),root=path.join(base,'workspace'),destination=path.join(base,'Coastal field guide');
 try{
  await mkdir(path.join(root,'.observanda'),{recursive:true});await mkdir(destination);
  const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});workspace.catalogue=workspace.storageKind=()=>{throw Error('Folder publishing attempted to read research');};
  const store=new WebsiteFileStore(workspace),id=randomUUID(),siteName='Coastal field guide',html=title=>'<!doctype html><html><head><title>'+title+'</title></head><body><main><h1>'+title+'</h1></main></body></html>';
  let saved=await store.importFiles(id,{name:siteName,files:new Map([['index.html',html('Coastal stations')],['old-notes.html',html('Old notes')],['style.css','main{display:block}']])});
  const calls=[];let chosen=0;
  async function call(op,data){
   calls.push(op);const res=new EventEmitter(),url=new URL('/api/website-files/'+op,'https://website.test');let result;
   await websiteFilesHttp({method:'POST',headers:{}},res,{workspace,url,title:siteName,contextId:'fixture',body:async()=>data??{},json:value=>{result=value;},check:async()=>{},preparation:async()=>({state:'ready',defaultSiteId:id}),folderPicker:{capabilities:async()=>({mode:'native'}),choose:async()=>++chosen===1?{cancelled:true}:{cancelled:false,folder:destination}}});
   return result;
  }
  const scope=()=>({siteId:id,expectedRevision:saved.site.revision});
  const initial=await call('folder/plan',{...scope(),directory:destination});await call('folder/apply',{...scope(),id:initial.id,reviewed:true});
  const published=new Map([['index.html',html('Coastal stations and methods')],['style.css','main{display:block}']]);
  for(const title of ['Sampling design','Temperature profiles','Tide pools','Rocky shore','Estuary survey','Observations'])published.set(title.toLowerCase().replaceAll(' ','-')+'.html',html(title));
  saved=await store.importFiles(id,{name:siteName,expectedRevision:saved.site.revision,files:published});
  const collision=path.join(destination,'sampling-design.html');await writeFile(collision,'Existing site-owner work',{flag:'wx'});
  await page.exposeFunction('filesAPI',(route,data)=>call(route.replace('/api/website-files/',''),data));await page.setViewportSize({width:1440,height:1000});await mountFilesEditor(page);
  for(const css of ['app','website','experience'])await page.addStyleTag({url:'/'+css+'.css'});
  await page.getByRole('button',{name:'Publish to folder',exact:true}).press('Enter');
  const input=page.getByLabel('Destination folder',{exact:true}),choose=page.getByRole('button',{name:'Choose folder'}),review=page.getByRole('button',{name:'Review file changes'}),panel=page.locator('[data-folder-plan]');
  await expect(review).toBeDisabled();await choose.press('Enter');await expect(input).toHaveValue('');await choose.press('Enter');await expect(input).toHaveValue(destination);
  await review.press('Enter');await expect(panel.getByRole('alert')).toBeVisible();await expect(panel.getByRole('checkbox')).toHaveCount(0);
  expect(await readFile(collision,'utf8')).toBe('Existing site-owner work');
  const capture=async name=>{const png=info.outputPath(name+'.png');await panel.screenshot({path:png});await info.attach(name,{path:png,contentType:'image/png'});};
  await capture('conflict-review');
  await panel.getByRole('button',{name:'Inspect conflict for Sampling design'}).press('Enter');
  await expect(panel.locator('details[open]').getByText('sampling-design.html',{exact:true})).toBeVisible();
  await unlink(collision);await review.press('Enter');const checkbox=panel.getByRole('checkbox'),write=panel.getByRole('button',{name:'Write reviewed files'});
  await expect(write).toBeDisabled();await expect(panel.getByText('Coastal stations and methods',{exact:true})).toBeVisible();
  await capture('folder-review');
  const file=panel.locator('details').filter({hasText:'Coastal stations and methods'});await file.locator('summary').press('Enter');
  await expect(file.getByText('index.html',{exact:true})).toBeVisible();await expect(file.getByText(/^SHA-256 /)).toHaveCount(2);
  await capture('file-details');
  await file.locator('summary').press('Enter');await expect(panel.locator('summary').filter({hasText:'old-notes.html'})).toBeVisible();
  await panel.getByRole('button',{name:'Next files'}).press('Enter');await expect(panel.getByText('Temperature profiles',{exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'Previous files'}).press('Enter');
  await checkbox.press('Space');await expect(write).toBeEnabled();await review.press('Enter');await expect(write).toBeDisabled();
  await checkbox.press('Space');await input.fill(path.join(base,'separate folder'));await expect(panel).toHaveCount(0);
  await input.fill(destination);await review.press('Enter');await expect(write).toBeDisabled();
  await checkbox.press('Space');await write.press('Enter');await expect(panel.getByText('Edition written and verified.',{exact:true})).toBeVisible();
  expect(await readFile(path.join(destination,'index.html'),'utf8')).toContain('Coastal stations and methods');await expect(readFile(path.join(destination,'old-notes.html'))).rejects.toMatchObject({code:'ENOENT'});
  expect(calls.filter(op=>op==='folder/apply')).toHaveLength(2);
 }finally{await closeIdleMutationFiles();if(path.dirname(base)!==path.resolve(os.tmpdir())||!path.basename(base).startsWith('observanda-folder-review-'))throw Error('Unexpected fixture directory');await rm(base,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
