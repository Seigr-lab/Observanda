import {Workspace} from '../../src/storage.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {createNotebook} from '../../src/model.js';
import {sampleNotebook} from '../../src/sample.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {initializeProjectLocation,ProjectStorage} from '../../src/project-storage.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {WebsiteEditor} from '../../src/website-editor.js';
import {WebsiteDocumentStore} from '../../src/website-document-store.js';
import {requireWebsiteSourceSelections} from '../../src/catalogue-format.js';
import {ResearchRecords} from '../../src/research.js';
import {MediaStore} from '../../src/media.js';
import {createWorkspaceAccess,takeCreatedVault} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {navigate} from './preferences-helper.js';
import {task} from './composer-helper.js';

test('a large foreign selection saves, reopens, previews and prepares without aggregate editor requests',async({page},info)=>{
 test.setTimeout(240000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-source-capacity-ui-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[];let app;
 try{
  const book=createNotebook('Publishing workspace'),host=await encryptedFixture(directory,book);keys.push(host.vault);
  const source=createNotebook('Archive project'),projectId=randomUUID(),notebookId=randomUUID();source.projects=[{id:projectId,title:'Archive project',description:'',share:true,logoId:null}];source.notebooks=[{id:notebookId,projectId,title:'Archive book'}];
  const records=Array.from({length:1001},(_,position)=>({...structuredClone(sampleNotebook().entries[0]),id:randomUUID(),notebookId,title:'Archive entry '+String(position).padStart(4,'0'),body:'Preserved observation '+position,share:position!==0,attachments:[],figures:[],relations:[],sections:[]}));
  const access=await createWorkspaceAccess('','',host.deviceStore),vault=takeCreatedVault(access);keys.push(vault);const project=await initializeProjectLocation(path.join(host.workspace.root,'Archive project'),projectId,source,access,vault),registry=new ProjectRegistry(host.workspace,book.id);await registry.attach(project,{expected:(await registry.read()).revision});const sourceStorage=new ProjectStorage(project.root,projectId,vault),research=new ResearchRecords(sourceStorage,new MediaStore(sourceStorage));for(let offset=0;offset<records.length;offset+=32)await research.save({workspaceId:source.id,changes:records.slice(offset,offset+32).map(record=>({id:record.id,expectedRevision:null,record}))},{receipt:true});
  const sites=new WebsiteSites(host.workspace),site=await sites.change({workspaceId:book.id,etag:(await host.workspace.outline()).etag,operation:'create',name:'Archive journal'}),editor=new WebsiteEditor(host.workspace),opened=await editor.execute('open',{workspaceId:book.id,websiteId:site.id}),last=records.at(-1);
  // Seed an existing large saved document. The browser then uses ordinary
  // bounded source commands against its late choice, never an aggregate save.
  await sites.write(site.id,{},async store=>{await requireWebsiteSourceSelections(store.db);const documents=new WebsiteDocumentStore(store),saved=await documents.document(site.id,{...opened.websitePin,mutable:true}),document=await saved.document.property(['document','website'],'researchSources',[{workspaceId:source.id,projectIds:[projectId],selection:{defaultShare:false,includeProjects:[],records:records.map(record=>({id:record.id,share:record.id===last.id,attachments:[]}))}}]);await documents.saveDocument(site.id,document,{researchSnapshotId:opened.websitePin.researchSnapshotId,expectedRevision:opened.websitePin.websiteRevision});});
  const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('/api/websites/editor/')&&request.method()==='POST')requests.push(request.postData()??'');});
  app=await testServer({root:host.workspace.root,deviceStore:host.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});await page.goto(app.url);await navigate(page,'Websites');await page.locator('[data-website-directory] section').filter({has:page.getByRole('heading',{name:'Archive journal',exact:true})}).getByRole('button',{name:'Website editor',exact:true}).click();
  await task(page,'Content');const sources=page.locator('[data-publication-sources]');await sources.locator('section.website-record').filter({has:page.getByText('Archive project',{exact:true})}).getByRole('button',{name:'Lab books',exact:true}).click();await sources.getByRole('button',{name:'Choose content',exact:true}).click();await sources.getByLabel('Search records',{exact:true}).fill(last.title);
  const checkbox=sources.locator('[data-source-record="'+last.id+'"]');await expect(checkbox).toBeChecked();await checkbox.uncheck();await expect(checkbox).not.toBeChecked();await expect(checkbox).toBeEnabled();await checkbox.check();await expect(checkbox).toBeChecked();await expect(checkbox).toBeEnabled();
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();await task(page,'Content');await sources.locator('section.website-record').filter({has:page.getByText('Archive project',{exact:true})}).getByRole('button',{name:'Lab books',exact:true}).click();await sources.getByRole('button',{name:'Choose content',exact:true}).click();await sources.getByLabel('Search records',{exact:true}).fill(last.title);await expect(checkbox).toBeChecked();
  await sources.getByRole('button',{name:'Edit website page',exact:true}).click();await expect(page.frameLocator('#website-draft-preview').locator('body')).toContainText('Preserved observation 1000',{timeout:30000});await expect(page.locator('.website-preview-panel')).not.toHaveClass(/canvas-is-loading/);await page.screenshot({path:info.outputPath('saved-large-source-preview.png')});
  const current=await editor.execute('open',{workspaceId:book.id,websiteId:site.id}),choices=await editor.execute('sources',{workspaceId:book.id,websiteId:site.id,websitePin:current.websitePin,sourceId:source.id,collection:'records',offset:1000,limit:1});expect(choices.total).toBe(1001);expect(choices.rows[0].value.share).toBe(true);expect(requests.every(request=>Buffer.byteLength(request)<16000)).toBe(true);
  await page.getByRole('button',{name:'Prepare edition',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.locator('#full-public-preview')).toBeVisible({timeout:30000});const href=new URL(await page.locator('#full-public-preview').getAttribute('href'),app.url).href;
  const published=await page.context().newPage();try{await published.goto(href);await expect(published.locator('body')).toContainText(last.title);await expect(published.locator('body')).not.toContainText(records[0].title);}finally{await published.close();}
  const storage=new ProjectStorage(project.root,projectId,vault),selected=await storage.catalogue(store=>store.recordSelection([last.id]));await new ResearchRecords(storage,new MediaStore(storage)).save({workspaceId:source.id,changes:[{id:last.id,expectedRevision:selected.recordRevisions[last.id],record:{...selected.book.entries[0],share:false}}]},{receipt:true});
  const denied=await page.request.get(href);expect(denied.status()).toBeGreaterThanOrEqual(400);expect(await denied.text()).not.toContain('Preserved observation 1000');expect(errors).toEqual([]);
 }finally{await app?.close();detach();await runtime.close();for(const key of keys)clearVault(key);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
