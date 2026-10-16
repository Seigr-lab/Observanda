import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {testServer as startServer} from './device-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {initializeLocation,readPreference,workspaceManifest} from '../src/locations.js';
import {createAccess} from '../src/access.js';
import {Workspace} from '../src/storage.js';

async function setup(t,{protected:secure=false,create=true}={}){
  const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-auth-service-')),root=path.join(parent,'workspace'),preferencesFile=path.join(parent,'settings','preferences.json');
  if(create)await initializeLocation(root,sampleNotebook(),await createAccess(secure?'Researcher':'',secure?'synthetic password 123':''));
  const app=await startServer({root,port:0,preferencesFile});t.after(()=>app.close());
  async function client(){
    const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});
    const cookie=session.headers.get('set-cookie').split(';')[0];
    const c={context:null,request:(route,data,options={})=>fetch(app.origin+route,{...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)}),headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json',...(c.context?{'X-Observanda-Workspace':c.context}:{}),...options}})};return c;
  }
  return {...app,parent,root,preferencesFile,client};
}

test('protected launch links require sign-in for every private route, previews and downloads',async t=>{
  const app=await setup(t,{protected:true}),client=await app.client();
  assert.equal((await client.request('/api/access/status')).status,200);
  for(const route of ['/api/dashboard','/api/notebook','/api/storage','/api/workspaces','/api/history','/api/laboratory','/api/publishing','/api/media/00000000-0000-4000-8000-000000000001','/api/fonts','/api/fonts/custom-'+ '0'.repeat(64),'/preview/'+ '0'.repeat(64)+'/index.html'])assert.equal((await client.request(route)).status,401,route);
  for(const route of ['/api/fonts/import','/api/fonts/update','/api/research/records/query','/api/research/records/open','/api/workspace/read/start','/api/workspace/read/page'])assert.equal((await client.request(route,{})).status,401,route);
  for(const operation of ['start','part','finish','readPart','readBase'])assert.equal((await client.request('/api/research/drafts/transfer/'+operation,{})).status,401,operation);
  assert.equal((await client.request('/api/storage/browse',{path:app.parent})).status,401);
  assert.equal((await client.request('/api/storage/folder',{parent:app.parent,name:'Blocked creation'})).status,401);
  await assert.rejects(readFile(path.join(app.parent,'Blocked creation')),{code:'ENOENT'});
  assert.equal((await client.request('/api/access/unlock',{username:'Researcher',password:'wrong'})).status,401);
  assert.equal((await client.request('/api/access/unlock',{username:'Researcher',password:'synthetic password 123'})).status,200);
  const saved=await (await client.request('/api/notebook')).json();assert.ok(saved.book);
  const previewResponse=await client.request('/api/preview',{etag:saved.etag}),preview=await previewResponse.json();assert.equal(previewResponse.status,200,JSON.stringify(preview));assert.equal((await client.request(preview.url)).status,200);
  assert.equal((await client.request('/api/access/lock',{})).status,200);
  assert.equal((await client.request(preview.url)).status,401);assert.equal((await client.request('/api/export',{id:preview.id})).status,401);
  assert.equal((await (await app.client()).request('/api/notebook')).status,401);
});

test('access changes require the existing password and invalidate other authenticated sessions',async t=>{
  const app=await setup(t,{protected:true}),first=await app.client(),second=await app.client();
  for(const c of [first,second])await c.request('/api/access/unlock',{username:'Researcher',password:'synthetic password 123'});
  const original=await (await first.request('/api/notebook')).json();
  let response=await first.request('/api/access/change',{username:'Private account',password:'first synthetic password',currentPassword:'synthetic password 123'});assert.equal(response.status,200);
  assert.equal((await second.request('/api/notebook')).status,401);
  response=await first.request('/api/access/change',{username:'Owner',password:'second synthetic password',currentPassword:'wrong'});assert.equal(response.status,401);
  response=await first.request('/api/access/change',{username:'Owner',password:'second synthetic password',currentPassword:'first synthetic password'});assert.equal(response.status,200);
  assert.equal((await (await first.request('/api/notebook')).json()).etag,original.etag);
  const preview=await (await first.request('/api/preview',{etag:original.etag})).json();const zip=Buffer.from(await (await first.request('/api/export',{id:preview.id})).arrayBuffer()).toString();
  for(const privateValue of ['Private account','first synthetic password','second synthetic password','access.json',app.root])assert.ok(!zip.includes(privateValue));
});

test('password attempts are limited across new launch sessions and the Open workspace route',async t=>{
  const app=await setup(t),client=await app.client(),protectedRoot=path.join(app.parent,'protected');
  await initializeLocation(protectedRoot,sampleNotebook(),await createAccess('Owner','another synthetic password'));
  for(let i=0;i<5;i++)assert.equal((await client.request('/api/storage/open',{path:protectedRoot,username:'Owner',password:'wrong'})).status,401);
  const fresh=await app.client();assert.equal((await fresh.request('/api/storage/open',{path:protectedRoot,username:'Owner',password:'wrong'})).status,429);
  assert.ok((await (await client.request('/api/notebook')).json()).book);
});

