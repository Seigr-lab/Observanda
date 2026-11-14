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
 test.setTimeout(90000);const cleanup=[],remote=await sshFixture({after:fn=>cleanup.push(fn)}),f=await encryptedFixture(remote.directory,sampleNotebook()),publisher=new Publisher(f.workspace.root,{ssh:remote.host},f.vault),config=defaultPublishing();config.kind='ssh';config.ssh=await remote.target(f.workspace);config.publicUrl='https://synthetic.example/';await publisher.save(config,'new');
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(remote.directory,'preferences.json'),publishingOptions:{ssh:remote.host}}),errors=[];page.on('pageerror',e=>errors.push(e.message));let lost=false;
 remote.setHook((call,phase)=>{if(!lost&&phase==='after'&&call.args.at(-1).includes('mv -Tf')){lost=true;throw Error('Switch acknowledgement lost');}});
 try{
  // Publishing → Review website opens this website's destination: the shared
  // SSH login and this website's folder.
  await page.goto(app.url);await navigate(page,'Publishing');
  const form=page.locator('.website-files-publish'),reviewWebsite=page.getByRole('button',{name:'Review website',exact:true});
  await form.or(reviewWebsite).first().waitFor();if(await reviewWebsite.isVisible())await reviewWebsite.click();
  await expect(form.getByLabel('Server login')).toHaveValue(config.ssh.login);
  await form.getByRole('button',{name:'Review publication',exact:true}).click();
  const review=page.locator('[data-website-files-review]');await expect(review).toContainText('Synthetic server · research@synthetic.example');
  await review.getByRole('checkbox').check();await review.getByRole('button',{name:'Publish website'}).click();
  const transfer=page.locator('[data-website-files-transfer]');
  await expect(transfer).toContainText('has not confirmed the final result',{timeout:30000});
  const uploads=remote.calls.filter(c=>c.program==='sftp').length;remote.setHook(null);
  await transfer.getByRole('button',{name:'Resume reviewed transfer'}).click();
  await expect(transfer).toContainText('Uploaded and verified on the SSH server',{timeout:30000});
  await expect(transfer.getByRole('button',{name:'Resume reviewed transfer'})).toHaveCount(0);
  expect(remote.calls.filter(c=>c.program==='sftp').length).toBe(uploads);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);for(const fn of cleanup)await fn();}
});
