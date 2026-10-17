import {test,expect} from '@playwright/test';
import {mkdir,readFile,rename,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {desktopFixture} from './fixture.js';
import {task} from '../browser/composer-helper.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const projectRoute=id=>'/api/projects/'+id;
const bookRoute=book=>projectRoute(book.projectId)+'/lab-books/'+book.labBookId;

// All authoring, transfer and publication requests enter the running desktop's
// authenticated HTTP service. No source storage or service implementation is
// imported here, so the same journey qualifies a selected packaged executable.
test('desktop portable owners preserve originals and links and publish only selected sources',async()=>{
 test.setTimeout(600000);
 const fixture=await desktopFixture('observanda-desktop-portability-'),{directory,start}=fixture;
 const sourceName='Field workspace caf\u00e9 1',sourceRoot=path.join(directory,sourceName),receivingName='Receiving workspace 2',receivingRoot=path.join(directory,receivingName);
 const errors=[];let app,page;
 const watch=async()=>{page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));await page.waitForURL(url=>url.protocol==='http:',{timeout:60000});await page.waitForFunction(()=>['access','setup','workspace'].includes(document.documentElement.dataset.appMode),null,{timeout:60000});};
 const call=(route,data,websiteId=null)=>page.evaluate(async({route,data,websiteId})=>{
  const storage=await (await fetch('/api/storage')).json();
  const response=await fetch(route,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':storage.contextId,'X-Observanda-Wait':'1',...(websiteId?{'X-Observanda-Website':websiteId}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  if(!response.ok)throw Error(route+' returned '+response.status+': '+await response.text());return response.json();
 },{route,data,websiteId});
 const bytes=route=>page.evaluate(async route=>{
  const response=await fetch(route);if(!response.ok)throw Error(route+' returned '+response.status);return Array.from(new Uint8Array(await response.arrayBuffer()));
 },route).then(value=>Buffer.from(value));
 const selection=book=>call(bookRoute(book)+'/workspace/read/selection',{workspaceId:book.namespaceId,ids:book.records.map(record=>record.id)});
 const createProject=async(title,parentId=null)=>(await call('/api/projects/create',{id:randomUUID(),username:'',password:'',project:{id:randomUUID(),title,parentId,description:'',share:false,logoId:null}})).project;
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
  await page.getByLabel('Create in',{exact:true}).fill(directory);await page.getByLabel('Use this device',{exact:false}).check();await page.getByRole('button',{name:'Create workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText(sourceName,{timeout:60000});
  const parent=await createProject('Field project 1'),child=await createProject('Nested project \u00c5 2',parent.projectId),independent=await createProject('Independent project 3');
  expect(parent.root).toBe(path.join(sourceRoot,'Field project 1'));expect(child.root).toBe(path.join(parent.root,'Nested project \u00c5 2'));
  const books=[];
  for(const [index,owner] of [independent,child].entries()){
   const title=index?'Observations caf\u00e9 2':'Independent observations 1';
   const book=(await call(projectRoute(owner.projectId)+'/lab-books/create',{id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId:owner.projectId,title}})).book;
   Object.assign(book,{projectId:owner.projectId,title});expect(book.root).toBe(path.join(owner.root,title));
   const now=new Date().toISOString();
   book.records=[false,true].map(privateRecord=>({id:randomUUID(),notebookId:book.labBookId,type:'experiment',title:privateRecord?'WITHHELD_RECORD_'+index:'Selected observation '+index,body:privateRecord?'PRIVATE_OBSERVATION_'+index:'Original observation '+index,contributors:[],relations:[],tags:[],occurredOn:'2026-10-17',createdAt:now,updatedAt:now,share:false,figures:[],status:'draft',attachments:[],sections:[]}));
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
  console.log('Portable owners: authored two books, retained history/link and exact originals; copied selected book and nested project.');
  await fixture.close(app);app=null;await unavailable(sourceRoot);
  app=await start();await watch();expect(await page.evaluate(()=>document.documentElement.dataset.appMode)).toBe('access');
  await call('/api/notebook/create',{title:receivingName,storageParent:directory,username:'',password:'',createNew:true});
  await page.reload();await expect(page.locator('.workspace-name')).toHaveText(receivingName,{timeout:60000});
  // The website owns only consent and presentation. Save stable source identities
  // before import, including a book whose project placement will change.
  const sites=await call('/api/websites/list',{}),created=await call('/api/websites/change',{workspaceId:sites.workspaceId,etag:sites.etag,operation:'create',name:'Independent field journal',projectId:null});
  const website={workspaceId:sites.workspaceId,websiteId:created.id};
  let site=await call('/api/websites/editor/open',{...website,websitePin:created.websitePin});expect(site.site.projectId).toBeNull();
  const sources=books.map(book=>({workspaceId:book.namespaceId,labBookId:book.labBookId,projectIds:[book.projectId],selection:{defaultShare:false,includeProjects:[],records:[{id:book.records[0].id,share:true,attachments:[]}]}}));
  site=await call('/api/websites/editor/change',{...website,websitePin:site.websitePin,draftId:null,expectedRevision:null,commandId:randomUUID(),operations:[{type:'settings',path:['document','website','researchSources'],value:sources}]});
  await call('/api/websites/editor/save',{...website,websitePin:site.websitePin,draftId:site.draft.id,expectedRevision:site.draft.revision,commandId:randomUUID()});
  const imported=await call('/api/projects/open',{id:randomUUID(),path:copiedProject,parentId:null,username:'',password:'',recovery:'',owners:[]});
  expect(imported.project.projectId).toBe(parent.projectId);expect(imported.project.root).toBe(path.join(receivingRoot,path.basename(parent.root)));
  await call(projectRoute(parent.projectId)+'/lab-books/import',{id:randomUUID(),path:copiedBook,username:'',password:'',recovery:''});
  books[0].projectId=parent.projectId;books[0].root=path.join(imported.project.root,books[0].title);books[1].root=path.join(imported.project.root,path.basename(child.root),books[1].title);
  await fixture.close(app);app=null;await unavailable(copiedProject);await unavailable(copiedBook);
  app=await start();await watch();await expect(page.locator('.workspace-name')).toHaveText(receivingName,{timeout:60000});
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
  expect((await call('/api/projects/reference',retained)).value.body).toBe('Original observation 1');
  const location=await call('/api/projects/reference-location',retained);expect(location.projectId).toBe(child.projectId);expect(location.labBookId).toBe(books[1].labBookId);
  // Continue authoring in the independently imported owner after every source
  // location is unavailable, then retain this new write through the next restart.
  const importedBook=books[0],address={workspaceId:importedBook.namespaceId,recordId:importedBook.records[0].id,sectionId:null};
  const importedWriting=await call(bookRoute(importedBook)+'/research/records/writing/read',address),amendedBody='Later selected observation 0. Continued after import.';
  await call(bookRoute(importedBook)+'/research/records/writing/save',{...address,expectedRevision:importedWriting.revision,value:{body:amendedBody}});
  const amended=(await selection(importedBook)).book.entries,amendedRecord=amended.find(record=>record.id===address.recordId);
  expect(amendedRecord.body).toBe(amendedBody);expect(amendedRecord.relations).toEqual(importedBook.saved.find(record=>record.id===address.recordId).relations);
  expect(amended.find(record=>record.id===importedBook.records[1].id)).toEqual(importedBook.saved.find(record=>record.id===importedBook.records[1].id));importedBook.saved=amended;
  site=await call('/api/websites/editor/open',website);expect(site.site.document.website.researchSources).toEqual(sources);expect(site.research.count).toBe(0);expect(site.research.metadata.entries).toBeUndefined();
  console.log('Portable owners: reopened imported owners with original workspace and copy locations unavailable; originals, history and cross-owner reference match.');
  await page.evaluate(id=>location.hash='#/websites/'+id+'/editor',created.id);await expect(page.locator('.website-site-context')).toContainText('Independent field journal');
  // Explicitly place one website-owned original download; research originals and
  // unselected records remain private even though both books are selected sources.
  const publicBytes=Buffer.from('Public original capture\r\n\u00c5,1.25\r\n\u03b1,2.75\r\n'),publicName='Donn\u00e9es \u03b1.csv';
  await page.getByRole('button',{name:'Add page',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill('Selected original download');
  const downloadPage=await page.getByLabel('Page',{exact:true}).inputValue();
  await task(page,'Page');await page.locator('[data-palette-kind=download]').click();await page.frameLocator('#website-draft-preview').locator('.section-download>.canvas-section-edit').click();
  await page.getByLabel('Upload an original file',{exact:true}).setInputFiles({name:publicName,mimeType:'text/csv',buffer:publicBytes});await expect(page.locator('.website-file-name')).toContainText(publicName);
  await page.getByLabel('Download label',{exact:true}).fill('Get selected original');await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.getByRole('button',{name:'Preview & export',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible({timeout:60000});
  const reviewRoute=new URL(page.url()).hash;await page.getByLabel('Preview page',{exact:true}).selectOption(downloadPage);
  const preview=new URL(await page.locator('#full-public-preview').getAttribute('href'),page.url());
  // The download page may be nested under pages/. Retained edition roots are
  // addressed by their 64-character review identity, independently of that page.
  const match=preview.pathname.match(/^\/preview\/([a-f0-9]{64})\//);expect(match).not.toBeNull();
  const publicUrl=name=>{const url=new URL('/preview/'+match[1]+'/'+name,page.url());url.search=preview.search;return url.href;};
  const manifestBytes=await bytes(publicUrl('publication.json')),manifest=JSON.parse(manifestBytes);
  expect(manifest.entries).toHaveLength(2);const rendered=[];
  for(const file of manifest.files){
   const content=await bytes(publicUrl(file.path));expect(content.length,file.path).toBe(file.bytes);expect(hash(content),file.path).toBe(file.sha256);rendered.push(content);
  }
  const allPublic=Buffer.concat(rendered).toString('utf8');
  for(const index of [0,1]){expect(allPublic).toContain('Later selected observation '+index);expect(allPublic).not.toContain('WITHHELD_RECORD_'+index);expect(allPublic).not.toContain('PRIVATE_OBSERVATION_'+index);expect(allPublic).not.toContain('PRIVATE_ORIGINAL_'+index);}
  expect(allPublic).toContain('Continued after import.');expect(allPublic).not.toContain(directory);expect(manifest.files.filter(file=>file.path.startsWith('downloads/'))).toHaveLength(1);
  const downloadEntry=manifest.files.find(file=>file.path.startsWith('downloads/'));expect(await bytes(publicUrl(downloadEntry.path))).toEqual(publicBytes);
  const publicDownload=await fixture.download(app,()=>page.frameLocator('iframe[title="Publication preview"]').getByRole('link',{name:'Get selected original',exact:true}).click());
  expect(publicDownload.name).toBe(publicName);expect(await readFile(publicDownload.file)).toEqual(publicBytes);
  console.log('Portable owners: continued authoring saved in imported book; selected edition hashes, private exclusions and native public original match.');
  // Restart into the retained review: both the prepared files and the native
  // ZIP must be byte-identical to the authenticated service's retained edition.
  await fixture.close(app);app=null;app=await start();await watch();await expect(page.locator('.workspace-name')).toHaveText(receivingName,{timeout:60000});
  await page.evaluate(route=>location.hash=route,reviewRoute);await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible();
  const context=(await call('/api/storage')).contextId;preview.search='?context='+encodeURIComponent(context);
  expect(await bytes(publicUrl('publication.json'))).toEqual(manifestBytes);
  for(const file of manifest.files)expect(hash(await bytes(publicUrl(file.path))),file.path).toBe(file.sha256);
  await page.getByLabel('I have reviewed this website and its media for sharing.').check();
  console.log('Portable owners: retained review and every file hash match after restart; downloading the same edition ZIP.');
  const archive=await fixture.download(app,()=>page.getByRole('button',{name:'Download website ZIP',exact:true}).click());
  const archiveBytes=await readFile(archive.file);expect(archive.name).toBe('observanda-site.zip');expect(archiveBytes).toEqual(await bytes('/api/export/'+match[1]+'?context='+encodeURIComponent(context)));
  for(const marker of ['WITHHELD_RECORD_','PRIVATE_OBSERVATION_','PRIVATE_ORIGINAL_',directory])expect(archiveBytes.includes(Buffer.from(marker))).toBe(false);
  for(const book of books)expect((await selection(book)).book.entries).toEqual(book.saved);
  expect(errors).toEqual([]);await fixture.close(app);app=null;
  for(const root of [receivingRoot,imported.project.root,path.dirname(books[1].root),...books.map(book=>book.root)]){
   await stat(path.join(root,'.observanda/postgresql/data/PG_VERSION'));
   await expect(stat(path.join(root,'.observanda/postgresql/data/postmaster.pid'))).rejects.toMatchObject({code:'ENOENT'});
  }
  console.log('Portable owners: selected-source edition retained across restart; manifest hashes, public original and native ZIP bytes verified; private records/evidence excluded; owner processes stopped.');
 }finally{await fixture.dispose(app);}
});
