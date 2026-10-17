import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {WebsiteEditor} from '../src/website-editor.js';
import {WebsiteEditorStore,verifyWebsiteEditor} from '../src/website-editor-store.js';
import {WebsiteDocumentStore} from '../src/website-document-store.js';
import {WebsiteSites} from '../src/website-sites.js';
import {WebsiteCollectionIndex,validWebsiteCollectionIndexes} from '../src/website-collection-index.js';
import {WebsiteEditorNavigation} from '../src/website-editor-navigation.js';
import {websiteDocumentHeader,validateWebsiteDocument} from '../src/website-document-validation.js';
import {RecordDocument} from '../src/record-document.js';
import {requireWebsiteEditor} from '../src/catalogue-format.js';
import {digest,serialize} from '../src/storage-format.js';
const hash=value=>digest(serialize(value));
const layout=(target,heading='Selected heading')=>({target,showHeading:true,heading,description:'',placement:'before',sections:[]});
const branding=target=>({target,logos:[]});
const page=()=>({id:randomUUID(),title:'Selected page',body:'Authored prose',share:true,sections:[]});
async function fixture(t){
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-presentation-collections-')),book=createNotebook('Presentation collections'),f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-presentation-collections-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const sites=new WebsiteSites(f.workspace),editor=new WebsiteEditor(f.workspace),created=await sites.change({workspaceId:book.id,etag:(await f.workspace.outline()).etag,operation:'create',name:'Selected presentation'}),websiteId=created.id;
 return {...f,book,sites,websiteId,execute:(operation,data={})=>editor.execute(operation,{workspaceId:book.id,websiteId,...data})};
}
const edit=(state,operations)=>({websitePin:state.websitePin,draftId:state.draft?.id??null,expectedRevision:state.draft?.revision??null,commandId:randomUUID(),operations});
const move=state=>({draftId:state.draft.id,expectedRevision:state.draft.revision,commandId:randomUUID()});
const selected=state=>({websitePin:state.websitePin,...(state.draft?{draftId:state.draft.id,draftRevision:state.draft.revision}:{})});
async function noAggregate(run){
 const field=RecordDocument.prototype.field,forbidden=new Set(['document/branding','document/website/layouts']);
 RecordDocument.prototype.field=function(path,...args){assert.equal(forbidden.has(path.join('/')),false,'Selected operation read an aggregate presentation collection');return field.call(this,path,...args);};
 try{return await run();}finally{RecordDocument.prototype.field=field;}
}

