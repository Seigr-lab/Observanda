import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {labBookDirectoryState} from '../src/web/lab-book-directory-state.js';

const row=name=>({labBookId:randomUUID(),directory:name,namespaceId:randomUUID(),vaultId:randomUUID()});
const deferred=()=>{let resolve;return {promise:new Promise(done=>resolve=done),resolve};};
const result=(items,revision='current')=>({items,next:null,total:items.length,revision});
const operation=(projectId,kind='create',status='completed')=>({id:randomUUID(),kind:'/api/projects/'+projectId+'/lab-books/'+kind,state:status});
function fixture(){
 const projectId=randomUUID(),state={book:{},page:'project',projectOwner:{projectId},storage:{contextId:'workspace',researchStorage:'catalogue'}},calls=[],rows=new Map([[projectId,[row('First book')]]]);let handler=null,paints=0;
 const directory=labBookDirectoryState({state,changed:()=>paints++,api:async(route,input,options)=>{assert.equal(options.adopt,false);assert.equal(input.limit,50);const owner=route.split('/')[3];calls.push({owner,...input});return handler?handler(owner,input):result(rows.get(owner)??[]);}});
 return {state,directory,projectId,rows,calls,setHandler:value=>handler=value,paints:()=>paints,snapshot:operations=>({contextId:state.storage.contextId,operations})};
}

test('completed lab-book membership commands refresh only cached owners and never react to progress or unrelated writes',async()=>{
 const f=fixture(),sibling=randomUUID();f.rows.set(sibling,[row('Sibling book')]);await f.directory.bind();await f.directory.refresh(sibling);f.calls.length=0;
 const creating=operation(f.projectId,'create','running');await f.directory.activity(f.snapshot([creating]));creating.state='queued';await f.directory.activity(f.snapshot([creating]));
 await f.directory.activity(f.snapshot([operation(f.projectId,'create/pending'),operation(f.projectId,randomUUID()+'/research/records/save'),operation(sibling,'create','failed')]));assert.equal(f.calls.length,0);
 const newBook=row('New book');f.rows.get(f.projectId).push(newBook);creating.state='completed';const snapshot=f.snapshot([creating]);await f.directory.activity({...snapshot,contextId:'other workspace'});assert.equal(f.calls.length,0);
 await f.directory.activity(snapshot);await f.directory.activity(snapshot);assert.deepEqual(f.calls.map(call=>call.owner),[f.projectId]);assert.equal(f.directory.page(f.projectId).items.at(-1).labBookId,newBook.labBookId);assert.equal(f.directory.page(sibling).items.length,1);
 const uncached=randomUUID();await f.directory.activity(f.snapshot([creating,operation(uncached)]));assert.equal(f.calls.length,1);
});

test('create, import, rename, settings and deletion completions share directory invalidation without reading record payloads',async()=>{
 const f=fixture(),bookId=randomUUID();await f.directory.bind();const history=[];
 for(const kind of ['create','create/resume','import','import/resume','import/cancel',bookId+'/settings/save',bookId+'/storage/rename',bookId+'/storage/delete',bookId+'/storage/delete/resume']){
  f.calls.length=0;history.push(operation(f.projectId,kind));await f.directory.activity(f.snapshot(history));assert.deepEqual(f.calls.map(call=>call.owner),[f.projectId],kind);
 }
 f.calls.length=0;history.push(...['create/pending','import/pending',bookId+'/storage/details',bookId+'/storage/copy',bookId+'/storage/export'].map(kind=>operation(f.projectId,kind)));await f.directory.activity(f.snapshot(history));assert.equal(f.calls.length,0);
});

test('completions during the first load coalesce and cannot publish the older directory or repeat on a large retained activity list',async()=>{
 const f=fixture(),wait=deferred(),old=row('Old snapshot'),fresh=row('Fresh snapshot');let count=0;
 f.setHandler(()=>++count===1?wait.promise:result([fresh],'new'));
 const loading=f.directory.bind(),history=Array.from({length:600},()=>operation(f.projectId)),refresh=f.directory.activity(f.snapshot(history));
 const same=f.directory.bind();assert.equal(f.calls.length,1);wait.resolve(result([old],'old'));await Promise.all([loading,refresh,same]);assert.equal(f.calls.length,2);assert.deepEqual(f.directory.page(f.projectId).items,[fresh]);
 await f.directory.activity(f.snapshot(history));await f.directory.bind();assert.equal(f.calls.length,2);
});

test('refresh retains the loaded page depth and restarts a conflicting cursor without duplicating books',async()=>{
 const f=fixture();let books=Array.from({length:55},(_,i)=>row('Book '+i)),revision='first';
 f.setHandler((owner,input)=>{if(input.revision&&input.revision!==revision)throw {code:'CONFLICT'};const offset=input.after?books.findIndex(book=>book.labBookId===input.after)+1:0,items=books.slice(offset,offset+50);return {items,next:offset+items.length<books.length?items.at(-1).labBookId:null,total:books.length,revision};});
 await f.directory.bind();assert.equal(f.directory.page(f.projectId).items.length,50);revision='second';books=[row('Added first'),...books];await f.directory.more(f.projectId);
 assert.deepEqual(f.calls.map(call=>call.after),[null,f.calls[1].after,null,books[49].labBookId]);assert.equal(f.directory.page(f.projectId).items.length,56);assert.equal(f.directory.page(f.projectId).depth,2);
 books=books.slice(2).map((book,i)=>i?book:{...book,directory:'Renamed book'});revision='third';f.calls.length=0;await f.directory.activity(f.snapshot([operation(f.projectId,books[0].labBookId+'/storage/rename')]));
 assert.equal(f.calls.length,2);assert.deepEqual(f.directory.page(f.projectId).items,books);assert.equal(new Set(f.directory.page(f.projectId).items.map(book=>book.labBookId)).size,books.length);
});

