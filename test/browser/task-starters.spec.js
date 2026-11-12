import {test as base,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createNotebook} from '../../src/model.js';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {navigate,preferences} from './preferences-helper.js';
import {sourceAssets} from './built-assets-helper.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {ProjectStorage} from '../../src/project-storage.js';
import {LabBookRegistry} from '../../src/lab-book-registry.js';
import {LabBookStorage} from '../../src/lab-book-storage.js';
import {readAccess,verifyAccess} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {chooseStarterAction,previewStarterLanguages,authorStarter,verifyFieldVisitEvidence,exportFieldVisitPdf,customizeMethodProfile} from './task-starter-journey.js';
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';

const test=base.extend({starterFixture:async({page,browser},use)=>{
  test.setTimeout(600000);page.setDefaultTimeout(30000);
  const temp=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(temp,'observanda-task-starters-'));
  const databases=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(databases);
  const blank=createNotebook('Starter workspace'),fixture=await encryptedFixture(directory,blank),vaults=[fixture.vault];
  const app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json'),browserAssets:await sourceAssets()});
  const projects=new ProjectRegistry(fixture.workspace,blank.id),dialog=page.locator('#dialog'),errors=[],outside=[];
  await page.context().route(/^https?:/,request=>{if(new URL(request.request().url()).origin===app.origin)return request.continue();outside.push(request.request().url());return request.abort();});
  const removeRenderer=installPdfRenderer(async input=>{
    const viewport=await browser.newPage();
    try{
      await viewport.route('**/*',r=>r.abort());await viewport.emulateMedia({media:'print'});await viewport.setContent(input.html);await viewport.evaluate(()=>document.fonts.ready);
      const preflight=await viewport.evaluate(measurePdfPreflight),bytes=input.preflightOnly||preflight.status==='fatal'?null:await viewport.pdf({preferCSSPageSize:true,printBackground:true});
      return {bytes,preflight,...(bytes?{sha256:createHash('sha256').update(bytes).digest('hex')}:{}),renderer:{engine:'chromium',electron:'test',chromium:browser.version(),recipeVersion:1}};
    }finally{await viewport.close();}
  });
  page.on('pageerror',error=>errors.push(error.message));
  const keyFor=async root=>{const key=await verifyAccess(await readAccess(root),'','',{deviceStore:fixture.deviceStore});vaults.push(key);return key;};
  const choose=chooseStarterAction(page);
  const settingsLibrary=async()=>{await navigate(page,'Preferences');await preferences(page,'Templates');await page.getByRole('button',{name:'Choose a starter',exact:true}).click();};
  try{
    await page.goto(app.url);
    await use({app,projects,dialog,choose,settingsLibrary,fixture,keyFor});
    expect(errors).toEqual([]);expect(outside).toEqual([]);
  }finally{
    removeRenderer();await app.close();await databases.close();detach();for(const key of vaults)clearVault(key);
    if(path.dirname(directory)!==temp||!path.basename(directory).startsWith('observanda-task-starters-'))throw Error('Unexpected fixture location');
    await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
}});

test.use({video:process.env.OBSERVANDA_STARTER_RECORDING==='1'?'on':'off'});

test('browse all starter previews by keyboard in all five languages and leave the workspace empty',async({page,starterFixture})=>{
  const {app,fixture,projects,dialog,choose,settingsLibrary}=starterFixture;
    let release;const delayed=new Promise(resolve=>{release=resolve;});
    const slowList=/\/research\/starters\/list$/;
    await page.context().route(slowList,async request=>{await delayed;await request.continue().catch(()=>{});});
    await settingsLibrary();const templatesURL=page.url();
    await dialog.getByRole('searchbox').fill('colony');await choose('Hive inspection');
    release();await page.context().unroute(slowList);await expect(dialog.getByRole('heading',{name:'Hive inspection',exact:true})).toBeVisible();
    await choose('Back to templates');await choose('Close');
    await previewStarterLanguages(page,{helpURL:app.origin+'/#/preferences/help',templatesURL});
    expect((await fixture.workspace.read()).book.entries).toEqual([]);expect((await projects.read()).value.projects).toEqual([]);
});