test('selected presentation overrides preserve absent, empty, guarded and removed states', {timeout:120000},async t=>{
 const f=await fixture(t),initial=await f.execute('open'),authored=page(),target='page:'+authored.id;
 assert.equal(Object.hasOwn(initial.site.document,'branding'),false);assert.equal(Object.hasOwn(initial.site.document.website,'layouts'),false);
 await assert.rejects(f.execute('item',{...selected(initial),collection:'layouts',key:target}),{code:'NOT_FOUND'});
 for(const path of [['document','branding'],['document','branding','0'],['document','website','layouts'],['document','website','layouts','0']])await assert.rejects(f.execute('change',edit(initial,[{type:'settings',path,value:[]}])),{code:'INVALID'});
 let state=await f.execute('change',edit(initial,[{type:'settings',path:['document','website','home','enabled'],value:true},{type:'append',collection:'pages',values:[authored]}]));
 await assert.rejects(f.execute('change',edit(state,[{type:'replace',collection:'layouts',key:target,position:0,value:layout(target)}])),{code:'CONFLICT'});
 const missing='page:'+randomUUID();await assert.rejects(f.execute('change',edit(state,[{type:'replace',collection:'layouts',key:missing,value:layout(missing)}])),{code:'INVALID'});
 const command=edit(state,[{type:'replace',collection:'layouts',key:target,value:layout(target)},{type:'replace',collection:'branding',key:target,value:branding(target)},{type:'replace',collection:'layouts',key:'home',value:layout('home')},{type:'replace',collection:'branding',key:'home',value:branding('home')}]);
 state=await noAggregate(()=>f.execute('change',command));assert.deepEqual(await f.execute('change',command),state);
 assert.deepEqual((await f.execute('item',{...selected(state),collection:'branding',key:target})).value.logos,[]);
 const retained=state,removed=await noAggregate(()=>f.execute('change',edit(state,[{type:'remove',collection:'layouts',key:target}])));
 await assert.rejects(f.execute('item',{...selected(removed),collection:'layouts',key:target}),{code:'NOT_FOUND'});
 state=await f.execute('undo',move(removed));assert.equal((await f.execute('item',{...selected(state),collection:'layouts',key:target})).value.heading,'Selected heading');
 state=await f.execute('redo',move(state));await assert.rejects(f.execute('item',{...selected(state),collection:'layouts',key:target}),{code:'NOT_FOUND'});
 state=await f.execute('change',edit(state,[{type:'replace',collection:'layouts',key:target,value:layout(target,'Restored override')}]));
 state=await noAggregate(()=>f.execute('change',edit(state,[{type:'page-remove',key:authored.id},{type:'home-remove'}])));
 assert.equal(state.collections.layouts.count,0);assert.equal(state.collections.branding.count,0);
 const saved=await f.execute('save',move(state));assert.equal(saved.draft,null);
 assert.equal((await f.execute('item',{...selected(retained),collection:'layouts',key:target})).value.heading,'Selected heading');
 await f.workspace.catalogue(async store=>{await new WebsiteDocumentStore(store).verify();await verifyWebsiteEditor(store);});
});

test('native presentation collections exceed 1700 while selected changes reuse identity indexes', {timeout:180000},async t=>{
 const f=await fixture(t),targets=Array.from({length:1701},()=> 'entry:'+randomUUID());
 const seed=await f.sites.write(f.websiteId,{},async(store,documents)=>{
  const current=await documents.document(f.websiteId,{mutable:true});let document=await current.document.property(['document','website'],'researchSources',[]);
  document=await document.replace(['document','website','layouts'],targets.map(target=>layout(target)));document=await document.replace(['document','branding'],targets.map(branding));
  return documents.saveDocument(f.websiteId,document,{researchSnapshotId:current.researchSnapshotId,expectedRevision:current.websiteRevision});
 });
 let state=await f.execute('open');assert.equal(state.collections.layouts.count,1701);assert.equal(state.collections.branding.count,1701);
 const before=await f.workspace.catalogue(store=>new WebsiteDocumentStore(store).document(f.websiteId,seed));
 assert.equal(validWebsiteCollectionIndexes(before.collectionIndexes,{version:2}),true);assert.equal(validWebsiteCollectionIndexes(before.collectionIndexes),false);
 const target=targets.at(-1),first=await noAggregate(()=>f.execute('item',{...selected(state),collection:'layouts',key:target}));assert.equal(first.position,1700);
 state=await noAggregate(()=>f.execute('change',edit(state,[{type:'replace',collection:'layouts',key:target,expectedItemRevision:first.revision,value:layout(target,'Late selected edit')}])));
 const draft=await f.workspace.catalogue(store=>new WebsiteEditorStore(store).document(f.websiteId,selected(state)));
 assert.deepEqual(draft.collectionIndexes.layouts.root,before.collectionIndexes.layouts.root);assert.deepEqual(draft.collectionIndexes.branding,before.collectionIndexes.branding);
 const window=await noAggregate(()=>f.execute('window',{...selected(state),collection:'layouts',offset:1699,limit:2}));assert.deepEqual(window.rows.map(row=>row.key),targets.slice(-2));assert.deepEqual(window.rows.map(row=>row.value),[{target:targets.at(-2),heading:'Selected heading'},{target,heading:'Late selected edit'}]);
 const brands=await noAggregate(()=>f.execute('window',{...selected(state),collection:'branding',offset:1700,limit:1}));assert.deepEqual(brands.rows.map(row=>row.value),[{target}]);
 state=await f.execute('save',move(state));assert.equal(state.collections.layouts.count,1701);
 await f.workspace.catalogue(async store=>{
  const documents=new WebsiteDocumentStore(store),registry=await documents.registry(),saved=await documents.document(f.websiteId,state.websitePin),descriptor=await documents.revision(f.websiteId,state.websitePin.websiteRevision,registry);
  assert.equal(descriptor.version,3);const result=await validateWebsiteDocument(store,await store.snapshot(state.websitePin.researchSnapshotId),saved.document);assert.equal(result.counts.layouts,1701);assert.equal(result.counts.branding,1701);
  for(const collection of ['layouts','branding'])await (await WebsiteCollectionIndex.open(saved.document,collection,saved.collectionIndexes[collection])).verify();
 });
});

