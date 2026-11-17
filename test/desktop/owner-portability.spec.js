import {test,expect} from '@playwright/test';
import {mkdir,readFile,rename,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {desktopFixture} from './fixture.js';
import {desktopAccess} from './access.js';

const projectRoute=id=>'/api/projects/'+id;
const bookRoute=book=>projectRoute(book.projectId)+'/lab-books/'+book.labBookId;

// All authoring, transfer and publication requests enter the running desktop's
// authenticated HTTP service. No source storage or service implementation is
// imported here, so the same journey qualifies a selected packaged executable.
test('desktop portable owners preserve originals and links',async()=>{
 test.setTimeout(600000);
 const fixture=await desktopFixture('observanda-desktop-portability-'),{directory,start}=fixture;
 const sourceName='Field workspace caf\u00e9 1',sourceRoot=path.join(directory,sourceName),receivingName='Receiving workspace 2',receivingRoot=path.join(directory,receivingName);
 const access=desktopAccess(),{credentials}=access;
 const errors=[];let app,page,primaryFailure=null;
 const watch=async()=>{page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));await page.waitForURL(url=>url.protocol==='http:',{timeout:60000});await page.waitForFunction(()=>['access','setup','workspace'].includes(document.documentElement.dataset.appMode),null,{timeout:60000});};
 const call=(route,data)=>page.evaluate(async({route,data})=>{
  const storage=await (await fetch('/api/storage')).json();
  const response=await fetch(route,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':storage.contextId,'X-Observanda-Wait':'1'},...(data===undefined?{}:{body:JSON.stringify(data)})});
  if(!response.ok)throw Error(route+' returned '+response.status+': '+await response.text());return response.json();
 },{route,data});
 const bytes=route=>page.evaluate(async route=>{
  const response=await fetch(route);if(!response.ok)throw Error(route+' returned '+response.status);return Array.from(new Uint8Array(await response.arrayBuffer()));
 },route).then(value=>Buffer.from(value));
 const selection=book=>call(bookRoute(book)+'/workspace/read/selection',{workspaceId:book.namespaceId,ids:book.records.map(record=>record.id)});
 const createProject=async(title,parentId=null)=>{const {project}=await call('/api/projects/create',{id:randomUUID(),...credentials,project:{id:randomUUID(),title,parentId,description:'',share:false,logoId:null}});if(credentials.password)await call(projectRoute(project.projectId)+'/access/unlock',{...credentials,recovery:''});return project;};
 const unavailable=async root=>{
  const relative=path.relative(directory,root);expect(relative).not.toBe('');expect(relative.startsWith('..')).toBe(false);expect(path.isAbsolute(relative)).toBe(false);
  await rename(root,root+' unavailable');await expect(stat(root)).rejects.toMatchObject({code:'ENOENT'});
 };
 try{
  console.log(fixture.packaged?'Portable owners: selected executable.':'Portable owners: source Electron (not an installed build).');
  app=await start();await watch();
  const identity=await app.evaluate(({app})=>({packaged:app.isPackaged,executable:process.execPath,profile:app.getPath('userData')}));
  expect(identity.packaged).toBe(!!fixture.packaged);
  expect(path.resolve(identity.profile)).toBe(path.join(directory,...(fixture.packaged?['.observanda','window']:['window'])));
  if(fixture.packaged)expect(path.resolve(identity.executable).toLowerCase()).toBe(path.resolve(fixture.packaged).toLowerCase());
  await expect(page.getByRole('heading',{name:'Create a workspace',exact:true})).toBeVisible({timeout:60000});
  await page.getByLabel('Workspace name',{exact:true}).fill(sourceName);
  await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('Create in',{exact:true}).fill(directory);await access.setup(page);await page.getByRole('button',{name:'Create workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText(sourceName,{timeout:60000});
  // Projects sit side by side; each lab book lives directly inside one project.
  const parent=await createProject('Field project \u00c5 1'),independent=await createProject('Independent project 3');
  expect(parent.root).toBe(path.join(sourceRoot,'Field project \u00c5 1'));expect(independent.root).toBe(path.join(sourceRoot,'Independent project 3'));
  const books=[];
  for(const [index,owner] of [independent,parent].entries()){
   const title=index?'Observations caf\u00e9 2':'Independent observations 1';
   const book=(await call(projectRoute(owner.projectId)+'/lab-books/create',{id:randomUUID(),...credentials,book:{id:randomUUID(),projectId:owner.projectId,title}})).book;
   Object.assign(book,{projectId:owner.projectId,title});if(credentials.password)await call(bookRoute(book)+'/access/unlock',{...credentials,recovery:''});expect(book.root).toBe(path.join(owner.root,title));
   const now=new Date().toISOString();
   // Each record keeps its own sharing consent.
   // The second record and the original evidence remain private through import.
   book.records=[false,true].map(privateRecord=>({id:randomUUID(),notebookId:book.labBookId,type:'experiment',title:privateRecord?'WITHHELD_RECORD_'+index:'Selected observation '+index,body:privateRecord?'PRIVATE_OBSERVATION_'+index:'Original observation '+index,contributors:[],relations:[],tags:[],occurredOn:'2026-10-17',createdAt:now,updatedAt:now,share:!privateRecord,figures:[],status:'draft',attachments:[],sections:[]}));
   await call(bookRoute(book)+'/research/records/save',{workspaceId:book.namespaceId,changes:book.records.map(record=>({id:record.id,expectedRevision:null,record}))});
   books.push(book);
  }
  const initial=await selection(books[1]),retained={workspaceId:books[1].namespaceId,kind:'record',id:books[1].records[0].id,revision:initial.recordRevisions[books[1].records[0].id]};
  expect(retained.revision).toMatch(/^[a-f0-9]{64}$/);
  for(const [index,book] of books.entries()){
   book.originalRevision=(await selection(book)).recordRevisions[book.records[0].id];
   const address={workspaceId:book.namespaceId,recordId:book.records[0].id,sectionId:null},writing=await call(bookRoute(book)+'/research/records/writing/read',address);
   await call(bookRoute(book)+'/research/records/writing/save',{...address,expectedRevision:writing.revision,value:{body:'Later selected observation '+index}});
   book.original=Buffer.from('PRIVATE_ORIGINAL_'+index+'\r\nreading,value\r\n1,2.5\r\n2,3.75\r\n','utf8');
   const upload=await call(bookRoute(book)+'/research/materials/start',{recordId:book.records[0].id,name:'Measurements '+index+'.csv',size:book.original.length});
   await page.evaluate(async({route,bytes})=>{
    const storage=await (await fetch('/api/storage')).json(),response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Observanda-Workspace':storage.contextId},body:new Uint8Array(bytes)});
    if(!response.ok)throw Error('Original upload failed: '+await response.text());
   },{route:bookRoute(book)+'/research/materials/chunk/'+upload.id+'/0',bytes:Array.from(book.original)});
   await call(bookRoute(book)+'/research/materials/finish',{id:upload.id});let job;
   await expect.poll(async()=>{job=(await call(bookRoute(book)+'/research/materials/job',{id:upload.id})).job;return job.state;},{timeout:60000}).toBe('completed');book.evidence=job.result;
  }
  const current=await selection(books[0]),record=current.book.entries.find(record=>record.id===books[0].records[0].id);
  await call(bookRoute(books[0])+'/research/records/save',{workspaceId:books[0].namespaceId,changes:[{id:record.id,expectedRevision:current.recordRevisions[record.id],record:{...record,relations:[{id:randomUUID(),type:'Builds on',target:retained,label:'Earlier independent observation'}]}}]});
  for(const book of books)book.saved=(await selection(book)).book.entries;
  const copies=path.join(directory,'Copies'),projectCopies=path.join(copies,'Projects'),bookCopies=path.join(copies,'Books');
  await mkdir(projectCopies,{recursive:true});await mkdir(bookCopies);
  await call(bookRoute(books[0])+'/storage/copy',{id:randomUUID(),parent:bookCopies});
  await call(projectRoute(parent.projectId)+'/storage/copy',{id:randomUUID(),parent:projectCopies});
  const copiedProject=path.join(projectCopies,path.basename(parent.root)),copiedBook=path.join(bookCopies,books[0].title);
  console.log('Portable owners: authored two books, retained history/link and exact originals; copied one book and the project holding the other.');
  await fixture.close(app);app=null;await unavailable(sourceRoot);
  app=await start();await watch();expect(await page.evaluate(()=>document.documentElement.dataset.appMode)).toBe('access');
  await call('/api/notebook/create',{title:receivingName,storageParent:directory,...credentials,createNew:true});
  await page.reload();await expect(page.locator('.workspace-name')).toHaveText(receivingName,{timeout:60000});
  const imported=await call('/api/projects/open',{id:randomUUID(),path:copiedProject,parentId:null,...credentials,recovery:'',owners:credentials.password?[{relative:books[1].title,...credentials,recovery:''}]:[]});
  expect(imported.project.projectId).toBe(parent.projectId);expect(imported.project.root).toBe(path.join(receivingRoot,path.basename(parent.root)));
  if(credentials.password)await call(projectRoute(parent.projectId)+'/access/unlock',{...credentials,recovery:''});
  await call(projectRoute(parent.projectId)+'/lab-books/import',{id:randomUUID(),path:copiedBook,...credentials,recovery:''});
  const unlockImported=async()=>{if(!credentials.password)return;
   await call(projectRoute(parent.projectId)+'/access/unlock',{...credentials,recovery:''});
   for(const book of books)await call(bookRoute(book)+'/access/unlock',{...credentials,recovery:''});
  };
  books[0].projectId=parent.projectId;books[0].root=path.join(imported.project.root,books[0].title);books[1].root=path.join(imported.project.root,books[1].title);
  await fixture.close(app);app=null;await unavailable(copiedProject);await unavailable(copiedBook);
  app=await start();await watch();if(credentials.password)await access.unlock(page);await expect(page.locator('.workspace-name')).toHaveText(receivingName,{timeout:60000});
  await unlockImported();
  for(const book of books){
   expect((await selection(book)).book.entries).toEqual(book.saved);
   const history=await call(bookRoute(book)+'/research/records/history/list',{workspaceId:book.namespaceId,recordId:book.records[0].id});expect(history.versions.some(version=>version.revision===book.originalRevision)).toBe(true);
   const head=await call(bookRoute(book)+'/workspace/read/start',{});expect(head.metadata.id).toBe(book.namespaceId);expect(head.metadata.notebooks[0].id).toBe(book.labBookId);expect(head.metadata.notebooks[0].projectId).toBe(book.projectId);
   const context=(await call('/api/storage')).contextId,original='/api/projects/material-reference/original/'+book.namespaceId+'/'+book.evidence.id+'/'+book.evidence.revision+'?context='+encodeURIComponent(context);
   expect(await bytes(original)).toEqual(book.original);
   if(book===books[0]){
    const download=await fixture.download(app,()=>page.evaluate(href=>{const link=document.createElement('a');link.href=href;link.download='';document.body.append(link);link.click();link.remove();},original));
    expect(await readFile(download.file)).toEqual(book.original);expect(download.bytes).toBe(book.original.length);
   }
  }
  expect((await call('/api/projects/material-reference/record',{ref:retained})).value.previous.record.body).toBe('Original observation 1');
  const location=await call('/api/projects/reference-location',retained);expect(location.projectId).toBe(parent.projectId);expect(location.labBookId).toBe(books[1].labBookId);
  // Continue authoring in the independently imported owner after every source
  // location is unavailable, then retain this new write through the next restart.
  const importedBook=books[0],address={workspaceId:importedBook.namespaceId,recordId:importedBook.records[0].id,sectionId:null};
  const importedWriting=await call(bookRoute(importedBook)+'/research/records/writing/read',address),amendedBody='Later selected observation 0. Continued after import.';
  await call(bookRoute(importedBook)+'/research/records/writing/save',{...address,expectedRevision:importedWriting.revision,value:{body:amendedBody}});
  const amended=(await selection(importedBook)).book.entries,amendedRecord=amended.find(record=>record.id===address.recordId);
  expect(amendedRecord.body).toBe(amendedBody);expect(amendedRecord.relations).toEqual(importedBook.saved.find(record=>record.id===address.recordId).relations);
  expect(amended.find(record=>record.id===importedBook.records[1].id)).toEqual(importedBook.saved.find(record=>record.id===importedBook.records[1].id));importedBook.saved=amended;
  console.log('Portable owners: reopened imported owners with original workspace and copy locations unavailable; originals, history and cross-owner reference match.');
  for(const book of books)expect((await selection(book)).book.entries).toEqual(book.saved);
  expect(errors).toEqual([]);await fixture.close(app);app=null;
  // One workspace, one database: imported projects and books are held in the
  // receiving workspace's database, which is stopped with the application.
  await stat(path.join(receivingRoot,'.observanda/postgresql/data/PG_VERSION'));
  await expect(stat(path.join(receivingRoot,'.observanda/postgresql/data/postmaster.pid'))).rejects.toMatchObject({code:'ENOENT'});
  for(const root of [imported.project.root,...books.map(book=>book.root)])await expect(stat(path.join(root,'.observanda/postgresql'))).rejects.toMatchObject({code:'ENOENT'});
  console.log('Portable owners: imported books unchanged; one workspace database holds them and is stopped.');
 }catch(error){primaryFailure=error;console.error('Portable owners primary failure: '+(error.stack??error));throw error;}finally{
  try{await fixture.dispose(app);}catch(error){if(!primaryFailure)throw error;console.error('Portable owners secondary cleanup failure: '+(error.stack??error));}
 }
});
