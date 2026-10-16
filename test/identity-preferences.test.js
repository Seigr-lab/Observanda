import {DEFAULT_INTERFACE,normalizeInterface} from '../src/web/interface-ui.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createNotebook,upgradeNotebook,validateNotebook} from '../src/model.js';
import {Workspace,digest} from '../src/storage.js';
import {readPreferences,readPreference,rememberLocation,rememberInterface} from '../src/locations.js';
import {publicProjection} from '../src/publication.js';
import {validIdentity,identityLabel} from '../src/web/workspace-identity.js';

test('format 4 keeps all record identities and original bytes when its workspace identity becomes editable',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'observanda-identity-')),legacy=createNotebook('Existing personal work');
  legacy.formatVersion=4;delete legacy.website.typography;delete legacy.website.presentation;delete legacy.website.palette;delete legacy.identity;
  for (const key of ['title','description','home','design','assets','layouts','templates']) delete legacy.website[key];
  const raw=JSON.stringify(legacy),file=path.join(root,'observanda.json');await writeFile(file,raw);
  const ws=new Workspace(root),source=await ws.read(),book=upgradeNotebook(source.book);
  assert.deepEqual(book.identity,{kind:'workspace',label:''});assert.equal(await readFile(file,'utf8'),raw);
  book.identity={kind:'studio',label:''};await ws.save(book,source.etag);
  const current=(await ws.read()).book;
  assert.equal(current.id,legacy.id);assert.deepEqual(current.projects,legacy.projects);assert.deepEqual(current.notebooks,legacy.notebooks);
  assert.equal(await readFile(path.join(root,'.observanda','revisions',digest(raw)+'.json'),'utf8'),raw);
  assert.equal(Object.hasOwn(publicProjection(current),'identity'),false);
});

test('identity labels are descriptive and never add membership, access or ownership fields',()=>{
  for(const kind of ['personal','organization','laboratory','studio','collective','workspace']){
    const book=createNotebook();book.identity={kind,label:''};assert.equal(validateNotebook(book),book);assert.ok(identityLabel(book.identity));
  }
  assert.ok(validIdentity({kind:'custom',label:'Observatory & workshop'}));
  for(const identity of [{kind:'custom',label:' '},{kind:'custom',label:'a'.repeat(61)},{kind:'custom',label:'bad\nlabel'},{kind:'organization',label:'Unexpected'},{kind:'admin',label:''},{kind:'personal',label:'',owner:'someone'}]){
    const book=createNotebook();book.identity=identity;assert.throws(()=>validateNotebook(book),{code:'INVALID'});
  }
});

test('old location preferences upgrade without losing locations or personal type settings during concurrent updates',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'observanda-preferences-')),file=path.join(root,'preferences.json'),first=path.join(root,'personal'),second=path.join(root,'studio');
  await writeFile(file,JSON.stringify({formatVersion:1,workspace:first}));
  assert.equal(await readPreference(file),first);assert.equal((await readPreferences(file)).interface.fontSize,17);
  await Promise.all([rememberLocation(file,first,{title:'Personal work',label:'Personal'}),rememberInterface(file,{fontSize:24,lineHeight:1.9}),rememberLocation(file,second,{title:'Studio work',label:'Studio'})]);
  const saved=await readPreferences(file);assert.deepEqual(saved.interface,{fontSize:24,lineHeight:1.9});assert.equal(saved.workspace,second);assert.deepEqual(saved.recent.map(item=>item.path),[second,first]);
  const before=await readFile(file,'utf8');await assert.rejects(rememberInterface(file,{fontSize:2,lineHeight:1.6}),{code:'INVALID'});assert.equal(await readFile(file,'utf8'),before);
});


test('layout preferences accept older text-only profiles and persist validated menu placement without touching notebooks',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'observanda-layout-')),file=path.join(root,'preferences.json');
  const old={fontSize:20,lineHeight:1.8};await rememberInterface(file,old);
  const next=normalizeInterface((await readPreferences(file)).interface);assert.equal(next.navigationPosition,'left');assert.equal(next.fontSize,20);
  Object.assign(next,{navigationPosition:'right',navigationWidth:360,navigationCollapsed:true,navigationOrder:['website','research','workspace','projects']});await rememberInterface(file,next);
  assert.deepEqual((await readPreferences(file)).interface,next);
  for(const change of [{navigationPosition:'unknown'},{navigationWidth:9999},{navigationOrder:['research','research','website','workspace']},{navigationOrder:['../untrusted','research','website','workspace']},{navigationCollapsed:'true'},{unknown:'extra'}])await assert.rejects(rememberInterface(file,{...structuredClone(DEFAULT_INTERFACE),...change}),{code:'INVALID'});
  assert.deepEqual((await readPreferences(file)).interface,next);
});

test('header settings upgrade existing layouts and validate alignment and content order',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-header-')),file=path.join(root,'preferences.json');
 const previous=structuredClone(DEFAULT_INTERFACE);delete previous.headerAlignment;delete previous.headerOrder;
 await rememberInterface(file,previous);
 const upgraded=normalizeInterface((await readPreferences(file)).interface);
 assert.equal(upgraded.headerAlignment,'center');assert.equal(upgraded.headerOrder,'logo-first');
 await rememberInterface(file,{...upgraded,headerAlignment:'right',headerOrder:'title-first'});
 assert.equal((await readPreferences(file)).interface.headerOrder,'title-first');
 for(const change of [{headerAlignment:'anywhere'},{headerOrder:'reverse'}, {headerOrder:null}])await assert.rejects(rememberInterface(file,{...upgraded,...change}),{code:'INVALID'});
});