test('copying switches only after review and verification and rejects old-tab writes',async t=>{
  const app=await setup(t),client=await app.client(),other=await app.client(),before=await new Workspace(app.root).read();
  const initial=await (await client.request('/api/storage')).json();client.context=initial.contextId;other.context=initial.contextId;
  const destination=path.join(app.parent,'new storage'),plan=await (await client.request('/api/storage/copy/preview',{path:destination})).json();
  assert.equal((await client.request('/api/storage/copy',{id:plan.id,reviewed:false})).status,409);
  const copied=await (await client.request('/api/storage/copy',{id:plan.id,reviewed:true})).json();assert.equal(copied.root,destination);client.context=copied.contextId;
  assert.equal((await new Workspace(app.root).read()).etag,before.etag);const transferred=await new Workspace(destination).read();assert.deepEqual(transferred.book.entries,before.book.entries);assert.equal(transferred.book.id,before.book.id);assert.equal(transferred.book.title,path.basename(destination));
  assert.equal(await readPreference(app.preferencesFile),destination);
  assert.equal((await other.request('/api/notebook/save',before)).status,409);
  for(const route of ['/api/fonts/import','/api/fonts/update','/api/research/records/query','/api/research/records/open','/api/workspace/read/start','/api/workspace/read/page'])assert.equal((await other.request(route,{})).status,409,route);
  assert.equal((await client.request('/api/notebook')).status,200);
  const preview=await (await client.request('/api/preview',{etag:transferred.etag})).json();assert.equal((await client.request(preview.url)).status,200);
});

test('new workspace creation honors the selected folder and keeps paths and access settings out of research',async t=>{
  const app=await setup(t,{create:false}),client=await app.client(),destination=path.join(app.parent,'Independent research');
  const response=await client.request('/api/notebook/create',{title:'Independent research',storagePath:destination,username:'Private username',password:'my synthetic passphrase',projectTitle:'Project',notebookTitle:'Journal'});
  assert.equal(response.status,201);const created=await response.json();client.context=created.storage.contextId;
  const bytes=await readFile(path.join(destination,'workspace.observanda'),'utf8');assert.ok(!bytes.includes('Private username'));assert.ok(!bytes.includes(destination));assert.ok(!bytes.includes('my synthetic passphrase'));
  const access=await readFile(path.join(destination,'.observanda','access.json'),'utf8');assert.ok(!access.includes('my synthetic passphrase'));
  assert.equal(await readPreference(app.preferencesFile),destination);
  await client.request('/api/access/lock',{});assert.equal((await client.request('/api/notebook')).status,401);
});

test('missing remembered locations never turn into a replacement workspace',async t=>{
  const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-missing-')),root=path.join(parent,'disconnected');
  const app=await startServer({root,port:0,expectedExisting:true});t.after(()=>app.close());
  const auth=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});
  const headers={Origin:app.origin,Cookie:auth.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
  const response=await fetch(app.origin+'/api/notebook/create',{method:'POST',headers,body:JSON.stringify({title:'Replacement'})});assert.equal((await response.json()).code,'STORAGE_UNAVAILABLE');
  await assert.rejects(readFile(path.join(root,'observanda.json')),{code:'ENOENT'});
});


test('personal display settings survive a service restart and are available on the lock screen without exposing workspace data',async t=>{
  const app=await setup(t,{protected:true}),client=await app.client(),workspaceBefore=await workspaceManifest(app.root);
  assert.equal((await fetch(app.origin+'/api/interface')).status,401);
  const settings={fontSize:22,lineHeight:1.8};
  assert.equal((await client.request('/api/interface',settings)).status,200);
  assert.deepEqual(await (await client.request('/api/interface')).json(),settings);
  assert.equal((await client.request('/api/interface',{...settings,secret:'ignored?'})).status,422);
  const next=await startServer({root:app.root,port:0,preferencesFile:app.preferencesFile});t.after(()=>next.close());
  const auth=await fetch(next.origin+'/api/session',{method:'POST',headers:{Origin:next.origin,'Content-Type':'application/json'},body:JSON.stringify({token:next.launchToken})});
  const cookie=auth.headers.get('set-cookie').split(';')[0];
  assert.deepEqual(await (await fetch(next.origin+'/api/interface',{headers:{Cookie:cookie}})).json(),settings);
  assert.equal((await fetch(next.origin+'/api/workspaces',{headers:{Cookie:cookie}})).status,401);
  assert.deepEqual(await workspaceManifest(app.root),workspaceBefore);
});


