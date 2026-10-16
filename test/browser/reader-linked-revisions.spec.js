import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {recordRevision} from '../../src/research.js';
import {RecordValues} from '../../src/record-values.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';

test('linked readers distinguish the displayed revision from an earlier retained reference',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(10000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-reader-revisions-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0];
 record.sections=Array.from({length:67},(_,i)=>({id:randomUUID(),title:'Original section '+i,body:'Retained observation '.repeat(100)}));
 const revision=recordRevision(record);book.entries[1].relations=[{id:randomUUID(),type:'supports',target:{workspaceId:book.id,kind:'record',id:record.id,revision},label:record.title}];
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),original=ResearchCatalogue.prototype.record,errors=[];
 ResearchCatalogue.prototype.record=()=>{throw Error('Linked revision inspection reconstructed an original');};page.on('pageerror',e=>errors.push(e.message));
 const linked=page.locator('[data-activity-results]');
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');await page.getByRole('button',{name:'Show linked records',exact:true}).click();await expect(linked).toContainText('Retained revision '+revision.slice(0,10));await expect(linked).not.toContainText('different from current');
  const values=new RecordValues(f.workspace),target={workspaceId:book.id,recordId:record.id,field:'title'},base=await values.read(target);await values.save({...target,expectedRevision:base.revision,value:{value:'Amended observation'}});
  await page.getByRole('link',{name:'Observanda — refresh saved workspace',exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText('Amended observation');await page.getByRole('button',{name:'Show linked records',exact:true}).click();await expect(linked).toContainText('Retained revision '+revision.slice(0,10)+' (different from current)');
  await linked.getByRole('link',{name:book.entries[1].title,exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText(book.entries[1].title);await expect(page.locator('.research-link-list')).toContainText('Retained revision '+revision.slice(0,10));expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=original;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
