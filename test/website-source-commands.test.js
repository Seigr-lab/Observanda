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
import {WebsiteSites} from '../src/website-sites.js';
import {WebsiteDocumentStore} from '../src/website-document-store.js';
import {verifyWebsiteEditor} from '../src/website-editor-store.js';
import {catalogueFormat,catalogueRequiresWebsiteSourceSelections} from '../src/catalogue-format.js';
import {Workspace} from '../src/storage.js';

async function fixture(t){
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-source-commands-')),book=createNotebook('Source command qualification'),f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-source-commands-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const sites=new WebsiteSites(f.workspace),create=async name=>(await sites.change({workspaceId:book.id,etag:(await f.workspace.outline()).etag,operation:'create',name})).id;
 const first=await create('First website'),second=await create('Second website'),editor=new WebsiteEditor(f.workspace);
 return {...f,book,first,second,execute:(operation,data={},websiteId=first)=>editor.execute(operation,{workspaceId:book.id,websiteId,...data})};
}
const edit=(state,operations,commandId=randomUUID())=>({websitePin:state.websitePin,draftId:state.draft?.id??null,expectedRevision:state.draft?.revision??null,commandId,operations});
const target=state=>({websitePin:state.websitePin,...(state.draft?{draftId:state.draft.id,draftRevision:state.draft.revision}:{})});
const transition=state=>({draftId:state.draft.id,expectedRevision:state.draft.revision,commandId:randomUUID()});
const record=(source,recordId,share=true)=>({type:'source-selection',kind:'record',...source,recordId,share});

test('paged linked-source commands retain large choices, isolated website drafts, retry receipts and exact undo after reopening',{timeout:300000},async t=>{
 const f=await fixture(t),source={workspaceId:randomUUID(),labBookId:randomUUID(),projectId:randomUUID()},ids=Array.from({length:1001},()=>randomUUID()),initial=await f.execute('open');let state=initial;
 for(let offset=0;offset<ids.length;offset+=32)state=await f.execute('change',edit(state,ids.slice(offset,offset+32).map(id=>record(source,id))));
 assert.equal(state.sources.count,1);assert.deepEqual(state.site.document.website.researchSources,[]);assert.ok(Buffer.byteLength(JSON.stringify(state))<32768);
 assert.equal(catalogueRequiresWebsiteSourceSelections(await f.workspace.catalogue(store=>catalogueFormat(store.db))),true);
 const late=await f.execute('sources',{...target(state),sourceId:source.workspaceId,collection:'records',offset:997,limit:4});
 assert.equal(late.total,1001);assert.deepEqual(late.rows.map(row=>row.key),ids.slice(997));assert.equal(late.source.selection.records.length,0);
 const requested=await f.execute('sources',{...target(state),sourceId:source.workspaceId,recordIds:[ids[0],ids.at(-1)]});assert.deepEqual(requested.source.selection.records.map(row=>row.id),[ids[0],ids.at(-1)]);
 const command=edit(state,[record(source,ids.at(-1),false)]),changed=await f.execute('change',command);assert.deepEqual(await f.execute('change',command),changed);
 await assert.rejects(f.execute('change',edit(state,[record(source,ids[0],false)])),{code:'CONFLICT'});
 assert.equal((await f.execute('sources',{...target(changed),sourceId:source.workspaceId,collection:'records',offset:1000,limit:1})).rows[0].value.share,false);
 const undone=await f.execute('undo',transition(changed));assert.equal((await f.execute('sources',{...target(undone),sourceId:source.workspaceId,collection:'records',offset:1000,limit:1})).rows[0].value.share,true);
 const redone=await f.execute('redo',transition(undone)),saved=await f.execute('save',transition(redone));assert.equal(saved.draft,null);
 const reopened=new WebsiteEditor(new Workspace(f.workspace.root,f.vault)),read=(operation,data={},websiteId=f.first)=>reopened.execute(operation,{workspaceId:f.book.id,websiteId,...data});
 const opened=await read('open'),page=await read('sources',{...target(opened),sourceId:source.workspaceId,collection:'records',offset:999,limit:2});
 assert.equal(page.total,1001);assert.deepEqual(page.rows.map(row=>[row.key,row.value.share]),[[ids[999],true],[ids[1000],false]]);
 const other=await read('open',{},f.second);assert.equal(other.sources.count,0);await assert.rejects(read('sources',{...target(opened),sourceId:source.workspaceId},f.second),error=>['INVALID','CONFLICT','WEBSITE_CHANGED'].includes(error.code));
 const removed=await f.execute('change',edit(opened,[{type:'source-selection',kind:'remove',workspaceId:source.workspaceId,labBookId:source.labBookId}]));assert.equal(removed.sources.count,0);
 const discarded=await f.execute('discard',transition(removed));assert.equal(discarded.sources.count,1);assert.equal((await f.execute('sources',{...target(discarded),sourceId:source.workspaceId,collection:'records',offset:1000,limit:1})).rows[0].value.share,false);
 await f.workspace.catalogue(async store=>{await new WebsiteDocumentStore(store).verify();await verifyWebsiteEditor(store);});
});

