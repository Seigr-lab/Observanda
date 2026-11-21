import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {randomUUID} from 'node:crypto';
import {attemptFixture,fact} from '../fixtures/attempts.js';

test('conflicting assessment corrections retain the checkpoint and cannot overwrite saved facts',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-attempt-conflict-')),book=sampleNotebook(),base=book.entries[0];
 base.attempt=attemptFixture();const f=await encryptedFixture(directory,book),mine=structuredClone(base),stored=structuredClone(base),prior=base.attempt.assessments[1];
 mine.attempt.assessments.push({...prior,...fact(),supersedes:prior.id,outcome:'unavailable',reason:'Unfinished local interpretation'});
 stored.attempt.assessments.push({...prior,...fact(),supersedes:prior.id,outcome:'not-met',reason:'Separately saved interpretation'});
 const drafts=new ResearchDrafts(f.workspace),checkpoint=randomUUID();await drafts.write({id:checkpoint,workspaceId:book.id,expectedRevision:null,changes:[{base,record:mine,expectedRevision:recordRevision(base)}]});
 await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:base.id,expectedRevision:recordRevision(base),record:stored}]});
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences')}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);
  const open=async()=>{await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();};
  await open();await page.locator('.record-draft-preview').getByRole('button',{name:'Recover this draft',exact:true}).click();const dialog=page.locator('.record-draft-review'),versions=dialog.locator('.record-conflict-versions > section');
  await versions.filter({has:page.getByRole('heading',{name:'Your draft',exact:true})}).getByRole('button',{name:'Keep this version',exact:true}).click();await dialog.getByRole('button',{name:'Save recovered record',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('cannot be overwritten or removed');expect((await f.workspace.read()).book.entries[0].attempt).toEqual(stored.attempt);expect((await drafts.read(checkpoint)).draft.changes[0].record).toEqual(mine);
  await dialog.getByRole('button',{name:'Close review',exact:true}).click();await open();await page.locator('.record-draft-preview').getByRole('button',{name:'Recover this draft',exact:true}).click();await versions.filter({has:page.getByRole('heading',{name:'Current saved version',exact:true})}).getByRole('button',{name:'Keep this version',exact:true}).click();await dialog.getByRole('button',{name:'Save recovered record',exact:true}).click();await expect(dialog).not.toBeVisible();expect(await drafts.read(checkpoint)).toBeNull();
  expect((await f.workspace.read()).book.entries[0].attempt).toEqual(stored.attempt);expect(errors).toEqual([]);
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
