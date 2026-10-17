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
import {websiteWorkspace} from '../src/website-workspace.js';
import {websiteEditorProjection} from '../src/website-editor-projection.js';
import {publicationDesignPreview} from '../src/publication-design-preview.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {withPublicationCapture} from '../src/publication-capture.js';
import {publicationText} from './publication-fixture.js';
import {serialize} from '../src/storage-format.js';
import {websiteDocumentClient} from '../src/web/website-document-client.js';
import {websiteSelectionDraft} from '../src/web/website-selection.js';

async function fixture(t){
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-selected-website-')),book=createNotebook('Website authoring'),f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-selected-website-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const editor=new WebsiteEditor(f.workspace),sites=new WebsiteSites(f.workspace),created=await sites.change({workspaceId:book.id,etag:(await f.workspace.outline()).etag,operation:'create',name:'Field journal'}),websiteId=created.id;
 const execute=(operation,data={})=>editor.execute(operation,{workspaceId:book.id,websiteId,...data});
 const edit=(state,operations,commandId=randomUUID())=>({websitePin:state.websitePin,draftId:state.draft?.id??null,expectedRevision:state.draft?.revision??null,commandId,operations});
 const transition=state=>({draftId:state.draft.id,expectedRevision:state.draft.revision,commandId:randomUUID()});
 const target=state=>({websitePin:state.websitePin,...(state.draft?{draftId:state.draft.id,draftRevision:state.draft.revision}:{})});
 return {...f,book,editor,sites,websiteId,execute,edit,transition,target};
}
const page=(title,body='Authored page')=>({id:randomUUID(),title,body,share:true,sections:[]});

async function readOnly(workspace,run){
 return workspace.catalogue(async store=>{
  const original=store.db.run;store.db.run=async function(sql,...args){assert.match(sql,/^SELECT\b/i,'Read issued a database mutation: '+sql);return original.call(this,sql,...args);};
  try{return await run(store);}finally{store.db.run=original;}
 });
}

test('selected website drafts survive reopening, retries, history and atomic publication without changing research', {timeout:120000},async t=>{
 const f=await fixture(t),initial=await f.execute('open'),research=(await f.workspace.outline()).etag;
 assert.equal(initial.draft,null);assert.equal(Object.hasOwn(initial.site.document,'pages'),false);assert.equal(Object.hasOwn(initial.site.document.website,'navigation'),false);
 await readOnly(f.workspace,async store=>{const editor=new WebsiteEditorStore(store);await editor.open(f.websiteId);assert.deepEqual((await editor.window(f.websiteId,{collection:'pages',limit:2})).rows,[]);});
 const first=page('First page'),command=f.edit(initial,[{type:'append',collection:'pages',values:[first]}]),changed=await f.execute('change',command);
 assert.equal(changed.collections.pages.count,1);assert.equal(changed.draft.dirty,true);assert.equal(changed.websitePin.websiteRevision,initial.websitePin.websiteRevision);assert.equal((await f.execute('open')).draft.revision,changed.draft.revision);
 assert.deepEqual(await f.execute('change',command),changed);
 assert.equal((await f.sites.read(f.websiteId)).book.pages.length,0);
 const replacement={...first,body:'Later body'},updated=await f.execute('change',f.edit(changed,[{type:'replace',collection:'pages',key:first.id,value:replacement}]));
 await assert.rejects(f.execute('change',f.edit(changed,[{type:'replace',collection:'pages',key:first.id,value:{...first,title:'Stale edit'}}])),{code:'CONFLICT'});
 const undone=await f.execute('undo',f.transition(updated));assert.equal((await f.execute('item',{...f.target(undone),collection:'pages',key:first.id})).value.body,first.body);
 const redone=await f.execute('redo',f.transition(undone));assert.equal((await f.execute('item',{...f.target(redone),collection:'pages',key:first.id})).value.body,replacement.body);
 const save=f.transition(redone),saved=await f.execute('save',save);assert.equal(saved.draft,null);assert.notEqual(saved.websitePin.websiteRevision,initial.websitePin.websiteRevision);assert.deepEqual(await f.execute('save',save),saved);
 assert.equal((await f.sites.read(f.websiteId)).book.pages[0].body,replacement.body);assert.equal((await f.workspace.outline()).etag,research);
 // Issued preview checkpoints remain exact after subsequent edits and Save.
 const old=await f.workspace.catalogue(store=>websiteEditorProjection(store,f.websiteId,{websitePin:changed.websitePin,websiteDraft:{id:changed.draft.id,revision:changed.draft.revision},designTarget:'page:'+first.id}));
 assert.equal(old.metadata.pages[0].body,first.body);
 const next=await f.execute('change',f.edit(saved,[{type:'settings',path:['document','website','footer'],value:'Unfinished footer'}])),discard=f.transition(next);
 const discarded=await f.execute('discard',discard);assert.equal(discarded.draft,null);assert.deepEqual(await f.execute('discard',discard),discarded);assert.equal(discarded.site.document.website.footer,saved.site.document.website.footer);
 await assert.rejects(f.editor.execute('open',{workspaceId:randomUUID(),websiteId:f.websiteId}),{code:'WORKSPACE_CHANGED'});
 await f.workspace.catalogue(async store=>{await new WebsiteDocumentStore(store).verify();await verifyWebsiteEditor(store);});
});