test('source commands keep copied record identities and edition selections separate between owners',{timeout:120000},async t=>{
 const f=await fixture(t),recordId=randomUUID(),attachmentId=randomUUID(),first={workspaceId:randomUUID(),labBookId:randomUUID(),projectId:randomUUID()},second={workspaceId:randomUUID(),labBookId:randomUUID(),projectId:randomUUID()};let state=await f.execute('open');
 const choice={id:recordId,revision:'a'.repeat(64),include:true,body:true,sections:[],fields:[],attachments:[],figures:[]};
 state=await f.execute('change',edit(state,[record(first,recordId),record(second,recordId,false),{type:'source-selection',kind:'attachment',...first,recordId,attachmentId,share:true},{type:'source-selection',kind:'edition',workspaceId:first.workspaceId,labBookId:first.labBookId,collection:'editionRecords',key:recordId,value:choice}]));
 const page=owner=>f.execute('sources',{...target(state),sourceId:owner.workspaceId,recordIds:[recordId],collection:'editionRecords'});
 const a=await page(first),b=await page(second);assert.equal(a.source.selection.records[0].share,true);assert.deepEqual(a.source.selection.records[0].attachments,[{id:attachmentId,share:true}]);assert.deepEqual(a.rows[0].value,choice);assert.equal(b.source.selection.records[0].share,false);assert.deepEqual(b.source.selection.records[0].attachments,[]);assert.equal(b.rows.length,0);
 const bad=edit(state,[record(first,randomUUID()),{type:'source-selection',kind:'edition',workspaceId:first.workspaceId,labBookId:first.labBookId,collection:'editionRecords',key:recordId,value:{...choice,id:randomUUID()}}]);
 await assert.rejects(f.execute('change',bad),{code:'INVALID'});assert.equal((await f.execute('open')).draft.revision,state.draft.revision);
 state=await f.execute('change',edit(state,[{type:'source-selection',kind:'edition',workspaceId:first.workspaceId,labBookId:first.labBookId,collection:'editionRecords',key:recordId,value:null}]));assert.equal((await page(first)).rows.length,0);
 // Bulk inclusion clears only the selected owner's record override, preserving
 // its explicit attachment choice and the other owner's copied record ID.
 state=await f.execute('change',edit(state,[{type:'source-selection',kind:'project',...first,share:true},record(second,recordId)]));
 assert.equal((await page(first)).source.selection.records[0].share,null);assert.deepEqual((await page(first)).source.selection.records[0].attachments,[{id:attachmentId,share:true}]);assert.equal((await page(second)).source.selection.records[0].share,true);
 // Removing an earlier source shifts positions; later operations in the same
 // command must still address their own source and remain one undo step.
 state=await f.execute('change',edit(state,[record(second,recordId,false),{type:'source-selection',kind:'remove',workspaceId:first.workspaceId,labBookId:first.labBookId},record(second,recordId)]));
 assert.equal(state.sources.count,1);assert.equal((await page(first)).source,null);assert.equal((await page(second)).source.selection.records[0].share,true);
 state=await f.execute('undo',transition(state));assert.equal(state.sources.count,2);assert.equal((await page(first)).source.selection.records[0].share,null);
});
