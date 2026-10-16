import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {initializeProjectLocation} from '../../src/project-storage.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {createWorkspaceAccess,takeCreatedVault} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
import {MediaStore} from '../../src/media.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {ResearchRecords} from '../../src/research.js';
import {RecordWriting} from '../../src/record-writing.js';
import {recordRevision} from '../../src/research.js';
import {proseText} from '../../src/web/prose-model.js';

test('project research routes preserve independent writing across reload and workspace navigation',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(10000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-ui-')),owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner),vaults=[];let app,db;const requests=[];
 try{
  const rootBook=sampleNotebook();rootBook.title='Workspace preferences identity';
  const f=await encryptedFixture(directory,rootBook);vaults.push(f.vault);const registry=new ProjectRegistry(f.workspace,rootBook.id);
  const create=async(name,relations=[])=>{const book=sampleNotebook();book.title=name;book.projects[0].title=name;book.entries[0].title=name+' observation';book.entries[0].body=name+' original';book.entries[0].relations=relations;const id=book.projects[0].id,access=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(access);vaults.push(vault);const storage=await initializeProjectLocation(path.join(directory,name),id,book,access,vault);await registry.attach(storage,{expected:(await registry.read()).revision});return {id,book,storage};};
  const b=await create('Project B'),materialsB=new ResearchMaterials(b.storage),foreignBytes=Buffer.from('Retained independent observation\n2,3,5\n');
  const uploadB=await materialsB.startImport({recordId:b.book.entries[0].id,name:'independent.csv',size:foreignBytes.length});await materialsB.appendImport(uploadB.id,0,[foreignBytes]);
  const artifactB=await materialsB.finishImport(uploadB.id),analysisB=await materialsB.analysis({recordId:b.book.entries[0].id,title:'Independent retained analysis',inputs:[artifactB],outputs:[],tool:'Observations',version:'1',parameters:''});
  const image=await readFile(new URL('../../src/preview-assets/image.png',import.meta.url)),media=await new MediaStore(b.storage).import(image,'image');
  const originalB=b.book.entries[0],retainedB={...originalB,attachments:[{id:media.id,kind:'image',alt:'Independent apparatus',caption:'Project apparatus',transcript:'',share:true}],results:{version:1,statements:[{id:randomUUID(),kind:'conclusion',title:'Independent conclusion',text:'Follow the exact evidence',basis:'retained',source:analysisB,limitations:'Recorded observations'}]}};
  await new ResearchRecords(b.storage,new MediaStore(b.storage)).save({workspaceId:b.book.id,changes:[{id:retainedB.id,expectedRevision:recordRevision(originalB),record:retainedB}]},{receipt:true});b.book.entries[0]=(await b.storage.read()).book.entries.find(record=>record.id===retainedB.id);
  const destination={workspaceId:b.book.id,kind:'record',id:b.book.entries[0].id},a=await create('Project A',[
   {id:randomUUID(),type:'Builds on',label:'Project B current',target:destination},
   {id:randomUUID(),type:'Builds on',label:'Project B retained',target:{...destination,revision:recordRevision(b.book.entries[0])}}
  ]),errors=[],writes=[];
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});
  page.on('response',response=>{if(response.url().includes('/api/'))requests.push([response.status(),new URL(response.url()).pathname]);});
  page.on('pageerror',error=>errors.push(error.message));page.on('request',req=>{if(req.method()==='POST'&&/writing\/save/.test(req.url()))writes.push(new URL(req.url()).pathname);});
  await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();
  db=await f.workspace.openCatalogue();await db.run('BEGIN');await db.lock();
  const url=project=>app.origin+'/#/owners/'+project.id+'/records/'+project.book.entries[0].id+'/read';
  await page.goto(url(a));await expect(page.locator('#main h1')).toHaveText('Project A observation');
  await page.locator('[data-action="writing-edit"]').first().click();const dialog=page.locator('dialog[open]');
  await dialog.locator('.ProseMirror').fill('Only Project A receives this writing.');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(page.locator('#main')).toContainText('Only Project A receives this writing.');
  expect(writes).toEqual(['/api/projects/'+a.id+'/research/records/writing/save']);
  await page.getByRole('button',{name:'Open evidence & analysis'}).click();
  await dialog.getByRole('button',{name:'Import original file',exact:true}).click();
  const original=Buffer.from('Time,Value\n0,1\n1,2\n');
  await dialog.getByLabel('Original file',{exact:true}).setInputFiles({name:'project-observation.csv',mimeType:'text/csv',buffer:original});
  await dialog.getByRole('button',{name:'Import original',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible({timeout:20000});
  const item=dialog.locator('.material-list li').filter({hasText:'project-observation.csv'});await expect(item).toBeVisible();
  const originalLink=item.getByRole('link');await expect(originalLink).toHaveAttribute('href',new RegExp('^/api/projects/'+a.id+'/research/materials/original/'));
  const downloading=page.waitForEvent('download',{timeout:15000});await originalLink.click();const download=await downloading;expect(await readFile(await download.path())).toEqual(original);
  expect(requests.some(([status,route])=>status===200&&route.startsWith('/api/projects/'+a.id+'/research/materials/chunk/'))).toBe(true);
  expect(requests.some(([,route])=>route.startsWith('/api/research/materials/'))).toBe(false);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();

  await page.goto(url(b));await expect(page.locator('#main h1')).toHaveText('Project B observation');await expect(page.locator('#main')).toContainText('Project B original');
  const assertImage=async host=>{const picture=host.locator('img[alt="Independent apparatus"]').first();await expect(picture).toHaveAttribute('src','/api/projects/'+b.id+'/media/'+media.id);await expect.poll(()=>picture.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);};
  await assertImage(page.locator('#main'));await page.locator('[data-action="record-edit"]').click();await assertImage(page.locator('#main'));await page.locator('[data-action="record-read"]').click();
  await page.getByRole('button',{name:'History',exact:true}).click();await dialog.locator('[data-action="record-history-select"]').first().click();await assertImage(dialog);await dialog.getByRole('button',{name:'Close',exact:true}).click();

  await page.getByRole('button',{name:'Preferences',exact:true}).click();await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue(path.basename(f.workspace.root));expect(new URL(page.url()).hash).toBe('#/preferences/general');
  await page.goBack();await expect(page.locator('#main h1')).toHaveText('Project B observation');
  await page.goto(url(a));await expect(page.locator('#main')).toContainText('Only Project A receives this writing.');
  await page.getByRole('button',{name:'Project B current',exact:true}).click();await expect(page.locator('#main h1')).toHaveText('Project B observation');
  expect(new URL(page.url()).hash).toContain('/owners/'+b.id+'/');
  await page.goto(url(a));await page.getByRole('button',{name:'Project B retained',exact:true}).click();
  await expect(page.locator('.retained-record-reader')).toContainText('Project B original');await assertImage(page.locator('.retained-record-reader'));
  const analysisLink=page.locator('.retained-record-reader [data-action="material-reference"]').filter({hasText:analysisB.id});
  await expect(analysisLink).toHaveAttribute('data-ref',new RegExp(b.book.id));await analysisLink.click();
  await expect(dialog.getByRole('heading',{name:'Independent retained analysis',exact:true})).toBeVisible();
  await dialog.locator('[data-action="material-reference"][data-ref*="'+artifactB.id+'"]').click();
  await expect(dialog.getByRole('button',{name:'Download original',exact:true})).toBeVisible();
  const foreignDownload=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download original',exact:true}).click();
  expect(await readFile(await(await foreignDownload).path())).toEqual(foreignBytes);
  expect(new URL(page.url()).hash).toContain('/owners/'+a.id+'/');
  expect(await materialsB.read(analysisB)).toEqual(await materialsB.read({...analysisB,workspaceId:b.book.id}));
  expect(requests.some(([status,route])=>status===200&&route==='/api/projects/material-reference/read')).toBe(true);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.locator('#main h1')).toHaveText('Project A observation');expect(new URL(page.url()).hash).toContain('/owners/'+a.id+'/');
  const lock=await page.evaluate(async id=>{
   const storage=await fetch('/api/storage').then(r=>r.json());return (await fetch('/api/projects/'+id+'/access/lock',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':storage.contextId},body:'{}'})).status;
  },b.id);expect(lock).toBe(200);
  await page.getByRole('button',{name:'Project B current',exact:true}).click();const unlock=page.locator('#project-unlock-form');await expect(unlock).toBeVisible();
  await unlock.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.locator('#main h1')).toHaveText('Project A observation');
  await page.getByRole('button',{name:'Project B current',exact:true}).click();await unlock.getByRole('button',{name:'Unlock',exact:true}).click();await expect(page.locator('#main h1')).toHaveText('Project B observation');
  await page.goto(url(a));await expect(page.locator('#main h1')).toHaveText('Project A observation');
  await page.screenshot({path:test.info().outputPath('project-record.png'),fullPage:true});
  const read=p=>new RecordWriting(p.storage).read({workspaceId:p.book.id,recordId:p.book.entries[0].id,sectionId:null});
  expect(proseText((await read(a)).value.body)).toContain('Only Project A receives this writing.');expect((await read(b)).value.body).toBe('Project B original');expect((await f.workspace.outline()).metadata.title).toBe(path.basename(f.workspace.root));expect(requests.filter(([,route])=>route.startsWith('/api/media/'))).toEqual([]);expect(requests.filter(([status,route])=>route.includes('/media/')&&status>=400)).toEqual([]);expect(errors).toEqual([]);
 }catch(error){console.log(JSON.stringify({url:page.url(),requests,visible:await page.locator('body').innerText()}));throw error;}finally{await page.close();await db?.close();await app?.close();await owner.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