test('growing website collections retain selected authoring beyond former aggregate limits', {timeout:180000},async t=>{
 const f=await fixture(t),pages=Array.from({length:201},(_,i)=>page('Page '+i,i===199?'UNSELECTED_PAGE_BODY '.repeat(2400):'Page body '+i));let state=await f.execute('open');
 const append=async(collection,values)=>{for(let offset=0;offset<values.length;offset+=32)state=await f.execute('change',f.edit(state,[{type:'append',collection,values:values.slice(offset,offset+32)}]));};
 await append('pages',pages);
 await append('navigation',pages.map(item=>({target:'page:'+item.id,label:item.title,show:true,parent:null})));
 const assets=Array.from({length:501},(_,i)=>({id:randomUUID(),kind:'image',caption:'Library image '+i,alt:'Accessible label '+i,transcript:''}));await append('assets',assets);
 assert.equal(state.collections.pages.count,201);assert.ok(state.collections.navigation.count>=201);assert.equal(state.collections.assets.count,501);
 const read=await readOnly(f.workspace,async store=>{
  const editor=new WebsiteEditorStore(store),options=f.target(state);const opened=await editor.open(f.websiteId),window=await editor.window(f.websiteId,{...options,collection:'pages',offset:198,limit:3}),selected=await editor.item(f.websiteId,{...options,collection:'pages',key:pages[200].id});
  assert.equal(Object.hasOwn(window.rows[1].value,'body'),false);assert.ok(Buffer.byteLength(serialize(opened))<32000);return {window,selected};
 });
 assert.deepEqual(read.window.rows.map(row=>row.key),pages.slice(198).map(item=>item.id));assert.equal(read.selected.value.body,pages[200].body);
 state=await f.execute('change',f.edit(state,[{type:'replace',collection:'pages',key:pages[200].id,value:{...pages[200],body:'Selected final edit'}}]));
 const saved=await f.execute('save',f.transition(state));assert.equal(saved.collections.pages.count,201);assert.equal(saved.collections.assets.count,501);
 const reopened=await f.execute('open');assert.equal(reopened.draft,null);assert.equal((await f.execute('item',{...f.target(reopened),collection:'pages',key:pages[199].id})).value.body,pages[199].body);
 await f.workspace.catalogue(store=>new WebsiteDocumentStore(store).verify());
});