test('create, author, search, export and reopen the selected starters',async({page,starterFixture})=>{
  const {app,projects,dialog,choose,settingsLibrary,keyFor,fixture}=starterFixture;
  let route;
  const openLibrary=async()=>{
    await page.goto(route);await page.getByRole('button',{name:'New record',exact:true}).click();
    await dialog.getByRole('button',{name:'Record templates',exact:true}).click();
    await expect(dialog.getByRole('searchbox')).toBeVisible();
  };
    await navigate(page,'Projects');await page.locator('main').getByRole('button',{name:'New project',exact:true}).click();
    await dialog.getByLabel('Name',{exact:true}).fill('Field project');await choose('Create project');await expect(dialog).not.toBeVisible({timeout:60000});
    const [projectInfo]=(await projects.read()).value.projects,projectId=projectInfo.projectId;
    const project=new ProjectStorage(projectInfo.root,projectId,await keyFor(projectInfo.root)),registry=new LabBookRegistry(project);
    await settingsLibrary();await choose('Blank lab book');await dialog.getByLabel('Lab book name',{exact:true}).fill('Field notes');
    await choose('Continue to book settings');const owner=dialog.locator('[name=recordProject]');
    await expect(owner.locator('option',{hasText:'Field project'})).toHaveCount(1);await owner.selectOption(projectId);await choose('Choose a project');
    await expect(dialog.locator('[name="publication"]')).not.toBeChecked();await expect(dialog.locator('[name="pdfPublication"]')).not.toBeChecked();
    await dialog.locator('[name="pdfPublication"]').check();await choose('Save lab book');await expect(dialog).not.toBeVisible({timeout:60000});
    const [empty]=(await registry.read()).value.books,location=registry.location(empty);
    const storage=new LabBookStorage(location.root,location.labBookId,await keyFor(location.root)),emptyBook=(await storage.read()).book;
    expect(emptyBook.notebooks[0]).toMatchObject({share:false,sharePdf:true});
    expect(emptyBook.notebooks[0].configuration.sections).toEqual([]);expect(emptyBook.entries).toEqual([]);
    route=app.origin+'/#/owners/'+projectId+'/books/'+location.labBookId+'/notebooks/'+location.labBookId;
    const titles=['Blank entry','Field visit','Project diary','Illustrated procedure','Lesson','Studio session','Hive inspection'];
    for(const [i,name] of titles.entries()){
      const title=name+' review',body='Independent text '+i;await page.goto(route);
      await test.step('Author and reopen '+name,()=>authorStarter(page,{name,title,body,fieldVisit:name==='Field visit'}));
      const saved=(await storage.read()).book.entries.find(entry=>entry.title===title);
      expect(saved.share).toBe(false);expect(saved.attachments).toEqual([]);expect(saved.contributors).toEqual([]);
      if(name==='Blank entry')expect(saved.sections).toEqual([]);
      if(name==='Lesson')expect(saved.sections.map(section=>section.title)).toEqual(['Learning objectives','Preparation','Learning activity']);
      if(name==='Field visit'){
        expect(saved).toMatchObject({sharePdf:true,publication:{pdf:{body:false}}});
        expect(saved.sections[0]).toMatchObject({title:'Field conditions',sharePdf:true});
        const publication=new WebsiteFileStore(fixture.workspace);
        expect(await publication.sourceForRecord({workspaceId:emptyBook.id,recordId:saved.id,target:'pdf'})).toMatchObject({visible:true});
        await test.step('Import and download original evidence, then search the saved record',()=>verifyFieldVisitEvidence(page,{title,otherTitle:'Blank entry review'}));
        await test.step('Compose and independently read the approved section in an exported PDF',()=>exportFieldVisitPdf(page,{title,privateText:body}));
      }
    }
    await openLibrary();await dialog.getByRole('combobox',{name:'Create',exact:true}).selectOption('book');await choose('Methods and results notebook');
    await dialog.getByLabel('Lab book name',{exact:true}).fill('Independent methods');
    await choose('Continue to book settings');await expect(dialog.getByLabel('Lab book name',{exact:true})).toHaveValue('Independent methods');
    await choose('Save lab book');await expect(dialog).not.toBeVisible({timeout:60000});
    const entries=(await registry.read()).value.books;expect(entries).toHaveLength(2);
    const methods=registry.location(entries.find(item=>item.labBookId!==empty.labBookId));
    const methodsStorage=new LabBookStorage(methods.root,methods.labBookId,await keyFor(methods.root));
    {
      const created=await methodsStorage.read();
      const notebook=created.book.notebooks[0];expect(notebook.title).toBe('Independent methods');expect(notebook.share).toBe(false);
      expect(notebook.sharePdf).toBe(false);expect(created.book.entries).toEqual([]);
      expect(notebook.configuration.sections.map(section=>section.label)).toEqual(['Method','Result']);
      expect(notebook.configuration.sections[1].fields.map(field=>field.label)).toEqual(['Observations','Supporting evidence','Interpretation']);
    }
    await page.getByRole('button',{name:'New record',exact:true}).click();await choose('Create method');
    const entry=page.locator('[data-configuration-record-host]');await entry.locator('[data-record-value]').fill('Rain gauge calibration');
    await entry.getByLabel('Choose what to edit',{exact:true}).selectOption('custom');await entry.getByLabel('Value',{exact:true}).selectOption('template:purpose');
    await entry.getByRole('textbox',{name:'Purpose',exact:true}).fill('Calibrate the gauge before use.');
    // Hold the next field read to make the visible transition deterministic.
    const readField='**/research/drafts/review/editRead';let allowRead;
    const gate=new Promise(resolve=>{allowRead=resolve;});
    await page.context().route(readField,async route=>{if(route.request().postDataJSON()?.field==='template:materials')await gate;await route.continue();});
    try{
      await entry.getByLabel('Value',{exact:true}).selectOption('template:materials');
      await expect(entry.locator('textarea[data-record-value]')).toBeDisabled();
      await page.getByRole('button',{name:'Save record',exact:true}).click();
    }finally{allowRead();await page.context().unroute(readField);}
    await expect(page.getByRole('heading',{name:'Rain gauge calibration',level:1})).toBeVisible({timeout:60000});
    const beforeRecords=(await methodsStorage.read()).book.entries;
    expect(beforeRecords).toHaveLength(1);expect(beforeRecords[0]).toMatchObject({title:'Rain gauge calibration',template:{values:{purpose:'Calibrate the gauge before use.'}}});
    const methodsRoute=app.origin+'/#/owners/'+projectId+'/books/'+methods.labBookId+'/notebooks/'+methods.labBookId;
    let customized;await customizeMethodProfile(page,{bookURL:methodsRoute,onCustomized:async()=>{
      customized=(await methodsStorage.read()).book.notebooks[0].configuration;
      expect(customized.sections.find(section=>section.label==='Teaching activities').fields[0].label).toBe('Field briefing');
    }});
    const afterEnable=(await methodsStorage.read()).book;expect(afterEnable.notebooks[0].configuration).toEqual(customized);expect(afterEnable.entries).toEqual(beforeRecords);
});
