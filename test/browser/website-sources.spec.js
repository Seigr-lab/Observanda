import {privateDirectory,digest,serialize} from '../../src/storage.js';
import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {createNotebook} from '../../src/model.js';
import {sampleNotebook} from '../../src/sample.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {initializeProjectLocation} from '../../src/project-storage.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {LabBookDirectory} from '../../src/lab-book-directory.js';
import {LabBookCreation} from '../../src/lab-book-creation.js';
import {LabBookStorage} from '../../src/lab-book-storage.js';
import {ResearchRecords} from '../../src/research.js';
import {MediaStore} from '../../src/media.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {navigate} from './preferences-helper.js';
import {task,openPageSettings,addSection} from './composer-helper.js';

test('an independent website combines dedicated books, retains its page designs and leaves research unchanged',async({page},info)=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-sources-ui-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[],owners=[],errors=[];let app;
 try{
  const root=createNotebook('Publishing workspace'),host=await encryptedFixture(directory,root);keys.push(host.vault);const registry=new ProjectRegistry(host.workspace,root.id);
  for(const label of ['Alpha','Beta']){
   const id=randomUUID(),book=createNotebook('Project '+label);book.projects=[{id,title:book.title,description:'',share:false,logoId:null}];
   const access=await createWorkspaceAccess('','',host.deviceStore),vault=takeCreatedVault(access);keys.push(vault);
   const project=await initializeProjectLocation(path.join(host.workspace.root,book.title),id,book,access,vault);await registry.attach(project,{expected:(await registry.read()).revision});
   const created=await new LabBookCreation(project,host.deviceStore,{publish:entry=>new LabBookDirectory(registry).register(id,entry)}).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId:id,title:'Book '+label,configuration:{profiles:[],sections:[]}}});
   const key=await verifyAccess(await readAccess(created.book.root),'','',{deviceStore:host.deviceStore});keys.push(key);
   const storage=new LabBookStorage(created.book.root,created.book.labBookId,key),saved=await storage.outline(),record={...structuredClone(sampleNotebook().entries[0]),id:randomUUID(),notebookId:created.book.labBookId,title:'Observation '+label,body:'Original observation '+label,share:false,attachments:[],figures:[],relations:[],sections:[{id:randomUUID(),title:'Method '+label,body:'Method details '+label}]};
   const png=await readFile(new URL('../../src/preview-assets/image.png',import.meta.url));record.attachments=[{id:randomUUID(),kind:'image',caption:'Evidence '+label,alt:'Selected image '+label,transcript:'',share:true},{id:randomUUID(),kind:'image',caption:'Private evidence '+label,alt:'Private image '+label,transcript:'Private transcript',share:false}];
   for(const attachment of record.attachments){const folder=await privateDirectory(storage.root,'.observanda/media/'+attachment.id),metadata={id:attachment.id,kind:'image',extension:'png',mime:'image/png',bytes:png.length,sha256:digest(png),originalBytes:png.length,originalSha256:digest(png)};await storage.writeFile(path.join(folder,'asset.json'),serialize(metadata));await storage.writeFile(path.join(folder,'public.png'),png);await storage.writeFile(path.join(folder,'original'),png);}
   await new ResearchRecords(storage,new MediaStore(storage)).save({workspaceId:saved.metadata.id,changes:[{id:record.id,expectedRevision:null,record}]});
   owners.push({storage,before:await storage.read(),label});
  }
  const sites=new WebsiteSites(host.workspace),site=await sites.change({workspaceId:root.id,etag:(await host.workspace.outline()).etag,operation:'create',name:'Combined journal'});
  app=await testServer({root:host.workspace.root,deviceStore:host.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);await navigate(page,'Website editor');await page.locator('.website-site-context').getByRole('button',{name:'Websites',exact:true}).click();
  await page.locator('[data-website-directory] section').filter({has:page.getByRole('heading',{name:'Combined journal',exact:true})}).getByRole('button',{name:'Website editor',exact:true}).click();
  await page.getByRole('button',{name:'Create homepage',exact:true}).click();await addSection(page,'projects');
  const sources=page.locator('[data-publication-sources]');
  for(const label of ['Alpha','Beta']){
   await task(page,'Content');await sources.locator('section.website-record').filter({has:page.getByText('Project '+label,{exact:true})}).getByRole('button',{name:'Lab books',exact:true}).click();
   await sources.locator('section.website-record').filter({hasText:'Book '+label}).getByRole('button',{name:'Choose content',exact:true}).click();
   await sources.getByLabel('Include all records in this lab book',{exact:true}).check();await expect(sources.locator('[data-source-record]')).toBeChecked();
   if(label==='Alpha')await sources.getByRole('button',{name:'Choose a project or lab book',exact:true}).click();
  }
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await expect(page.frameLocator('#website-draft-preview').locator('body')).toContainText('Project Alpha');await expect(page.frameLocator('#website-draft-preview').locator('body')).toContainText('Project Beta');
  await page.locator('#website-preview-page').selectOption('find');await page.locator('#website-page-kind').selectOption('entry');await page.locator('#website-page-search').fill('Observation Alpha');
  await page.locator('[data-website-page-picker]').getByRole('button',{name:'Observation Alpha Book Alpha',exact:true}).click();await expect(page.frameLocator('#website-draft-preview').locator('body')).toContainText('Original observation Alpha',{timeout:20000});
  await page.locator('#website-preview-page').selectOption('index.html');await addSection(page,'link');await page.getByLabel('Link label',{exact:true}).fill('Read the other method');await page.getByRole('button',{name:'Choose section link',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Page type',{exact:true}).selectOption('entry');await page.getByRole('dialog').getByLabel('Find a page',{exact:true}).fill('Observation Beta');await page.getByRole('dialog').getByRole('button',{name:'Observation Beta Book Beta',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Method Beta',exact:true}).click();await expect(page.getByLabel('Link destination',{exact:true})).toHaveValue(/^entry:[a-f0-9-]+#record-section-[a-f0-9-]+$/);
  await task(page,'Add');await page.locator('.insert-grid [data-kind="media"]').click();const mediaPicker=page.locator('[data-research-media-picker]');await mediaPicker.locator('[data-research-media-search]').fill('Evidence Beta');await expect(mediaPicker.locator('[data-research-media-key]')).toHaveCount(1);await expect(mediaPicker).not.toContainText('Private evidence');await mediaPicker.locator('[data-research-media-key]').click();await expect(page.frameLocator('#website-draft-preview').locator('main img').first()).toBeVisible({timeout:20000});
  await task(page,'Content');await sources.locator('section.website-record').filter({has:page.getByText('Project Beta',{exact:true})}).getByRole('button',{name:'Lab books',exact:true}).click();await sources.locator('section.website-record').filter({hasText:'Book Beta'}).getByRole('button',{name:'Choose content',exact:true}).click();
  await sources.getByRole('button',{name:'Edit website page',exact:true}).click();await expect(page.frameLocator('#website-draft-preview').locator('body')).toContainText('Original observation Beta',{timeout:20000});
  await openPageSettings(page);await page.getByText('Page header',{exact:true}).click();await page.getByLabel('Display heading',{exact:true}).fill('Independent journal heading');await expect(page.frameLocator('#website-draft-preview').getByRole('heading',{name:'Independent journal heading',exact:true})).toBeVisible({timeout:20000});
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();await expect(page.frameLocator('#website-draft-preview').getByRole('heading',{name:'Independent journal heading',exact:true})).toBeVisible({timeout:20000});
  const saved=(await host.workspace.outline()).metadata.websites.find(value=>value.id===site.id);expect(saved.projectId).toBeNull();expect(saved.document.website.researchSources).toHaveLength(2);expect((await host.workspace.outline()).metadata.projects).toEqual([]);expect((await host.workspace.outline()).metadata.notebooks).toEqual([]);
  for(const owner of owners)expect((await owner.storage.read()).book).toEqual(owner.before.book);
  await page.screenshot({path:info.outputPath('combined-website.png')});
  await page.getByRole('button',{name:'Preview & export',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.locator('#full-public-preview')).toBeVisible({timeout:30000});
  await page.getByLabel('Preview page',{exact:true}).selectOption('index.html');
  const preview=await page.locator('#full-public-preview').getAttribute('href'),published=await page.context().newPage();published.setDefaultTimeout(15000);
  try{await published.goto(new URL(preview,app.url).href);await expect(published.locator('body')).toContainText('Project Alpha');await expect(published.locator('body')).toContainText('Project Beta');await expect(published.locator('main img').first()).toBeVisible();await expect.poll(()=>published.locator('main img').first().evaluate(image=>image.naturalWidth)).toBeGreaterThan(0);await published.getByRole('link',{name:'Read the other method',exact:true}).click();await expect(published.getByRole('heading',{name:'Method Beta',exact:true})).toBeInViewport();}finally{await published.close();}
  for(const owner of owners)expect((await owner.storage.read()).book).toEqual(owner.before.book);
  expect(errors).toEqual([]);
 }finally{await app?.close();await runtime.close();detach();for(const key of keys)clearVault(key);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await rm(directory,{recursive:true,force:true});}
});
