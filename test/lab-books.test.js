import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../src/sample.js';
import {saveStructure} from '../src/structure.js';
import {Workspace} from '../src/storage.js';
import {startServer} from '../src/server.js';
import {validateNotebook} from '../src/model.js';

const command=(id,records='empty',destinationId=null)=>({kind:'delete-notebook',value:{id,records,destinationId,confirmed:true}});
function fixture(){
 const book=sampleNotebook(),source=book.notebooks[0],destination={id:randomUUID(),projectId:source.projectId,title:'Keep'};
 book.notebooks.push(destination);
 return {book,source,destination};
}

test('empty lab book deletion leaves projects, other books, records and tools intact',()=>{
 const {book,destination}=fixture();book.projects[0].tools=['resources'];const before=structuredClone(book);
 const next=saveStructure(book,command(destination.id)).book;
 assert.deepEqual(book,before);assert.deepEqual(next.notebooks,[book.notebooks[0]]);
 for(const key of ['projects','entries','pages','website'])assert.deepEqual(next[key],book[key]);
});

test('deletion requires an explicit valid decision and cannot silently remove records',()=>{
 const {book,source,destination}=fixture(),before=structuredClone(book);
 for(const change of [
  command(source.id),command(randomUUID()),command(source.id,'move',source.id),
  command(source.id,'move',randomUUID()),command(source.id,'move'),command(source.id,'delete',destination.id),
  {...command(source.id,'delete'),value:{...command(source.id,'delete').value,confirmed:false}},
  {...command(source.id,'delete'),value:{id:source.id}}
 ])assert.throws(()=>saveStructure(book,change),{code:'INVALID'});
 assert.deepEqual(book,before);
});

test('moving records preserves IDs, content and sharing within a project; crossing projects makes them private',()=>{
 const {book,source,destination}=fixture();
 const next=saveStructure(book,command(source.id,'move',destination.id)).book;
 assert.equal(next.notebooks.length,1);
 assert.deepEqual(next.entries,book.entries.map(e=>({...e,notebookId:destination.id})));
 const second={...book.projects[0],id:randomUUID(),title:'Another wing'};book.projects.push(second);destination.projectId=second.id;
 const moved=saveStructure(book,command(source.id,'move',destination.id)).book;
 assert.deepEqual(moved.entries,book.entries.map(e=>({...e,notebookId:destination.id,share:false})));
});

test('deleting records removes publication targets, reparents menus and retains independent research references',()=>{
 const {book,source,destination}=fixture(),sourceTarget='notebook:'+source.id,target='notebook:'+destination.id;
 const survivor={...book.entries[0],id:randomUUID(),notebookId:destination.id,relations:[{id:randomUUID(),type:'Related to',target:{workspaceId:book.id,kind:'record',id:book.entries[0].id},label:'Earlier observation'}]};
 book.entries.push(survivor);
 book.branding=[{target:sourceTarget,logos:[]},{target:'entry:'+book.entries[0].id,logos:[]},{target,logos:[]}];
 book.website.navigation=[{target:'home',label:'Home',show:true,parent:null},{target:sourceTarget,label:'Source',show:true,parent:'home'},{target,label:'Keep',show:true,parent:sourceTarget}];
 book.website.layouts=[sourceTarget,'entry:'+book.entries[0].id,target].map(target=>({target,showHeading:true,heading:'',description:'',placement:'after',sections:[]}));
 validateNotebook(book);
 const next=saveStructure(book,command(source.id,'delete')).book;
 assert.deepEqual(next.entries,[survivor]);assert.deepEqual(next.branding,[{target,logos:[]}]);
 assert.deepEqual(next.website.navigation,[{target:'home',label:'Home',show:true,parent:null},{target,label:'Keep',show:true,parent:'home'}]);
 assert.deepEqual(next.notebooks,[destination]);assert.deepEqual(next.projects,book.projects);
 assert.deepEqual(next.website.layouts,book.website.layouts.filter(l=>l.target===target));
});

test('HTTP deletion is atomic, refuses changes since review, and retains a restorable prior version',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-delete-book-')),ws=new Workspace(path.join(dir,'workspace'));
 const {book,source,destination}=fixture();await ws.create(book);
 const app=await startServer({root:ws.root,port:0,preferencesFile:path.join(dir,'preferences.json')});t.after(()=>app.close());
 const auth=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});
 const cookie=auth.headers.get('set-cookie').split(';')[0];
 const send=(etag,change)=>fetch(app.origin+'/api/workspace/structure',{method:'POST',headers:{Cookie:cookie,Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({etag,change})});
 const initial=await ws.read();
 assert.equal((await send(initial.etag,command(source.id))).status,422);
 assert.equal((await ws.read()).etag,initial.etag);
 initial.book.entries.push({...initial.book.entries[0],id:randomUUID(),notebookId:destination.id,title:'Arrived during review'});
 const changed=await ws.save(initial.book,initial.etag);
 assert.equal((await send(initial.etag,command(destination.id))).status,409);
 assert.equal((await ws.read()).etag,changed.etag);
 const response=await send(changed.etag,command(source.id,'delete'));assert.equal(response.status,200);
 const deleted=await response.json();assert.equal(deleted.book.notebooks.length,1);assert.equal(deleted.book.entries.length,1);
 assert.ok((await ws.history()).some(v=>v.id===changed.etag));
 const restored=await ws.restore(changed.etag,deleted.etag);
 assert.deepEqual(restored.book.notebooks,changed.book.notebooks);
 const contents=entries=>entries.map(({createdAt,updatedAt,...record})=>record);
 assert.deepEqual(contents(restored.book.entries),contents(changed.book.entries));
});
