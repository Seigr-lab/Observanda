import {test,expect} from '@playwright/test';
import path from 'node:path';
import {sshFixture} from '../ssh-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {Publisher,defaultPublishing} from '../../src/publishing.js';
import {startServer} from '../../src/server.js';
import {navigate} from './preferences-helper.js';

test('SSH publishing exposes uncertain switching and resume in the actual app',async({page})=>{
 test.setTimeout(90000);const cleanup=[],remote=await sshFixture({after:fn=>cleanup.push(fn)}),f=await encryptedFixture(remote.directory,sampleNotebook()),publisher=new Publisher(f.workspace.root,{ssh:remote.host},f.vault),config=defaultPublishing();config.kind='ssh';config.ssh=remote.config;config.publicUrl='https://synthetic.example/';await publisher.save(config,'new');
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(remote.directory,'preferences.json'),publishingOptions:{ssh:remote.host}}),errors=[];page.on('pageerror',e=>errors.push(e.message));let lost=false;
 remote.setHook((call,phase)=>{if(!lost&&phase==='after'&&call.args.at(-1).includes('mv -Tf')){lost=true;throw Error('Switch acknowledgement lost');}});
 try{
  await page.goto(app.url);await navigate(page,'Publishing');await page.getByRole('button',{name:'Review website',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition'}).click();
  try{await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible({timeout:30000});}
  catch(error){if(await page.getByRole('button',{name:'Private failure details',exact:true}).isVisible()){await page.getByRole('button',{name:'Private failure details',exact:true}).click();await expect(page.locator('.job-diagnostics')).toBeVisible();console.log('SYNTHETIC_PREPARATION_FAILURE',await page.locator('.job-diagnostics').textContent());}throw error;}
  await page.getByLabel('I have reviewed this website and its media for sharing.').check();await page.getByRole('button',{name:'Publish to SSH hosting'}).click();const pane=page.locator('#publishing-deployments');await expect(pane).toContainText('Switch: outcome unconfirmed',{timeout:20000});await expect(pane.getByRole('button',{name:'Resume / reconcile'})).toBeVisible();
  const uploads=remote.calls.filter(c=>c.program==='sftp').length;remote.setHook(null);await pane.getByRole('button',{name:'Resume / reconcile'}).click();await expect(pane).toContainText('Switch: confirmed',{timeout:15000});await expect(pane.getByRole('button',{name:'Resume / reconcile'})).toHaveCount(0);await expect(pane).toContainText('Live website: not verified');expect(remote.calls.filter(c=>c.program==='sftp').length).toBe(uploads);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);for(const fn of cleanup)await fn();}
});
