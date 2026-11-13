import {test,expect} from '@playwright/test';
import {revealInEditor} from './record-editor-helper.js';
import path from 'node:path';
import {testServer} from '../device-fixture.js';
import {RecordContent} from '../../src/record-content.js';
import {researchReference} from '../../src/web/research-reference.js';
import {workspaceReachFixture} from './workspace-reach-fixture.js';

// From a lab book record, the link picker reaches records of the workspace's
// other projects and lab books. Private records and other workspaces stay out
// of reach; a locked owner asks to be unlocked before it is read or opened.
test('a lab book record links and opens records of other projects in the same workspace',async({page})=>{
 test.setTimeout(240000);page.setDefaultTimeout(15000);
 const fixture=await workspaceReachFixture('workspace-record-links'),{f,host,apiary,sealed}=fixture,record=host.entries[0],errors=[];let app;
 const dialog=page.getByRole('dialog',{name:'Edit Research link',exact:true}),owners=page.locator('dialog[data-workspace-owner-picker]'),reference=()=>dialog.getByLabel('Observanda reference',{exact:true});
 const openRecord=async()=>{await page.goto(app.origin+'/#/records/'+record.id+'/read');await (await revealInEditor(page,page.getByRole('button',{name:'Add research link',exact:true}),'Evidence and results')).click();await expect(dialog).toBeVisible();};
 try{
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(fixture.directory,'preferences.json')});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app.url);await openRecord();

  await dialog.getByRole('button',{name:'Find in another project or lab book',exact:true}).click();await expect(owners).toBeVisible();
  await expect(owners.locator('[data-owner-row="'+host.id+'"]')).toContainText('(this location)');
  await expect(owners.locator('[data-owner-row="'+apiary.book.id+'"]')).toHaveAttribute('data-owner-access','open');
  await expect(owners.locator('[data-owner-row="'+sealed.book.id+'"]')).toHaveAttribute('data-owner-access','locked');
  await expect(owners).not.toContainText('Other workspace project');

  // Cancelling the unlock prompt leaves the locked owner unread.
  await owners.getByRole('button',{name:'Unlock Sealed archive',exact:true}).click();
  const unlock=page.locator('#project-unlock-form');await expect(unlock).toBeVisible();await unlock.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(owners.getByRole('button',{name:'Unlock and retry',exact:true})).toBeVisible();await expect(owners.locator('[data-owner-record]')).toHaveCount(0);
  await owners.getByRole('button',{name:'All projects and lab books',exact:true}).click();

  await owners.getByRole('button',{name:'Show records in Apiary project',exact:true}).click();
  await expect(owners.locator('[data-owner-record="'+apiary.private.id+'"]')).toHaveCount(0);
  await owners.locator('[data-owner-record="'+apiary.shared.id+'"]').getByRole('button',{name:'Link '+apiary.shared.title,exact:true}).click();
  await expect(owners).toHaveCount(0);
  await expect(reference()).toHaveValue(researchReference({workspaceId:apiary.book.id,kind:'record',id:apiary.shared.id}));
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();

  // A saved link to a locked owner asks for that owner's grant when opened.
  await openRecord();await reference().fill(researchReference({workspaceId:sealed.book.id,kind:'record',id:sealed.shared.id}));
  await dialog.getByLabel('Link label',{exact:true}).fill('Sealed evidence');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  const content=await new RecordContent(f.workspace).read({workspaceId:host.id,recordId:record.id,pagedHeader:true,windows:{relations:0}});
  const links=new Map(content.header.relations.map(link=>[link.target.workspaceId,link]));
  expect(links.get(apiary.book.id)?.target.id).toBe(apiary.shared.id);expect(links.get(sealed.book.id)?.target.id).toBe(sealed.shared.id);

  await page.locator('[data-action="record-link-open"][data-id="'+links.get(apiary.book.id).id+'"]').click();
  await expect(page).toHaveURL(new RegExp('/owners/'+apiary.storage.projectId+'/'));await expect(page.getByRole('heading',{name:apiary.shared.title,exact:true}).first()).toBeVisible();

  await page.goto(app.origin+'/#/records/'+record.id+'/read');
  await page.locator('[data-action="record-link-open"][data-id="'+links.get(sealed.book.id).id+'"]').click();
  const prompt=page.locator('#project-unlock-form');await expect(prompt).toBeVisible();
  await prompt.getByLabel('Project password',{exact:true}).fill(fixture.sealedPassword);await prompt.getByRole('button',{name:'Unlock',exact:true}).click();
  await expect(page).toHaveURL(new RegExp('/owners/'+sealed.storage.projectId+'/'));await expect(page.getByRole('heading',{name:sealed.shared.title,exact:true}).first()).toBeVisible();
  expect(errors).toEqual([]);
 }catch(error){
  await test.info().attach('workspace-links-failure',{body:await page.screenshot(),contentType:'image/png'});throw error;
 }finally{await app?.close();await fixture.close();}
});
