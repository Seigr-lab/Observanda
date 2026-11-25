import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {websiteLibraryState,websiteWithRecords} from './website-preparation-helper.js';
import {navigate} from './preferences-helper.js';

const column=(name,representation='text')=>({name,representation,radix:10,unit:'',missing:[{value:'',meaning:'Not acquired'}],time:{kind:'unknown',reference:'',resolution:'',uncertainty:''}});

test('a placed result whose analysis inputs changed must be reviewed before the website is written to a folder',async({page})=>{
 test.setTimeout(180000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-analysis-review-ui-')),destination=path.join(directory,'site'),book=upgradeNotebook(sampleNotebook()),record=book.entries[0];
 record.share=true;const f=await encryptedFixture(directory,book),m=new ResearchMaterials(f.workspace);await mkdir(destination);
 const bytes=Buffer.from('Value,State\n10,correct\n12,mismatched'),upload=await m.startImport({recordId:record.id,name:'readings.csv',size:bytes.length});
 await m.appendImport(upload.id,0,[bytes]);const artifact=await m.finishImport(upload.id),columns=[column('Value','integer'),column('State')];
 const dataset=await m.dataset({recordId:record.id,title:'Run observations',artifact,columns});
 const analysis=await m.analysis({recordId:record.id,title:'Signal calculation',inputs:[dataset],tool:'Synthetic calculator',version:'1',parameters:'None',outputs:[]});
 const saved=await f.workspace.read(),entry=saved.book.entries.find(item=>item.id===record.id);
 entry.results={version:1,statements:[{id:randomUUID(),kind:'conclusion',basis:'retained',title:'Signal result',text:'One of two readings matched.',limitations:'Synthetic readings only.',source:{kind:'analysis',id:analysis.id,revision:analysis.revision}}]};
 await f.workspace.save(saved.book,saved.etag);
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json'),folderPicker:{capabilities:async()=>({mode:'native'}),choose:async()=>({folder:destination})}});
 try{
  await page.goto(app.url);await page.getByRole('button',{name:'Menu',exact:true}).waitFor({state:'visible'});
  await expect.poll(async()=>await websiteLibraryState(f.workspace),{timeout:60000}).toBe('ready');
  await websiteWithRecords(f.workspace,book,[record]);
  // The dataset moves on after the result was written.
  await m.dataset({recordId:record.id,title:'Run observations',id:dataset.id,expectedRevision:dataset.revision,artifact,baseDataset:dataset,columnChanges:[{index:0,column:{...columns[0],unit:'count'}}]});
  await navigate(page,'Publishing');const files=page.locator('[data-website-files-app]');
  await files.getByRole('button',{name:'Return to editing',exact:true}).click({timeout:60000});
  await files.getByRole('button',{name:'Publish to folder',exact:true}).click({timeout:60000});
  const panel=files.locator('[data-folder-review-panel]'),write=panel.getByRole('button',{name:'Write reviewed files',exact:true});
  await panel.getByRole('button',{name:'Choose folder',exact:true}).click();await panel.getByRole('button',{name:'Review file changes',exact:true}).click();
  const review=panel.locator('[data-website-analysis-review]');
  await expect(review.getByRole('alert')).toHaveText('Analyses to review before publishing: 1',{timeout:60000});
  await expect(review.getByRole('listitem')).toContainText('Signal result');await expect(review.getByRole('listitem')).toContainText('Inputs changed since the cited revision: 1 (Run observations)');
  await page.screenshot({path:test.info().outputPath('analysis-review.png')});
  // Approving the file changes alone is not enough while analysis changes are unreviewed.
  await panel.getByLabel('I have reviewed this pinned edition and approve these file additions, updates and removals in the selected folder.').check();await expect(write).toBeDisabled();
  await review.getByLabel('I have reviewed these analysis changes',{exact:true}).check();await expect(write).toBeEnabled();
  await review.getByLabel('I have reviewed these analysis changes',{exact:true}).uncheck();await expect(write).toBeDisabled();
  await review.getByLabel('I have reviewed these analysis changes',{exact:true}).check();await write.click();
  await expect(panel.getByText('Edition written and verified.',{exact:true})).toBeVisible({timeout:60000});
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
