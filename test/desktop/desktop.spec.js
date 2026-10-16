import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {desktopFixture} from './fixture.js';
import {navigate} from '../browser/preferences-helper.js';

test('desktop opens setup, saves encrypted work, protects unsaved edits and reopens after a clean shutdown',async()=>{
 test.skip(!['win32','darwin'].includes(process.platform));
 test.setTimeout(240000);
 const fixture=await desktopFixture(),{directory,packaged,env,start}=fixture;
 const workspaceName='Desktop field and studio work',workspaceRoot=path.join(directory,workspaceName),projectRoot=path.join(workspaceRoot,'Unsaved desktop project');
 let app;
 console.log(packaged?'Desktop acceptance: selected executable.':'Desktop acceptance: source Electron (not an installed build).');
 try{
  app=await start();let page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Electron's native unsaved-work dialog owns beforeunload. Prevent the
  // browser automation's automatic dismissal from racing that decision.
  page.on('dialog',()=>{});
  await expect(page.getByRole('heading',{name:'Create a workspace',exact:true})).toBeVisible({timeout:60000});
  expect(await page.evaluate(()=>({require:typeof window.require,process:typeof window.process}))).toEqual({require:'undefined',process:'undefined'});
  const preferences=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());expect(preferences.sandbox).toBe(true);expect(preferences.nodeIntegration).toBe(false);expect(preferences.contextIsolation).toBe(true);
  await page.getByLabel('Workspace name',{exact:true}).fill('Desktop field and studio work');
  await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('Create in',{exact:true}).fill(directory);
  await page.getByLabel('Use this device',{exact:false}).check();await page.getByRole('button',{name:'Create workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText('Desktop field and studio work',{timeout:30000});
  console.log('Desktop setup: encrypted workspace created.');
  const logo=page.getByRole('link',{name:'Observanda — refresh saved workspace',exact:true});
  await expect(logo).toBeVisible();await logo.click();await expect(page.locator('#notice')).toContainText('up to date');
  // Exercise the desktop service's real helper discovery without authorizing
  // a real GitHub account or leaving credentials in the normal user profile.
  await page.evaluate(()=>location.hash='#/preferences/integrations');
  await expect(page.locator('#github-connection').getByRole('button',{name:'Sign in with GitHub',exact:true})).toBeEnabled();
  await expect(page.locator('#github-connection')).toContainText('No GitHub account is connected');
  await expect(page.locator('#github-connection [role="alert"]')).toHaveCount(0);
  await fixture.screenshot(app,test.info().outputPath('desktop-github-sign-in.png'));
  await page.evaluate(()=>location.hash='#/preferences/general');
  await expect(page.getByRole('link',{name:'Observanda on GitHub',exact:true})).toHaveAttribute('href','https://github.com/Seigr-lab/Observanda');
  await page.evaluate(()=>location.hash='#/preferences/user');await expect(page.locator('[data-user-id]')).toContainText('observanda:user:');const userId=await page.locator('[data-user-id]').innerText();await page.getByLabel('Display name',{exact:true}).fill('Desktop observer');await page.getByRole('button',{name:'Save profile',exact:true}).click();await expect(page.locator('#notice')).toContainText('Profile saved.');
  await page.evaluate(()=>location.hash='#/workspace');
  // Only one instance may own this profile/database; another icon activation
  // exits after focusing the first window, without starting another service.
  const exe=packaged??(await import('electron')).default;
  await new Promise((resolve,reject)=>{const other=spawn(exe,packaged?[]:[path.resolve('desktop')],{env,windowsHide:true,stdio:'ignore'});other.once('error',reject);other.once('exit',code=>code===0?resolve():reject(Error('Second desktop instance failed')));});
  await page.locator('[data-action="new-project"]').first().click();await page.locator('#dialog').getByLabel('Name',{exact:true}).fill('Unsaved desktop project');
  await app.evaluate(({dialog,BrowserWindow})=>{dialog.showMessageBoxSync=()=>0;BrowserWindow.getAllWindows()[0].close();});
  await expect(page.locator('#dialog').getByLabel('Name',{exact:true})).toHaveValue('Unsaved desktop project');
  await expect(page.locator('#dialog [name=projectPath]')).toHaveCount(0);
  await page.locator('#dialog').getByRole('button',{name:'Create project',exact:true}).click();await expect(page.locator('#dialog')).not.toBeVisible({timeout:60000});
  await expect(page.locator('#main h1')).toHaveText('Unsaved desktop project');
  const projectId=new URL(page.url()).hash.match(/^#\/owners\/([a-f0-9-]{36})\/projects\//)?.[1];expect(projectId).toBeTruthy();
  await expect(page.locator('[data-directory-loading]')).toBeHidden();
  await page.getByRole('button',{name:'New lab book',exact:true}).focus();
  const directoryNodes=await page.evaluateHandle(()=>({host:document.querySelector('[data-lab-book-directory]'),grid:document.querySelector('[data-lab-book-directory] .notebook-grid'),focused:document.activeElement}));
  // A write through the authenticated service must reach the desktop renderer
  // without passing through its in-memory form state or restarting Electron.
  const externalBook=await page.evaluate(async projectId=>{
   const storage=await (await fetch('/api/storage')).json();
   const call=async(route,data)=>{const response=await fetch('/api/projects/'+projectId+route.slice(4),{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':storage.contextId,'X-Observanda-Wait':'1'},body:JSON.stringify(data)});if(!response.ok)throw Error('External desktop write failed: '+response.status);return response.json();};
   const snapshot=await call('/api/workspace/read/start',{});
   const notebook={id:crypto.randomUUID(),projectId:snapshot.metadata.projects[0].id,title:'Externally saved desktop book'};
   const result=await call('/api/lab-books/create',{id:crypto.randomUUID(),book:notebook,username:'',password:''});if(result.book?.labBookId!==notebook.id)throw Error('External desktop book identity changed');return notebook;
  },projectId);
  await page.evaluate(id=>location.hash='#/owners/'+id+'/projects/'+id,externalBook.projectId);
  await expect(page.locator('.project-notebook').filter({hasText:externalBook.title})).toBeVisible({timeout:15000});
  expect(await page.evaluate(nodes=>({host:nodes.host===document.querySelector('[data-lab-book-directory]'),grid:nodes.grid===document.querySelector('[data-lab-book-directory] .notebook-grid'),focus:nodes.focused===document.activeElement}),directoryNodes)).toEqual({host:true,grid:true,focus:true});await directoryNodes.dispose();
  await logo.click();await expect(page.locator('#notice')).toContainText('up to date');
  await fixture.screenshot(app,test.info().outputPath('desktop-workspace.png'));expect(errors).toEqual([]);
  await navigate(page,'Website editor');await page.locator('.website-site-context').getByRole('button',{name:'Websites',exact:true}).click();await page.getByRole('button',{name:'New website',exact:true}).click();
  await page.getByLabel('Website name',{exact:true}).fill('Desktop project website');await page.getByRole('button',{name:'Create website',exact:true}).click();
  await expect(page.locator('.website-site-context')).toContainText('Desktop project website');await expect(page).not.toHaveURL(/\/owners\//);const siteRoute=new URL(page.url()).hash;
  // Exercise the desktop service's record-block upgrade through its ordinary
  // authenticated authoring API, then amend the record in the actual editor.
  const retained=await page.evaluate(async({notebook,projectId})=>{
   const prefix='/api/projects/'+projectId+'/lab-books/'+notebook.id;
   const storage=await (await fetch('/api/storage')).json(),headers={'Content-Type':'application/json','X-Observanda-Workspace':storage.contextId,'X-Observanda-Wait':'1'};
   const start=await (await fetch(prefix+'/workspace/read/start',{method:'POST',headers,body:'{}'})).json(),now=new Date().toISOString();
   const record={id:crypto.randomUUID(),notebookId:notebook.id,type:'experiment',title:'Packaged block record',body:'Exact long-record checkpoint.',contributors:[],relations:[],tags:[],occurredOn:'2026-10-10',createdAt:now,updatedAt:now,share:false,figures:[],status:'draft',attachments:[],sections:Array.from({length:129},(_,i)=>({id:crypto.randomUUID(),title:'Retained observation '+(i+1),body:'Exact reading '+i+'. '+('Detailed observation α. '.repeat(40))}))};
   const response=await fetch(prefix+'/research/records/save',{method:'POST',headers,body:JSON.stringify({workspaceId:start.metadata.id,receipt:true,changes:[{id:record.id,expectedRevision:null,record}]})});
   if(!response.ok)throw Error('Packaged block save failed: '+await response.text());
   return {workspaceId:start.metadata.id,record};
  },{notebook:externalBook,projectId});
  const recordRoute='#/owners/'+projectId+'/books/'+externalBook.id+'/records/'+retained.record.id+'/read/'+retained.record.sections.at(-1).id;
  // An anchor near the end of a long record is found through bounded reading
  // windows. Await the final reply, rather than treating an intermediate
  // search-progress render as a finished record.
  const readerReady=()=>page.waitForResponse(async response=>{
   if(new URL(response.url()).pathname!=='/api/projects/'+projectId+'/lab-books/'+externalBook.id+'/workspace/read/record-content'||response.request().method()!=='POST')return false;
   return !response.ok()||!(await response.json()).search;
  });
  const firstReading=readerReady();await page.evaluate(route=>location.hash=route,recordRoute);expect((await firstReading).ok()).toBe(true);
  await expect(page.locator('.record-sections')).toContainText('Retained observation 129');
  await page.getByRole('button',{name:'Edit record',exact:true}).click();
  await page.getByRole('button',{name:'Edit selected detail',exact:true}).click();
  const titleEditor=page.getByRole('dialog',{name:'Edit Record title',exact:true});
  await titleEditor.getByLabel('Record title',{exact:true}).fill('Amended packaged block record');
  // This retained record save is streamed and may outlast a DOM assertion's
  // default five seconds. Wait for its actual response, then check the UI and
  // the saved values after restarting; never infer success from the click.
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/projects/'+projectId+'/lab-books/'+externalBook.id+'/research/records/values/save'&&response.request().method()==='POST');
  await titleEditor.getByRole('button',{name:'Save changes',exact:true}).click();const saved=await saving;expect(saved.ok()).toBe(true);await expect(titleEditor).not.toBeVisible();
  await expect(page.locator('.record-editing h1')).toHaveText('Amended packaged block record');
  console.log('Desktop authoring: selected title saved; restarting the application.');
  await fixture.close(app);app=await start();page=await app.firstWindow();
  await expect(page.locator('.workspace-name')).toHaveText('Desktop field and studio work',{timeout:60000});
  console.log('Desktop restart: workspace reopened; checking lock and unlock.');
  await page.locator('#main-navigation').getByRole('button',{name:'Lock workspace',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible({timeout:60000});
  await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('Desktop field and studio work',{timeout:30000});
  await expect(page.locator('#main-navigation')).toContainText('Unsaved desktop project');
  await page.evaluate(()=>location.hash='#/preferences/user');await expect(page.getByLabel('Display name',{exact:true})).toHaveValue('Desktop observer');await expect(page.locator('[data-user-id]')).toHaveText(userId);
  const reopenedReading=readerReady();await page.evaluate(route=>location.hash=route,recordRoute);expect((await reopenedReading).ok()).toBe(true);await expect(page.getByRole('heading',{name:'Amended packaged block record',exact:true})).toBeVisible();
  await expect(page.locator('.record-sections')).toContainText('Exact reading 128.');
  const reopened=await page.evaluate(async({workspaceId,record,projectId})=>{
   const storage=await (await fetch('/api/storage')).json(),response=await fetch('/api/projects/'+projectId+'/lab-books/'+record.notebookId+'/workspace/read/selection',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':storage.contextId},body:JSON.stringify({workspaceId,ids:[record.id]})});
   if(!response.ok)throw Error('Packaged block reopen failed');return (await response.json()).book.entries[0];
  },{...retained,projectId});
  expect(reopened.sections).toEqual(retained.record.sections);
  await page.evaluate(route=>location.hash=route,siteRoute);await expect(page.locator('.website-site-context')).toContainText('Desktop project website');
  await fixture.close(app);app=null;
  for(const root of [workspaceRoot,projectRoot,path.join(projectRoot,externalBook.title)]){
   const service=path.join(root,'.observanda','postgresql');await readFile(path.join(service,'data','PG_VERSION'));
   const running=await readFile(path.join(service,'data/postmaster.pid'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});expect(running.trim()).toBe('');
  }
 }finally{await fixture.dispose(app);}
});