test('canvas and prepared publication capture the selected immutable website draft', {timeout:120000},async t=>{
 const f=await fixture(t),initial=await f.execute('open'),authored=page('Draft observation','EXACT_DRAFT_CONTENT'),draft=await f.execute('change',f.edit(initial,[{type:'append',collection:'pages',values:[authored]}]));
 const websiteDraft={id:draft.draft.id,revision:draft.draft.revision},source={workspaceId:f.book.id,etag:draft.websitePin.researchSnapshotId,websitePin:draft.websitePin,websiteDraft},workspace=websiteWorkspace(f.workspace,f.websiteId);
 const preview=await publicationDesignPreview(workspace,{websitePin:draft.websitePin,websiteDraft,mode:'website',workspaceContent:true,designTarget:'page:'+authored.id},{blockedValues:[]});
 assert.deepEqual(preview.websiteDraft,websiteDraft);assert.match(await publicationText(preview.candidate),/EXACT_DRAFT_CONTENT/);
 const releases=new PublicationJobs(workspace),pinned=await withPublicationCapture(workspace,async(captured,id,finish)=>{const value=await releases.pin(source,{workspace:captured,id});return finish(()=>value);});
 const edited=await f.execute('change',f.edit(draft,[{type:'replace',collection:'pages',key:authored.id,value:{...authored,body:'LATER_DRAFT_CONTENT'}}]));
 await f.execute('discard',f.transition(edited));
 const job={id:pinned.id,lease:{token:randomUUID()}},candidate=await releases.prepare(job,{signal:new AbortController().signal,progress:async()=>{}});await workspace.withLock(()=>releases.commit(job,candidate));
 const text=await publicationText(await releases.read(candidate.reviewId));assert.match(text,/EXACT_DRAFT_CONTENT/);assert.doesNotMatch(text,/LATER_DRAFT_CONTENT/);
 assert.equal((await f.sites.read(f.websiteId)).book.pages.length,0);
});


test('editor client retries lost acknowledgements and retains typing during a save', {timeout:120000},async t=>{
 const f=await fixture(t),state={book:f.book,page:'website',storage:{contextId:'disposable'}},selection=websiteSelectionDraft(),calls=[],lost=new Set();let afterResponse=null;
 const client=websiteDocumentClient({state,selection,api:async(route,data)=>{
  const operation=route.split('/').at(-1);calls.push({operation,data:structuredClone(data)});const result=await f.editor.execute(operation,data);
  if(afterResponse){const hook=afterResponse;afterResponse=null;await hook(operation);}
  if(lost.delete(operation))throw new TypeError('Connection ended after commit');return structuredClone(result);
 }});t.after(()=>client.stop());
 const opened=await client.open({websiteId:f.websiteId,base:{book:f.book}});Object.assign(state,opened);selection.load(opened.site.selection);client.installed();
 state.book.website.title='First title';client.changed();lost.add('change');await assert.rejects(client.flush(),/Connection ended/);await client.flush();
 const changes=calls.filter(call=>call.operation==='change');assert.equal(changes.length,2);assert.deepEqual(changes[0].data,changes[1].data);
 afterResponse=async operation=>{assert.equal(operation,'save');state.book.website.title='Typed during save';client.changed();};
 await client.save();assert.equal(state.book.website.title,'Typed during save');assert.equal(client.isDirty(),true);assert.equal((await f.sites.read(f.websiteId)).book.website.title,'First title');
 await client.flush();lost.add('save');await assert.rejects(client.save(),/Connection ended/);await client.save();
 const saves=calls.filter(call=>call.operation==='save');assert.deepEqual(saves.at(-1).data,saves.at(-2).data);assert.equal(client.isDirty(),false);assert.equal((await f.sites.read(f.websiteId)).book.website.title,'Typed during save');
 state.book.website.title='Discard this draft';client.changed();await client.flush();lost.add('discard');await assert.rejects(client.discard(),/Connection ended/);await client.discard();
 const discards=calls.filter(call=>call.operation==='discard');assert.deepEqual(discards.at(-1).data,discards.at(-2).data);assert.equal(state.book.website.title,'Typed during save');assert.equal(client.isDirty(),false);
});