test('a missing previous workspace permits explicit creation elsewhere while blocking implicit replacement and occupied folders',async t=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-startup-create-')),missing=path.join(parent,'missing'),destination=path.join(parent,'Independent work'),occupied=path.join(parent,'Occupied'),preferencesFile=path.join(parent,'settings.json');
 await writeFile(preferencesFile,JSON.stringify({formatVersion:1,workspace:missing}));
 const initial=await readFile(preferencesFile,'utf8');
 const app=await startServer({root:missing,port:0,expectedExisting:true,preferencesFile});t.after(()=>app.close());
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});
 const headers={Origin:app.origin,Cookie:session.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
 const create=data=>fetch(app.origin+'/api/notebook/create',{method:'POST',headers,body:JSON.stringify(data)});
 const metadata=await (await fetch(app.origin+'/api/storage',{headers})).json();assert.equal(metadata.available,false);assert.equal(metadata.unavailableReason,'folder-missing');
 assert.equal(await readFile(preferencesFile,'utf8'),initial);
 for(const data of [{title:'Implicit'},{title:'No path',createNew:true},{title:'Missing choice',storagePath:destination}])assert.equal((await (await create(data)).json()).code,'STORAGE_UNAVAILABLE');
 await mkdir(occupied);await writeFile(path.join(occupied,'keep.txt'),'Unrelated file');
 assert.equal((await (await create({title:'Occupied',createNew:true,storagePath:occupied})).json()).code,'EXISTS');
 assert.deepEqual(await readdir(occupied),['keep.txt']);assert.equal(await readFile(preferencesFile,'utf8'),initial);
 const response=await create({title:'Independent work',createNew:true,storagePath:destination});assert.equal(response.status,201);const created=await response.json();assert.equal(created.storage.available,true);assert.equal(created.book.title,'Independent work');assert.equal(created.book.projects.length,0);
 assert.equal(await readPreference(preferencesFile),destination);await assert.rejects(readFile(path.join(missing,'observanda.json')),{code:'ENOENT'});await assert.rejects(readdir(missing),{code:'ENOENT'});
});

test('setup validates template selection before creation and keeps it in each encrypted workspace',async t=>{
 const app=await setup(t,{create:false}),client=await app.client(),selected=['laboratory-computer-it','laboratory-arts-creative'];
 for(const labBookTypes of [['unknown'],['resources'],['research'],['laboratory-computer-it','laboratory-computer-it'],'laboratory-computer-it',null]){
  const response=await client.request('/api/notebook/create',{title:'Invalid selection',storagePath:app.root,labBookTypes});assert.equal(response.status,422);await assert.rejects(readdir(app.root),{code:'ENOENT'});
 }
 const response=await client.request('/api/notebook/create',{title:'workspace',storagePath:app.root,labBookTypes:selected});assert.equal(response.status,201);client.context=(await response.json()).storage.contextId;
 let settings=(await (await client.request('/api/dashboard')).json()).settings;assert.deepEqual(settings.enabledModules,['publishing',...selected]);
 assert.ok(!(await readFile(app.preferencesFile,'utf8')).includes('laboratory-computer-it'));
 const other=path.join(app.parent,'Independent choice'),created=await client.request('/api/notebook/create',{title:'Independent choice',storagePath:other,createNew:true,labBookTypes:[]});assert.equal(created.status,201);client.context=(await created.json()).storage.contextId;
 assert.deepEqual((await (await client.request('/api/dashboard')).json()).settings.enabledModules,['publishing']);
 const opened=await client.request('/api/storage/open',{path:app.root});assert.equal(opened.status,200);client.context=(await opened.json()).contextId;
 assert.deepEqual((await (await client.request('/api/dashboard')).json()).settings.enabledModules,['publishing',...selected]);
});


test('creation retains the exact name and rejects a conflicting full path without creating either folder',async t=>{
 const app=await setup(t,{create:false}),client=await app.client(),name='Research Workspace 1 – café',destination=path.join(app.parent,name);
 for(const data of [{title:'Research Workspace 1',storagePath:path.join(app.parent,'Research-Workspace-1')},{title:'Research/Workspace',storageParent:app.parent}]){
  const response=await client.request('/api/notebook/create',data);assert.equal(response.status,422);assert.match((await response.json()).code,/^WORKSPACE_NAME/);
 }
 assert.ok(!(await readdir(app.parent)).includes('Research-Workspace-1'));
 const ambiguous=await client.request('/api/notebook/create',{title:name,storageParent:app.parent,storagePath:destination});assert.equal((await ambiguous.json()).code,'INVALID');
 const checked=await client.request('/api/storage/check',{storageParent:app.parent,name});assert.equal(checked.status,200);assert.equal((await checked.json()).root,destination);assert.ok(!(await readdir(app.parent)).includes(name));
 const response=await client.request('/api/notebook/create',{title:name,storageParent:app.parent});assert.equal(response.status,201);const created=await response.json();client.context=created.storage.contextId;
 assert.equal(created.book.title,name);assert.equal(created.storage.root,destination);assert.equal(path.basename(created.storage.root),name);assert.ok((await readdir(app.parent)).includes(name));
 const before=await workspaceManifest(destination);const duplicate=await client.request('/api/notebook/create',{title:name,storageParent:app.parent,createNew:true});assert.equal((await duplicate.json()).code,'EXISTS');assert.deepEqual(await workspaceManifest(destination),before);
});