test('a completion during pagination replaces the stale page and preserves the requested page count',async()=>{
 const f=fixture(),wait=deferred(),books=Array.from({length:51},(_,i)=>row('Book '+i));let reads=0;
 f.setHandler((owner,input)=>{reads++;if(reads===2)return wait.promise;return {items:input.after?books.slice(50):books.slice(0,50),next:input.after?null:books[49].labBookId,total:51,revision:reads>2?'new':'old'};});
 await f.directory.bind();const more=f.directory.more(f.projectId),refresh=f.directory.activity(f.snapshot([operation(f.projectId)]));books[50]={...books[50],directory:'Updated last book'};wait.resolve({items:[{...books[50],directory:'Stale last book'}],next:null,total:51,revision:'old'});await Promise.all([more,refresh]);
 assert.equal(f.calls.length,4);assert.deepEqual(f.calls.map(call=>call.after),[null,books[49].labBookId,null,books[49].labBookId]);assert.deepEqual(f.directory.page(f.projectId).items,books);assert.equal(f.directory.page(f.projectId).loading,false);
});

test('a move refreshes its source and the visible candidate while cached offscreen projects wait for entry',async()=>{
 const f=fixture(),destination=randomUUID(),offscreen=randomUUID(),book=row('Moved book');f.rows.set(f.projectId,[book]);f.rows.set(destination,[]);f.rows.set(offscreen,[row('Unrelated book')]);await f.directory.bind();await f.directory.refresh(destination);await f.directory.refresh(offscreen);
 f.state.projectOwner={projectId:destination};await f.directory.bind();f.calls.length=0;f.rows.set(f.projectId,[]);f.rows.set(destination,[book]);const completed=operation(f.projectId,book.labBookId+'/storage/move/resume');
 await f.directory.activity(f.snapshot([completed]));assert.deepEqual(new Set(f.calls.map(call=>call.owner)),new Set([f.projectId,destination]));assert.equal(f.calls.length,2);assert.deepEqual(f.directory.page(f.projectId).items,[]);assert.deepEqual(f.directory.page(destination).items,[book]);assert.equal(f.directory.page(offscreen).stale,true);
 await f.directory.bind();await f.directory.activity(f.snapshot([completed]));assert.equal(f.calls.length,2);
 f.state.projectOwner={projectId:offscreen};await f.directory.bind();assert.equal(f.calls.length,3);assert.equal(f.calls.at(-1).owner,offscreen);assert.equal(f.directory.page(offscreen).stale,false);await f.directory.bind();assert.equal(f.calls.length,3);
});

test('a move cannot clear an offscreen invalidation with an older in-flight directory reply',async()=>{
 const f=fixture(),offscreen=randomUUID(),wait=deferred(),book=row('Old membership');await f.directory.bind();f.setHandler(owner=>owner===offscreen?wait.promise:result([]));const loading=f.directory.refresh(offscreen);
 await f.directory.activity(f.snapshot([operation(f.projectId,book.labBookId+'/storage/move')]));wait.resolve(result([book]));await loading;assert.equal(f.directory.page(offscreen).stale,true);assert.deepEqual(f.directory.page(offscreen).items,[]);
 f.setHandler(()=>result([]));f.state.projectOwner={projectId:offscreen};await f.directory.bind();assert.deepEqual(f.directory.page(offscreen).items,[]);assert.equal(f.directory.page(offscreen).stale,false);
});

test('returning to a loaded project revalidates once even after completed activity has been cleared',async()=>{
 const f=fixture();await f.directory.bind();await f.directory.bind();assert.equal(f.calls.length,1);f.state.page='preferences';await f.directory.bind();f.rows.get(f.projectId).push(row('Created while away'));await f.directory.activity(f.snapshot([]));assert.equal(f.calls.length,1);
 f.state.page='project';await f.directory.bind();await f.directory.bind();assert.equal(f.calls.length,2);assert.equal(f.directory.page(f.projectId).items.length,2);
});

test('late replies are discarded across workspace, storage-format and lock changes',async()=>{
 for(const change of [state=>state.storage.contextId='second',state=>state.storage.researchStorage='document',state=>state.access={locked:true}]){
  const f=fixture(),wait=deferred();f.setHandler(()=>wait.promise);const loading=f.directory.bind(),before=f.paints();change(f.state);wait.resolve(result([row('Previous workspace')]));await loading;assert.equal(f.paints(),before);assert.deepEqual(f.directory.entries(),[]);
 }
 const f=fixture();f.state.storage.researchStorage='document';await f.directory.bind();await f.directory.refresh(f.projectId);await f.directory.activity(f.snapshot([operation(f.projectId)]));assert.equal(f.calls.length,0);
});

test('visible directory failures remain actionable and retry preserves existing entries until recovery',async()=>{
 const f=fixture();await f.directory.bind();const retained=[...f.directory.page(f.projectId).items];f.setHandler(()=>{throw {code:'ACCESS_LOCKED',message:'Unlock this project'};});await f.directory.activity(f.snapshot([operation(f.projectId)]));
 assert.equal(f.directory.page(f.projectId).error,'Unlock this project');assert.deepEqual(f.directory.page(f.projectId).items,retained);const before=f.calls.length;await f.directory.bind();assert.equal(f.calls.length,before);
 f.setHandler(()=>result([row('Available again')]));await f.directory.refresh(f.projectId);assert.equal(f.directory.page(f.projectId).error,'');assert.equal(f.directory.page(f.projectId).items[0].directory,'Available again');
});
