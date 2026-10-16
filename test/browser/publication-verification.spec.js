import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {Publisher,defaultPublishing} from '../../src/publishing.js';
import {buildPublication} from '../../src/publication.js';
import {digest,serialize} from '../../src/storage-format.js';
import {recordDeploymentInventory,prepareDeploymentInventory} from '../../src/publication-live.js';
import {startServer} from '../../src/server.js';
import {navigate} from './preferences-helper.js';

test('live checks can be stopped and resumed from Publishing and a failed recheck replaces success',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-live-ui-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),candidate=buildPublication(book),config=defaultPublishing();
 Object.assign(config.github,{owner:'example',repository:'notebook'});config.publicUrl='https://synthetic.example/';let mode='stall',reads=0;
 const request=async url=>{const name=new URL(url).pathname.slice(1);reads++;if(mode==='stall'&&name==='index.html')return new Response(new ReadableStream());if(name==='old.html')return new Response(mode==='cached'?'Old page':null,{status:mode==='cached'?200:404});return new Response(candidate.files.get(name));};
 const publisher=new Publisher(f.workspace.root,{request},f.vault);await publisher.save(config,'new');const key=publisher.destinationKey(config),receipt={commit:'a'.repeat(40),releaseId:candidate.id,manifestHash:digest(candidate.files.get('publication.json')),deploymentId:randomUUID()};
 const inventory=await prepareDeploymentInventory(f.workspace,key,candidate.files.keys(),{removed:['old.html']});
 await f.workspace.withLock(async()=>{await f.workspace.writeMetadata('.observanda/publishing-receipts.json',serialize({[key]:receipt}));await recordDeploymentInventory(f.workspace,key,receipt,inventory);});
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json'),publishingOptions:{request}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await navigate(page,'Publishing');await page.getByRole('button',{name:'Verify live website',exact:true}).click();await expect(page.getByRole('button',{name:'Stop live check'})).toBeVisible();await expect.poll(()=>reads).toBeGreaterThan(1);
  await page.getByRole('button',{name:'Stop live check'}).click();await expect(page.getByRole('button',{name:'Resume live check'})).toBeVisible();
  mode='ready';await page.getByRole('button',{name:'Resume live check'}).click();await expect(page.locator('#publish-outcome')).toContainText('removed URLs return not found',{timeout:15000});
  await page.getByRole('button',{name:'Configure destination',exact:true}).click();await page.getByLabel('Public website URL (HTTPS)',{exact:true}).fill('https://changed.example/');await page.getByRole('button',{name:'Save destination',exact:true}).click();await expect(page.locator('#notice')).toContainText('Publishing destination saved');await expect(page.locator('#publish-outcome')).not.toContainText('The live website is verified');
  await page.reload();await navigate(page,'Publishing');await expect(page.locator('#publish-outcome')).not.toContainText('The live website is verified');await page.getByRole('button',{name:'Verify live website',exact:true}).click();await expect(page.locator('#publish-outcome')).toContainText('removed URLs return not found',{timeout:15000});
  mode='cached';await page.getByRole('button',{name:'Verify live website',exact:true}).click();await expect(page.getByRole('button',{name:'Resume live check'})).toBeVisible();await expect(page.locator('#publish-outcome')).not.toContainText('The live website is verified');
  await page.reload();await expect(page.locator('#publish-outcome')).not.toContainText('The live website is verified');expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