test('legacy three-index revisions and checkpoints remain exact after presentation upgrades', {timeout:120000},async t=>{
 const f=await fixture(t);
 const legacy=await f.sites.write(f.websiteId,{},async(store,documents)=>{
  await requireWebsiteEditor(store.db);const current=await documents.read(f.websiteId);current.site.document.website.footer='Legacy editor generation';
  const saved=await documents.save(f.websiteId,current.site,{researchSnapshotId:current.researchSnapshotId,expectedRevision:current.websiteRevision}),registry=await documents.registry(),descriptor=await documents.revision(f.websiteId,saved.websiteRevision,registry);
  assert.equal(descriptor.version,2);assert.equal(validWebsiteCollectionIndexes(descriptor.collectionIndexes),true);assert.equal(validWebsiteCollectionIndexes(descriptor.collectionIndexes,{version:2}),false);
  const retained=await documents.document(f.websiteId,saved),site=await websiteDocumentHeader(retained.document),snapshot=await store.snapshot(saved.researchSnapshotId),indexes=descriptor.collectionIndexes,navigationProjection=await WebsiteEditorNavigation.retain(store,snapshot,retained.document,site,indexes,descriptor.navigationProjection);
  const editor=new WebsiteEditorStore(store),checkpoint={version:1,root:retained.document.root,collectionIndexes:indexes,navigationProjection},revision=hash(checkpoint);
  await editor.immutable('website-editor:checkpoint:'+f.websiteId+':'+revision,checkpoint);const history=editor.history(f.websiteId),root=await history.change(null,'0000000000000000',revision);await history.flush(root);
  const head={version:1,workspaceId:f.book.id,websiteId:f.websiteId,id:randomUUID(),base:{researchSnapshotId:saved.researchSnapshotId,websiteRevision:saved.websiteRevision},generation:0,position:0,tip:0,history:root};await editor.retainHead(head);
  return {saved,head,checkpoint};
 });
 let state=await f.execute('open');assert.equal(state.draft.revision,hash(legacy.head));assert.equal(state.collections.layouts.count,0);assert.equal(state.collections.branding.count,0);
 state=await f.execute('change',edit(state,[{type:'replace',collection:'branding',key:'home',value:branding('home')}]));
 await f.workspace.catalogue(async store=>{
  const editor=new WebsiteEditorStore(store),head=await editor.retainedHead(f.websiteId,state.draft.id,state.draft.revision);assert.equal((await editor.checkpoint(head)).version,2);assert.deepEqual(await editor.checkpoint(head,0),legacy.checkpoint);
 });
 const old=await f.execute('undo',move(state));assert.equal(old.collections.branding.count,0);state=await f.execute('redo',move(old));state=await f.execute('save',move(state));
 await f.workspace.catalogue(async store=>{
  const documents=new WebsiteDocumentStore(store),registry=await documents.registry();assert.equal((await documents.revision(f.websiteId,legacy.saved.websiteRevision,registry)).version,2);assert.equal((await documents.revision(f.websiteId,state.websitePin.websiteRevision,registry)).version,3);
  await documents.verify();await verifyWebsiteEditor(store);
 });
});
