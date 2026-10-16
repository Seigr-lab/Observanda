import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,readFile,readdir,writeFile,symlink} from 'node:fs/promises';
import {Workspace,serialize} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {createAccess,readAccess,verifyAccess} from '../src/access.js';
import {browseFolders,createFolder,initializeLocation,inspectLocation,probeLocation,copyPlan,copyWorkspace,workspaceManifest,readPreference,rememberLocation} from '../src/locations.js';

test('storage checks leave no probes, reject occupied destinations and never invent missing network parents',async()=>{
  const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-location-')),root=path.join(parent,'new');
  assert.equal((await probeLocation(root)).kind,'new');assert.deepEqual(await readdir(parent),[]);
  await assert.rejects(initializeLocation(path.join(parent,'missing','workspace'),sampleNotebook(),await createAccess()),{code:'ENOENT'});
  await writeFile(path.join(parent,'unrelated.txt'),'keep');
  await assert.rejects(initializeLocation(parent,sampleNotebook(),await createAccess()),{code:'EXISTS'});
  assert.equal(await readFile(path.join(parent,'unrelated.txt'),'utf8'),'keep');
});

test('verified workspace copies include private originals and history byte for byte and leave the source intact',async()=>{
  const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-copy-')),source=path.join(parent,'source'),destination=path.join(parent,'copy');
  await initializeLocation(source,sampleNotebook(),await createAccess('Local researcher'));
  const ws=new Workspace(source),current=await ws.read();current.book.description='A new revision';await ws.save(current.book,current.etag);
  await mkdir(path.join(source,'.observanda','media','fixture'),{recursive:true});
  await writeFile(path.join(source,'.observanda','media','fixture','original'),Buffer.from([1,255,0,99]));
  await writeFile(path.join(source,'.observanda','laboratory.json'),'private laboratory fixture\n');
  const before=await workspaceManifest(source),plan=await copyPlan(source,destination);
  await copyWorkspace(plan);assert.deepEqual(await workspaceManifest(source),before);assert.deepEqual(await workspaceManifest(destination),before);
  assert.equal((await inspectLocation(destination)).kind,'workspace');
  await writeFile(path.join(destination,'.observanda','copy-in-progress'),'incomplete');
  await assert.rejects(new Workspace(destination).read(),{code:'STORAGE_INCOMPLETE'});
  await assert.rejects(inspectLocation(destination),{code:'STORAGE_INCOMPLETE'});
  await assert.rejects(copyPlan(source,path.join(source,'nested')),{code:'STORAGE_PATH'});
  await assert.rejects(copyPlan(source,destination),{code:'EXISTS'});
  const preference=path.join(parent,'local-settings','preferences.json');await rememberLocation(preference,destination);assert.equal(await readPreference(preference),destination);
});

test('copy review rejects changed sources, occupied destinations and linked private files',async()=>{
  const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-copy-stale-')),source=path.join(parent,'source'),destination=path.join(parent,'copy');
  await initializeLocation(source,sampleNotebook(),await createAccess());
  const plan=await copyPlan(source,destination);await writeFile(path.join(source,'.observanda','extra'),'changed');
  await assert.rejects(copyWorkspace(plan),{code:'CONFLICT'});assert.deepEqual(await readdir(parent),['source']);
  const next=await copyPlan(source,destination);await mkdir(destination);await writeFile(path.join(destination,'unrelated'),'keep');
  await assert.rejects(copyWorkspace(next),{code:'EXISTS'});assert.equal(await readFile(path.join(destination,'unrelated'),'utf8'),'keep');
  const external=path.join(parent,'external');await mkdir(external);await writeFile(path.join(external,'secret'),'private');
  await symlink(external,path.join(source,'.observanda','linked'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(copyPlan(source,path.join(parent,'linked-copy')),{code:'UNSAFE'});
});

test('password settings use salted verifiers and corrupted access settings fail closed',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'observanda-access-')),password='a long synthetic password';
  const a=await createAccess('Researcher',password),b=await createAccess('Researcher',password);assert.notDeepEqual(a.password,b.password);assert.ok(!serialize(a).includes(password));
  await initializeLocation(root,sampleNotebook(),a);const saved=await readAccess(root);await verifyAccess(saved,'Researcher',password);
  await assert.rejects(verifyAccess(saved,'Someone else',password),{code:'ACCESS_DENIED'});
  await assert.rejects(createAccess('Researcher','short'),{code:'ACCESS_INVALID'});
  await writeFile(path.join(root,'.observanda','access.json'),'{bad');await assert.rejects(readAccess(root),{code:'ACCESS_FORMAT'});
});


test('folder browsing provides all matches through paging and creates only a new child folder',async()=>{
  const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-picker-'));
  await Promise.all(Array.from({length:205},(_,i)=>mkdir(path.join(parent,`Study ${String(i).padStart(3,'0')}`))));
  await mkdir(path.join(parent,'.hidden'));
  const first=await browseFolders(parent);
  assert.equal(first.total,205);assert.equal(first.folders.length,200);assert.equal(first.hasMore,true);
  assert.equal(first.breadcrumbs.at(-1).path,await import('node:fs/promises').then(fs=>fs.realpath(parent)));
  assert.ok(first.places.some(p=>p.name==='Home'));
  const second=await browseFolders(parent,{offset:200});assert.equal(second.folders.length,5);assert.equal(second.hasMore,false);
  const found=await browseFolders(parent,{search:'Study 204'});assert.equal(found.folders.length,1);assert.equal(found.folders[0].name,'Study 204');
  assert.equal((await browseFolders(parent,{search:'.hidden'})).total,0);assert.equal((await browseFolders(parent,{hidden:true,search:'.hidden'})).total,1);
  for(const name of ['../outside','..','child/nested','child\\nested','CON','LPT1.txt','trailing.',' name'])await assert.rejects(createFolder(parent,name),{code:'FOLDER_NAME'});
  const made=await createFolder(parent,'New investigations');assert.equal(made.folder,path.join(parent,'New investigations'));assert.deepEqual(await readdir(made.folder),[]);
  await assert.rejects(createFolder(parent,'New investigations'),{code:'FOLDER_EXISTS'});
  await assert.rejects(createFolder(path.join(parent,'missing'),'child'),{code:'ENOENT'});
  assert.equal((await readdir(parent)).length,207);
});
