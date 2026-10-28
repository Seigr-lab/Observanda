import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {githubFixture} from '../github-fixture.js';
import {navigate} from './preferences-helper.js';

for(const count of [42,420])test('saved publication, destination and review remain independent of '+count+' private records',async({page})=>{
 const began=Date.now(),journeyTimeout=300000;test.setTimeout(journeyTimeout);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-publication-outline-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'PRIVATE_TITLE_'+i,body:'PRIVATE_BODY_'+i,share:false,attachments:[],figures:[],relations:[],sections:[]}));
 Object.assign(book.entries[2],{share:true,title:'Selected field observation',body:'This is the approved public text.'});
 const f=await encryptedFixture(directory,book),remote=githubFixture({branch:'main',initialFiles:{'.nojekyll':''}}),app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json'),publishingOptions:{request:remote.request}});
 const read=ResearchCatalogue.prototype.read,manifest=ResearchCatalogue.prototype.manifest,record=ResearchCatalogue.prototype.record,loaded=[],requests=[],errors=[],deploymentReplies=[],observedAt=Date.now();
 let deploymentId=null;
 ResearchCatalogue.prototype.read=ResearchCatalogue.prototype.manifest=()=>{throw Error('Publication requested the complete book');};
 ResearchCatalogue.prototype.record=function(id,...args){expect(id).toBe(book.entries[2].id);loaded.push(id);return record.call(this,id,...args);};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push({path:new URL(r.url()).pathname,data:r.postDataJSON()});});
 page.on('response',async response=>{if(!['/api/publishing/deploy','/api/deployment-jobs/list'].includes(new URL(response.url()).pathname))return;try{const body=await response.json();if(body.job?.type==='publication.deploy')deploymentId=body.job.id;deploymentReplies.push({elapsed:Date.now()-observedAt,status:response.status(),body});if(deploymentReplies.length>40)deploymentReplies.shift();}catch{/* A disconnected response is recorded by the request itself. */}});
 try{
  await page.goto(app.url);await navigate(page,'Publishing');await page.getByRole('button',{name:'Configure destination',exact:true}).click();
  await page.getByLabel('GitHub owner / organization',{exact:true}).fill('example');await page.getByLabel('Repository name',{exact:true}).fill('notebook');
  let finishSave,saving;const savedReply=new Promise(r=>finishSave=r),saveStarted=new Promise(r=>saving=r);
  await page.route('**/api/publishing/save',async route=>{const response=await route.fetch();saving();await savedReply;await route.fulfill({response});},{times:1});
  await page.getByLabel('After upload',{exact:true}).selectOption('upload');await page.getByRole('button',{name:'Save destination',exact:true}).click();await saveStarted;
  await page.getByText('Advanced: temporary access token',{exact:true}).click();await page.getByLabel('GitHub token',{exact:true}).fill('synthetic_github_token_1234567890');finishSave();
  await expect(page.locator('#destination-status')).toContainText('Destination saved');await expect(page.getByLabel('Repository',{exact:true})).toHaveCount(0);await expect(page.getByLabel('GitHub token',{exact:true})).toHaveValue('synthetic_github_token_1234567890');await page.getByRole('button',{name:'Connect GitHub',exact:true}).click();await expect(page.locator('#notice')).toContainText('Connected to GitHub');
  await page.getByRole('button',{name:'Check connection',exact:true}).click();await expect(page.locator('#publish-outcome')).toContainText('Upload only');
  await navigate(page,'Publishing');expect(loaded).toEqual([]);
  // A failed preparation stays in its workflow and can be retried directly.
  await page.route('**/api/publication-jobs/start',r=>r.fulfill({status:503,json:{message:'Synthetic preparation interruption'}}),{times:1});
  await page.getByRole('button',{name:'Review website',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.locator('#publication-jobs-status')).toContainText('Synthetic preparation interruption');await expect(page.getByRole('button',{name:'Recover preparation status',exact:true})).toBeVisible();await page.getByRole('button',{name:'Continue working',exact:true}).click();
  let finishStart,preparing;const startReply=new Promise(r=>finishStart=r),startArrived=new Promise(r=>preparing=r);
  await page.route('**/api/publication-jobs/start',async route=>{const response=await route.fetch();preparing();await startReply;await route.fulfill({response});},{times:1});
  await page.getByRole('button',{name:'Review website',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await startArrived;
  await page.getByRole('button',{name:'Continue working',exact:true}).click();const startDelivered=page.waitForResponse('**/api/publication-jobs/start');finishStart();await startDelivered;
  await expect(page.getByRole('heading',{name:'Publishing',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Website preparations',exact:true}).click();await expect(page.getByRole('button',{name:'Open review',exact:true})).toBeVisible({timeout:30000});await page.getByRole('button',{name:'Open review',exact:true}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible();
  const reviewUrl=page.url();await expect(page.frameLocator('.preview-frame').locator('body')).not.toContainText('PRIVATE_');
  await page.getByLabel('I have reviewed this website and its media for sharing.').check();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download website ZIP',exact:true}).click();
  const bytes=await readFile(await (await downloading).path());expect(bytes.includes(Buffer.from('This is the approved public text.'))).toBe(true);expect(bytes.includes(Buffer.from('PRIVATE_'))).toBe(false);expect(bytes.includes(Buffer.from(f.workspace.root))).toBe(false);
  await page.getByRole('button',{name:'Back to publishing',exact:true}).click();await expect(page.getByRole('heading',{name:'Publishing',exact:true})).toBeVisible();
  await page.goto(reviewUrl);await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible();await expect(page.getByLabel('I have reviewed this website and its media for sharing.')).not.toBeChecked();
  const planned=page.waitForResponse('**/api/publishing/plan');
  const reviewedPlan=page.waitForResponse(async response=>new URL(response.url()).pathname==='/api/publishing/plan-operation'&&response.ok()&&Boolean((await response.json()).plan),{timeout:60000});
  await page.getByLabel('I have reviewed this website and its media for sharing.').check();await page.getByRole('button',{name:'Publish to GitHub repository',exact:true}).click();const planResponse=await planned;expect(planResponse.ok(),await planResponse.text()).toBe(true);
  await expect(page.getByRole('heading',{name:'Review repository changes',exact:true})).toBeVisible();
  const deployed=page.waitForResponse(async response=>new URL(response.url()).pathname==='/api/deployment-jobs/list'&&response.ok()&&(await response.json()).items.some(item=>item.job.type==='publication.deploy'&&['completed','failed','cancelled'].includes(item.job.state)),{timeout:Math.max(1,journeyTimeout-(Date.now()-began)-2000)});
  if((await (await reviewedPlan).json()).plan.requiresReview){await page.getByLabel('I approve these repository changes for this website.').check();await page.getByRole('button',{name:'Publish to GitHub repository',exact:true}).click();}
  const terminal=(await (await deployed).json()).items.find(item=>item.job.type==='publication.deploy');expect(terminal.job.state,JSON.stringify(terminal.job)).toBe('completed');
  await expect(page.locator('#publishing-deployments')).toContainText('Repository files verified. Pages settings were left unchanged.');
  expect(remote.head).toBeTruthy();expect(remote.calls.some(c=>c.route.endsWith('/pages'))).toBe(false);
  for(const blob of remote.blobs.values())expect(blob.includes(Buffer.from('PRIVATE_'))).toBe(false);
  // A late open reply must not pull someone back out of the current screen.
  await page.getByRole('button',{name:'Website preparations',exact:true}).click();await expect(page.getByRole('button',{name:'Open review',exact:true})).toBeVisible();
  let release,arrived;const held=new Promise(r=>release=r),started=new Promise(r=>arrived=r);
  await page.route('**/api/publication-jobs/open',async route=>{const response=await route.fetch();arrived();await held;await route.fulfill({response});},{times:1});
  await page.getByRole('button',{name:'Open review',exact:true}).click();await started;await page.getByRole('button',{name:'Continue working',exact:true}).click();
  const delivered=page.waitForResponse('**/api/publication-jobs/open');release();await delivered;await expect(page.getByRole('heading',{name:'Publishing',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Website preparations',exact:true}).click();await page.getByRole('button',{name:'Open review',exact:true}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='21px');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:test.info().outputPath('saved-edition-review.png'),fullPage:true});
  await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:book.entries[2].id,expectedRevision:recordRevision(book.entries[2]),record:{...book.entries[2],title:'Later edition'}}]},{recordIds:[book.entries[2].id]});
  await page.reload();await expect(page.getByRole('button',{name:'Download website ZIP',exact:true})).toBeDisabled();await expect(page.locator('main')).toContainText('The workspace or publishing destination has changed since this edition was prepared.');
  expect(requests.filter(r=>['/api/notebook','/api/workspace/read/page','/api/design-preview'].includes(r.path))).toEqual([]);
  for(const request of requests.filter(r=>r.path==='/api/publication-jobs/start')){expect(request.data.commandId).toMatch(/^[a-f0-9-]{36}$/);expect(request.data.etag).toBeTruthy();expect(request.data).not.toHaveProperty('book');expect(request.data).not.toHaveProperty('draft');}
  expect(loaded.every(id=>id===book.entries[2].id)).toBe(true);expect(errors).toEqual([]);
 }catch(error){
  const id=deploymentId;
  let deadline;const database=await Promise.race([f.workspace.catalogue(async store=>({job:id?JSON.parse(await f.workspace.readMetadata('.observanda/jobs/'+id+'.json',1048576)):null,activity:await store.db.all("SELECT state,wait_event_type,wait_event FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()")})).catch(failure=>({error:failure.code??failure.message})),new Promise(resolve=>{deadline=setTimeout(()=>resolve({unavailable:'Diagnostic read did not finish within three seconds.'}),3000);})]);clearTimeout(deadline);
  const state=JSON.stringify({errors,deploymentReplies,database,remoteCalls:remote.calls.map(({route,method})=>({route,method})),body:await page.locator('body').innerText()},null,2);
  await writeFile(test.info().outputPath('outline-state.json'),state);await test.info().attach('outline-state',{body:state,contentType:'application/json'});throw error;
 }finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.manifest=manifest;ResearchCatalogue.prototype.record=record;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
