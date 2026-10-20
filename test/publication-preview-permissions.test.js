import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {MediaStore} from '../src/media.js';
import {WorkspaceFonts} from '../src/workspace-fonts.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {AppearancePreviewSessions} from '../src/appearance-preview-sessions.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {startServer} from '../src/server.js';
import {capturePreviewPermissions,assertPreviewPermissions} from '../src/publication-preview-admission.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-preview-permissions-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0];
 record.body='An observed public result.';record.share=true;record.relations=[];record.figures=[];record.sections=[{id:randomUUID(),title:'Allowed procedure',body:'Retained procedure details.'}];book.entries=[record];
 const page={id:randomUUID(),title:'Unpublished draft page',body:'Unpublished authoring text.',share:false,sections:[]};book.pages.push(page);
 const f=await encryptedFixture(directory,book),media=new MediaStore(f.workspace.root,f.vault),asset=await media.import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle cx="4" cy="4" r="3"/></svg>'),'image');
 const saved=await f.workspace.read();saved.book.entries[0].attachments=[{id:asset.id,kind:'image',caption:'Selected observation',alt:'Circle',transcript:'',share:true}];await f.workspace.save(saved.book,saved.etag);
 const jobs=new PublicationJobs(f.workspace),outline=await jobs.workspace.outline();let app;
 t.after(async()=>{await app?.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 return {...f,book,record,page,media,asset,jobs,outline,directory,start:async()=>app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')}),change:async edit=>{const saved=await f.workspace.read();edit(saved.book);await f.workspace.save(saved.book,saved.etag);}};
}
const withdrawals=[
 ['section',(book,value)=>book.entries[0].sections[0].share=value],
 ['attachment',(book,value)=>book.entries[0].attachments[0].share=value],
 ['lab book',(book,value)=>book.notebooks.find(item=>item.id===book.entries[0].notebookId).share=value]
];

test('retained preview HTTP cache rechecks identical HTML and asset URLs after source withdrawal while preserving private authoring',async t=>{
 const f=await fixture(t),app=await f.start(),session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});
 assert.equal(session.status,200);const cookie=session.headers.get('set-cookie').split(';')[0],context=(await(await fetch(app.origin+'/api/storage',{headers:{Cookie:cookie}})).json()).contextId;
 const request=(route,data)=>fetch(app.origin+route,{method:data===undefined?'GET':'POST',headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json','X-Observanda-Workspace':context,'X-Observanda-Wait':'1'},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const active=await f.jobs.workspace.outline(),prepared=await request('/api/preview',{workspaceId:f.book.id,etag:active.etag,websitePin:active.websitePin}),review=await prepared.json();assert.equal(prepared.status,200,JSON.stringify(review));
 const entry='/preview/'+review.id+'/entries/'+f.record.id+'.html',asset='/preview/'+review.id+'/media/'+f.asset.id+'.png';
 const original=await request(entry);assert.equal(original.status,200);const html=await original.text();assert.ok(html.includes('Retained procedure details.'));assert.equal((await request(asset)).status,200);
 const design=await request('/api/design-preview',{websitePin:active.websitePin,mode:'website',workspaceContent:true,designTarget:'page:'+f.page.id}),draft=await design.json();assert.equal(design.status,200,JSON.stringify(draft));assert.ok((await(await request(draft.url)).text()).includes('Unpublished authoring text.'));
 await f.change(book=>{book.entries[0].body='A newer public observation.';});assert.equal(await(await request(entry)).text(),html);assert.equal((await request(asset)).status,200);
 for(const [kind,withdraw] of withdrawals){
  await f.change(book=>withdraw(book,false));
  for(const route of [entry,asset]){const response=await request(route),body=await response.json();assert.equal(response.status,422,kind);assert.equal(body.code,'PUBLICATION_PERMISSIONS_CHANGED',kind);}
  assert.equal((await request(draft.url)).status,200,'Authenticated private authoring remains available');
  await f.change(book=>withdraw(book,true));assert.equal((await request(entry)).status,200,kind+' restored');
 }
});

test('public appearance HTML and asset caches reject source withdrawal and reuse checked heads',async t=>{
 const f=await fixture(t),sessions=new AppearancePreviewSessions(),command={workspaceId:f.book.id,etag:f.outline.etag,websitePin:f.outline.websitePin,appearance:f.book.appearance,mode:'website'};
 const preview=await sessions.create(f.workspace,command,{media:f.media,fonts:new WorkspaceFonts(f.workspace)}),id=preview.baseUrl.split('/')[2],entry='entries/'+f.record.id+'.html',asset='_assets/'+Buffer.from(entry).toString('base64url')+'/media/'+f.asset.id+'.png';
 const original=(await sessions.file(id,entry)).content;assert.ok(original.includes('Retained procedure details.'));await sessions.file(id,asset);
 await f.change(book=>{book.entries[0].body='A newer public observation.';});assert.equal((await sessions.file(id,entry)).content,original);
 const record=ResearchCatalogue.prototype.record;let originalsRead=0;ResearchCatalogue.prototype.record=function(...args){originalsRead++;return record.apply(this,args);};
 try{await sessions.file(id,entry);await sessions.file(id,asset);assert.equal(originalsRead,0,'An unchanged checked head needs no original rereads');}finally{ResearchCatalogue.prototype.record=record;}
 for(const [kind,withdraw] of withdrawals){
  await f.change(book=>withdraw(book,false));
  for(const file of [entry,asset])await assert.rejects(sessions.file(id,file),{code:'PUBLICATION_PERMISSIONS_CHANGED'},kind);
  await f.change(book=>withdraw(book,true));assert.equal((await sessions.file(id,entry)).content,original,kind+' restored');
 }
});


test('cached foreign preview media checks original attachment identities and reauthorizes each access',async()=>{
 const host=randomUUID(),owner=randomUUID(),notebook=randomUUID(),record=randomUUID(),asset=randomUUID(),projected=randomUUID(),metadata={id:owner,notebooks:[{id:notebook}]};
 const local={metadata:{id:host,notebooks:[]},snapshotId:'host-head',descriptors:new Map()},remote={metadata,snapshotId:'old-head',descriptors:new Map([['public-record',{id:'public-record',recordId:record,revision:'old-revision',selectors:[],media:[{id:projected}],mediaIdentities:{[asset]:projected}}]])};
 const proof=capturePreviewPermissions({local,owners:[remote]});assert.equal(proof[1].descriptors[0].media[0].id,asset);
 const workspace={catalogue:fn=>fn({head:async()=>'host-head',snapshot:async()=>({metadata:{id:host}})})};
 let closed=0,accesses=0,privateMedia=true;
 const current={id:record,notebookId:notebook,share:true,sections:[],attachments:[{id:asset,share:false}]},store={head:async()=>'new-head',snapshot:async()=>({metadata}),member:async()=>({id:record,revision:'new-revision'}),async *queryDocuments(){yield {...current,attachments:[{id:asset,share:!privateMedia}],publicationDescriptor:{revision:'new-revision'}};},record:async()=>({...current,attachments:[{id:asset,share:!privateMedia}]})};
 const sourceReader=async()=>({use:async(id,snapshot,fn)=>{assert.equal(id,owner);accesses++;return fn(store);},verify:async()=>{},close:async()=>{closed++;}});
 await assert.rejects(assertPreviewPermissions(workspace,proof,{sourceReader}),{code:'PUBLICATION_PERMISSIONS_CHANGED'});assert.equal(closed,1);
 privateMedia=false;await assertPreviewPermissions(workspace,proof,{sourceReader});await assertPreviewPermissions(workspace,proof,{sourceReader});assert.equal(accesses,3);assert.equal(closed,3);
});
