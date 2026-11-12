import {test,expect} from '@playwright/test';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {websiteDesktopFixture} from './installed-website-app.js';
import {createWebsiteWorkspace} from './website-workspace-fixture.js';
import {navigate,preferences} from '../browser/preferences-helper.js';
import {
 authorStarter,chooseStarterAction,customizeMethodProfile,exportFieldVisitPdf,
 previewStarterLanguages,verifyFieldVisitEvidence
} from '../browser/task-starter-journey.js';

// Only the installed service owns these databases. Inspect its normal directory
// replies to identify the books made through the UI, including after restart.
async function directory(page,project=null){
 return page.evaluate(async project=>{
  const storage=await fetch('/api/storage');
  if(!storage.ok)throw Error('Workspace storage unavailable');
  const {contextId}=await storage.json();
  const response=await fetch(project?'/api/projects/'+project+'/lab-books/list':'/api/projects/list',{
   method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':contextId},
   body:JSON.stringify(project?{after:null,limit:50,revision:null}:{parentId:null,offset:0,limit:50,revision:null})
  });
  if(!response.ok)throw Error('Could not read the selected directory');
  const result=await response.json();return project?result.items:result.projects;
 },project);
}

test('fresh installed desktop creates and reopens every local starter offline',async()=>{
 test.skip(!process.env.OBSERVANDA_DESKTOP_EXECUTABLE,'A freshly installed candidate is required.');
 test.setTimeout(900000);
 const fixture=await websiteDesktopFixture(),outside=[],errors=[];
 let app=null,page=null;
 let launchCount=0,primaryFailure;
 const record=process.env.OBSERVANDA_STARTER_RECORDING==='1';
 async function launch(){
  app=await fixture.start();page=await app.firstWindow();
  if(record){
   launchCount++;
   await page.screencast.start({path:test.info().outputPath('starter-'+launchCount+'.webm'),size:{width:1280,height:800}});
  }
  page.on('pageerror',error=>errors.push(error.message));
  await app.context().route(/^https?:/,request=>{
   const url=new URL(request.request().url());
   if(['127.0.0.1','localhost','[::1]'].includes(url.hostname))return request.continue();
   outside.push(url.origin);return request.abort();
  });
 }
 const library=async()=>{
  await navigate(page,'Preferences');await preferences(page,'Templates');
  await page.getByRole('button',{name:'Choose a starter',exact:true}).click();
 };
 async function downloadBytes(activate){
  const session=await app.context().newCDPSession(page);
  const folder=path.join(fixture.directory,'Downloads');
  const prior=new Set(await readdir(folder));
  let completed;
  try{
   // Electron owns the session partition. Direct the page's real download
   // into its isolated profile and wait for Chromium's final rename.
   await session.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:folder});
   await activate();
   await expect.poll(async()=>{
    const entries=await readdir(folder,{withFileTypes:true});
    completed=entries.filter(entry=>entry.isFile()&&!prior.has(entry.name)&&!entry.name.endsWith('.crdownload'));
    return completed.length;
   },{message:'The installed app saved one complete download',timeout:60000}).toBe(1);
   return await readFile(path.join(folder,completed[0].name));
  }finally{
   await session.detach();
  }
 }
 try{
  await launch();await createWebsiteWorkspace(page,fixture.directory,'Authoring workshop');
  expect(await directory(page)).toEqual([]);
  await library();const templatesURL=page.url(),origin=new URL(templatesURL).origin;
  const choose=chooseStarterAction(page);await choose('Close');
  await previewStarterLanguages(page,{templatesURL,helpURL:origin+'/#/preferences/help'});
  expect(await directory(page)).toEqual([]);
  await navigate(page,'Projects');await page.locator('main').getByRole('button',{name:'New project',exact:true}).click();
  const dialog=page.locator('#dialog');
  await dialog.getByLabel('Name',{exact:true}).fill('Study');await choose('Create project');
  await expect(dialog).not.toBeVisible({timeout:60000});
  const projects=await directory(page);expect(projects).toHaveLength(1);const project=projects[0].projectId;
  const notebookURL=book=>new URL(page.url()).origin+'/#/owners/'+project+'/books/'+book+'/notebooks/'+book;
  await library();await choose('Blank lab book');await dialog.getByLabel('Lab book name',{exact:true}).fill('Fieldwork');
  await choose('Continue to book settings');await dialog.locator('[name=recordProject]').selectOption(project);await choose('Choose a project');
  await expect(dialog.locator('[name=publication]')).not.toBeChecked();
  await expect(dialog.locator('[name=pdfPublication]')).not.toBeChecked();
  await dialog.locator('[name=pdfPublication]').check();await choose('Save lab book');await expect(dialog).not.toBeVisible({timeout:60000});
  const books=await directory(page,project);expect(books).toHaveLength(1);const field=books[0].labBookId;
  const titles=['Blank entry','Project diary','Illustrated procedure','Field visit','Lesson','Studio session','Hive inspection'];
  for(const name of titles){
   await page.goto(notebookURL(field));
   const title=name+' observations',body='Private notes for '+name;
   await authorStarter(page,{name,title,body,fieldVisit:name==='Field visit'});
   if(name==='Field visit'){
    await verifyFieldVisitEvidence(page,{title,otherTitle:'Blank entry observations',downloadBytes});
    await exportFieldVisitPdf(page,{title,privateText:body,downloadBytes});
   }
  }
  await page.goto(notebookURL(field));await page.getByRole('button',{name:'New record',exact:true}).click();
  await choose('Record templates');await choose('Methods and results notebook');
  await dialog.getByLabel('Lab book name',{exact:true}).fill('Methods register');
  await choose('Continue to book settings');await choose('Save lab book');await expect(dialog).not.toBeVisible({timeout:60000});
  const after=await directory(page,project);expect(after).toHaveLength(2);const methods=after.find(item=>item.labBookId!==field).labBookId;
  await page.goto(notebookURL(methods));await page.getByRole('button',{name:'New record',exact:true}).click();
  await choose('Create method');const entry=page.locator('[data-configuration-record-host]');
  await entry.locator('[data-record-value]').fill('Gauge calibration');
  const purpose='Check the reference reading before the survey.';
  await entry.getByLabel('Choose what to edit',{exact:true}).selectOption('custom');
  await entry.getByLabel('Value',{exact:true}).selectOption('template:purpose');
  await entry.getByRole('textbox',{name:'Purpose',exact:true}).fill(purpose);
  await entry.getByLabel('Value',{exact:true}).selectOption('template:materials');
  const beforeSave=performance.now();
  await page.getByRole('button',{name:'Save record',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Gauge calibration',level:1,exact:true})).toBeVisible({timeout:60000});
  test.info().annotations.push({type:'installed-method-save-ms',description:String(Math.round(performance.now()-beforeSave))});
  async function profile(){
   await page.goto(notebookURL(methods));await page.getByRole('button',{name:'Lab book settings',exact:true}).click();
   const editor=page.locator('[data-configuration-editor]');
   const teaching=editor.getByRole('button',{name:'Teaching activities',exact:true});
   await teaching.click();
   await expect(teaching).toHaveAttribute('aria-current','true',{timeout:60000});
   await expect(editor.getByLabel('Record type name',{exact:true})).toHaveValue('Teaching activities');
   const labels=await editor.locator('[data-command="section-select"]').allTextContents();
   const fieldLabel=await editor.locator('[data-configuration-field-prop="label"]').inputValue();
   await page.locator('#dialog').getByRole('button',{name:'Cancel',exact:true}).click();
   return {labels,fieldLabel};
  }
  let customized;
  await customizeMethodProfile(page,{bookURL:notebookURL(methods),onCustomized:async()=>{customized=await profile();}});
  if(record)await page.screencast.stop();
  await fixture.close(app);app=null;await launch();
  await expect(page.locator('.workspace-name').first()).toHaveText('Authoring workshop',{timeout:60000});
  const recovered=await profile();expect(recovered.fieldLabel).toBe('Field briefing');expect(recovered.labels.length).toBeGreaterThan(1);expect(recovered).toEqual(customized);
  await page.getByRole('button',{name:'Gauge calibration',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Gauge calibration',exact:true})).toBeVisible();
  await expect(page.getByText(purpose,{exact:true})).toBeVisible();
  await page.goto(notebookURL(field));
  await expect(page.locator('[data-record-list-status]')).toHaveText('Records 1-7 of 7',{timeout:60000});
  for(const name of titles)await expect(page.locator('#entry-results').getByRole('button',{name:name+' observations',exact:true})).toBeVisible();
  expect(errors).toEqual([]);expect(outside).toEqual([]);
 }catch(error){primaryFailure=error;throw error;}
 finally{
  try{
   try{if(record&&app&&page&&!page.isClosed())await page.screencast.stop();}
   finally{await fixture.dispose(app);}
  }catch(cleanupError){
   if(primaryFailure)throw new AggregateError([primaryFailure,cleanupError],primaryFailure.message+'; cleanup: '+cleanupError.message);
   throw cleanupError;
  }
 }
});
