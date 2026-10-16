import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {collaborationFixture} from './fixtures/collaboration.js';
import {startLiveHost} from '../src/collaboration/live-host.js';
import {LiveClient} from '../src/collaboration/live-client.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {MediaStore} from '../src/media.js';

test('shared relationships merge independently, pin methods, enforce scope and roll back retention with failed audits',async t=>{
 const f=await collaborationFixture(t),ws=f.author.workspace;
 const {book}=await ws.read(),source=book.entries[0],method=book.entries[1],hidden=book.entries[2];
 const host=await startLiveHost(ws,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0});t.after(()=>host.close());
 const card=await host.card(f.grant.id),a=new LiveClient(f.member.deviceStore,card),b=new LiveClient(f.member.deviceStore,card);t.after(()=>{a.close();b.close();});
 const command=(value,before=null,linkId=before?.id??randomUUID())=>({recordId:source.id,id:randomUUID(),linkId,before,value});
 const value=(target,role=null,revision=null)=>({type:role==='uses-method'?'Uses':'Related to',role,target:{id:target.id,revision}});
 const choices=await a.call('link-targets',{recordId:source.id,query:'',after:null,notebookId:null});assert.equal(choices.records.find(r=>r.id===method.id).revision,recordRevision(method));assert(!choices.records.some(r=>r.id===hidden.id||r.id===source.id));
 await assert.rejects(a.call('link-targets',{recordId:source.id,query:'',after:null,notebookId:hidden.notebookId}),{code:'COLLABORATION_DENIED'});
 const pinned=command(value(method,'uses-method',recordRevision(method))),ordinary=command(value(method));
 await Promise.all([a.call('link-write',pinned),b.call('link-write',ordinary)]);
 let links=(await a.call('links',{recordId:source.id})).relations;const methodLink=links.find(r=>r.id===pinned.linkId);assert.equal(methodLink.target.revision,recordRevision(method));assert(links.some(r=>r.id===ordinary.linkId));
 assert.deepEqual((await new ResearchMaterials(ws).read(methodLink.target)),method);
 await ws.update(book=>{const m=book.entries.find(r=>r.id===method.id);m.title='Revised method';m.body='Later instructions';return book;});
 const historical=await a.call('link-read',{recordId:source.id,linkId:pinned.linkId});assert.deepEqual(historical.record,method);assert.notEqual(historical.currentRevision,historical.revision);
 assert.equal((await a.call('link-read',{recordId:source.id,linkId:ordinary.linkId})).record.title,'Revised method');
 const rename=command({...value(method,'uses-method',recordRevision(method)),type:'Builds on'},methodLink);await a.call('link-write',rename);
 await assert.rejects(b.call('link-write',command(null,methodLink)),{code:'RECORD_CHANGED'});
 await a.call('link-write',pinned); // Lost response: no resurrection of the original type.
 links=(await a.call('links',{recordId:source.id})).relations;assert.equal(links.find(r=>r.id===pinned.linkId).type,'Builds on');
 for(const invalid of [value(source),value(method,'uses-method'),value(method,'run-of'),{...value(method),type:'injected'},value(method,'unrecognized')])await assert.rejects(a.call('link-write',command(invalid)));
 await assert.rejects(a.call('link-write',command(value(hidden))),{code:'COLLABORATION_DENIED'});
 await assert.rejects(a.call('link-write',command(value(method,'uses-method',recordRevision(method)))),{code:'RECORD_CHANGED'});
 const latest=(await a.call('read',{recordId:method.id})).record,latestRevision=recordRevision(latest),write=ws.writeMetadata;
 ws.writeMetadata=async function(file,data){if(file.includes('/live/activity/'))throw Error('Synthetic audit failure');return write.call(this,file,data);};
 try{await assert.rejects(a.call('link-write',command(value(latest,'uses-method',latestRevision))));}finally{ws.writeMetadata=write;}
 assert.equal(await ws.readMetadata('.observanda/materials/records/'+method.id+'/'+latestRevision+'.json',1024*1024),null);
 assert.deepEqual((await a.call('links',{recordId:source.id})).relations,links);
 const saved=(await a.call('read',{recordId:source.id})).record;assert.deepEqual(saved.body,source.body);assert.deepEqual(saved.template,source.template);assert.equal(saved.share,source.share);
 await ws.update(book=>{book.entries.find(r=>r.id===method.id).notebookId=hidden.notebookId;return book;});
 await assert.rejects(a.call('link-read',{recordId:source.id,linkId:pinned.linkId}),{code:'COLLABORATION_DENIED'});
 // Removing an inaccessible target must remain possible for the source editor.
 const removal=command(null,links.find(r=>r.id===pinned.linkId));await a.call('link-write',removal);await a.call('link-write',removal);
 const {generation,...grant}=f.grant;void generation;await f.sa.access.saveLocal(await f.a.identity.public(),{...grant,workspaceId:f.book.id,expectedRevision:1,role:'reader'});
 await assert.rejects(a.call('link-write',ordinary),{code:'COLLABORATION_DENIED'});assert((await a.call('links',{recordId:source.id})).relations.some(r=>r.id===ordinary.linkId));
});

