import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {websiteLibraryState,websiteWithRecords} from './website-preparation-helper.js';
import {executeResearchRequest} from '../../src/research-requests.js';
import {PublicationConversion} from '../../src/publication-conversion.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {navigate} from './preferences-helper.js';

test('the author updates a placed record from the lab book before writing the website to a folder',async({page})=>{
 test.setTimeout(180000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-updates-ui-')),destination=path.join(directory,'site'),book=upgradeNotebook(sampleNotebook()),record=book.entries[0];
 record.share=true;const f=await encryptedFixture(directory,book);await mkdir(destination);
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json'),folderPicker:{capabilities:async()=>({mode:'native'}),choose:async()=>({folder:destination})}});
 try{
  await page.goto(app.url);await page.getByRole('button',{name:'Menu',exact:true}).waitFor({state:'visible'});
  await expect.poll(async()=>await websiteLibraryState(f.workspace),{timeout:60000}).toBe('ready');
  await websiteWithRecords(f.workspace,book,[record]);
  // The author corrects the record's title in the lab book after the website placed it.
  const store=new WebsiteFileStore(f.workspace),conversion=new PublicationConversion(f.workspace,{store}),identity={workspaceId:book.id,recordId:record.id,field:'title'};
  const command=(name,data)=>executeResearchRequest(f.workspace,'/api/research/records/'+name,data,{publicationConversion:conversion});
  const title=await command('values/read',identity);await command('values/save',{...identity,expectedRevision:title.revision,value:{value:'Seeds unfold overnight'}});
  await navigate(page,'Publishing');const files=page.locator('#main[data-website-files-app]');
  await files.getByRole('button',{name:'Return to editing',exact:true}).click({timeout:60000});
  await files.getByRole('button',{name:'Publish to folder',exact:true}).click({timeout:60000});
  const panel=files.locator('[data-folder-review-panel]');
  await panel.getByRole('button',{name:'Choose folder',exact:true}).click();await panel.getByRole('button',{name:'Review file changes',exact:true}).click();
  const updates=panel.locator('[data-website-record-updates]');
  await expect(updates.getByRole('alert')).toHaveText('Placed records changed in the lab book since this website took its copy: 1',{timeout:60000});
  await expect(updates.getByRole('checkbox',{name:record.title})).toBeChecked();
  await page.screenshot({path:test.info().outputPath('record-updates.png')});
  await updates.getByRole('button',{name:'Update selected from the lab book',exact:true}).click();
  // Every page of the website that shows the record now holds the corrected copy.
  await expect.poll(async()=>{const {items}=await store.list();const pages=await Promise.all(items.map(site=>store.open(site.id)));return pages.some(opened=>opened.html.includes('Seeds unfold overnight'));},{timeout:60000}).toBe(true);
  await panel.getByRole('button',{name:'Review file changes',exact:true}).click();
  await expect(panel.locator('[data-website-record-updates]').getByRole('status').last()).toHaveText('The lab book records placed on this website have not changed since they were placed.',{timeout:60000});
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