test('run series have one parent and pinned method media cannot bypass current or historical scope',async t=>{
 const f=await collaborationFixture(t),ws=f.author.workspace,media=new MediaStore(ws.root,ws.vault);
 const host=await startLiveHost(ws,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0});t.after(()=>host.close());
 const a=new LiveClient(f.member.deviceStore,await host.card(f.grant.id));t.after(()=>a.close());
 const {book}=await ws.read(),method=book.entries[0],other=book.entries[1],hidden=book.entries[2];
 const options=await a.call('creation',{notebookId:method.notebookId}),template=options.choices.find(v=>v.id==='run');
 const created=await a.call('create',{id:randomUUID(),notebookId:method.notebookId,source:{kind:'type',id:'run',revision:template.revision},title:'Shared run',occurredOn:'2026-10-09',values:{}}),recordId=created.record.id;
 const command=(target,role,revision=null)=>({recordId,id:randomUUID(),linkId:randomUUID(),before:null,value:{type:'Uses',role,target:{id:target.id,revision}}});
 await a.call('link-write',command(method,'run-of'));await assert.rejects(a.call('link-write',command(other,'run-of')),{code:'RECORD_CHANGED'});
 // Retain an image and then remove it from the current method. Only that exact
 // linked revision may serve it; guessing an unrelated attachment is denied.
 const image=await media.import(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=','base64'),'image');
 const patched={...method,attachments:[{id:image.id,kind:'image',caption:'Method apparatus',alt:'Apparatus',transcript:'',share:false}]};
 await new ResearchRecords(ws,media).save({workspaceId:book.id,changes:[{id:method.id,expectedRevision:recordRevision(method),record:patched}]});
 const revision=recordRevision((await a.call('read',{recordId:method.id})).record),link=command(method,'uses-method',revision);await a.call('link-write',link);
 await ws.update(book=>{book.entries.find(r=>r.id===method.id).attachments=[];return book;});
 const response=await a.call('file',{recordId,kind:'media',id:image.id,linkId:link.linkId,revision},{stream:true});const bytes=Buffer.concat(await Array.fromAsync(response));assert(bytes.length>0);
 await assert.rejects(a.call('file',{recordId,kind:'media',id:image.id,linkId:link.linkId,revision:'0'.repeat(64)}),{code:'RECORD_CHANGED'});
 await assert.rejects(a.call('file',{recordId,kind:'media',id:randomUUID(),linkId:link.linkId,revision}),{code:'COLLABORATION_DENIED'});
 await ws.update(book=>{book.entries.find(r=>r.id===method.id).notebookId=hidden.notebookId;return book;});
 await assert.rejects(a.call('file',{recordId,kind:'media',id:image.id,linkId:link.linkId,revision}),{code:'COLLABORATION_DENIED'});
});

test('shared target discovery is paged and historical book ownership cannot be bypassed by moving a record',async t=>{
 const f=await collaborationFixture(t),ws=f.author.workspace,{book}=await ws.read(),source=book.entries[0],hidden=book.entries[2],materials=new ResearchMaterials(ws);
 const old=await ws.withLock(()=>materials.retainRecord(hidden)),linkId=randomUUID(),ids=[];
 await ws.update(book=>{
  // Norwegian collation treats aa differently from binary UUID ordering. The
  // cursor must use the same order on every installation, including this edge.
  for(let i=0;i<57;i++){const prefix=i<49?i.toString(16).padStart(8,'0'):['a000aa00','a000ab00','a000aa01','a000ab01','a000aa02','a000ab02','a000aa03','a000ab03'][i-49],id=prefix+'-0000-4000-8000-000000000000';ids.push(id);book.entries.push({...structuredClone(source),id,title:'Calibration choice '+i,relations:[]});}
  book.entries.find(r=>r.id===hidden.id).notebookId=source.notebookId;
  book.entries.find(r=>r.id===source.id).relations.push({id:linkId,type:'Uses',role:'uses-method',label:'Formerly private method',target:{workspaceId:book.id,...old}});return book;
 });
 const host=await startLiveHost(ws,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0});t.after(()=>host.close());const a=new LiveClient(f.member.deviceStore,await host.card(f.grant.id));t.after(()=>a.close());
 const request={recordId:source.id,query:'CALIBRATION CHOICE',after:null,notebookId:source.notebookId},first=await a.call('link-targets',request),last=await a.call('link-targets',{...request,after:first.next});
 assert.deepEqual([...first.records,...last.records].map(r=>r.id).sort(),ids.sort());assert.equal(first.records.length,50);assert.equal(last.records.length,7);assert.equal(last.next,null);
 assert.equal((await a.call('read',{recordId:hidden.id})).record.id,hidden.id);
 await assert.rejects(a.call('link-read',{recordId:source.id,linkId}),{code:'COLLABORATION_DENIED'});
 const current=(await a.call('links',{recordId:source.id})).relations.find(r=>r.id===linkId);
 await assert.rejects(a.call('link-write',{recordId:source.id,id:randomUUID(),linkId,before:current,value:{type:'Builds on',role:'uses-method',target:{id:hidden.id,revision:old.revision}}}),{code:'COLLABORATION_DENIED'});
});
