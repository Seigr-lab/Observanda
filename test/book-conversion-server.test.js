import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectTreeFixture} from './project-tree-fixture.js';
import {startServer} from '../src/server.js';
import {sampleNotebook} from '../src/sample.js';
import {ProjectStorage} from '../src/project-storage.js';
import {RecordOwnerTransfer} from '../src/record-owner-transfer.js';
import {AppError} from '../src/errors.js';

async function conversionFixture(t,count=3){
 const f=await projectTreeFixture(t),project=f.projects[0],storage=new ProjectStorage(project.root,project.projectId,project.key),notebookId=randomUUID();
 const records=Array.from({length:count},(_,n)=>({...structuredClone(sampleNotebook().entries[0]),id:randomUUID(),notebookId,title:'Conversion record '+(n+1)}));
 await storage.update(book=>{book.notebooks=[...book.notebooks,{...structuredClone(sampleNotebook().notebooks[0]),id:notebookId,projectId:project.projectId,title:'Ordinary book'}];book.entries=[...book.entries,...records];return book;});
 const server=await startServer({root:f.root,port:0,headless:true,deviceStore:f.deviceStore});t.after(()=>server.close());
 const session=await fetch(server.origin+'/api/session',{method:'POST',headers:{Origin:server.origin,'Content-Type':'application/json'},body:JSON.stringify({token:server.launchToken})});
 assert.equal(session.status,200);const headers={'X-Observanda-Session':session.headers.get('x-observanda-session').split(';')[0],Origin:server.origin};
 headers['X-Observanda-Workspace']=(await (await fetch(server.origin+'/api/storage',{headers})).json()).contextId;
 const raw=(route,data)=>fetch(server.origin+route,{signal:AbortSignal.timeout(300000),method:'POST',headers:{...headers,'Content-Type':'application/json','X-Observanda-Wait':'1'},body:JSON.stringify(data)});
 const call=async(route,data,status=200)=>{const response=await raw(route,data);assert.equal(response.status,status,route+': '+await response.clone().text());return response.json();};
 const workspaceId=(await storage.outline()).metadata.id,convert=operation=>'/api/projects/'+project.projectId+'/research/books/convert/'+operation;
 const inBook=async()=>(await storage.read()).book.entries.filter(entry=>entry.notebookId===notebookId).map(entry=>entry.id).sort();
 return {f,project,storage,notebookId,records,workspaceId,raw,call,convert,inBook};
}

test('a book converts into its own lab book only after every record is verified, and resumes after an interruption',{timeout:900000},async t=>{
 const c=await conversionFixture(t),ids=c.records.map(record=>record.id).sort(),body={workspaceId:c.workspaceId,notebookId:c.notebookId};
 const plan=await c.call(c.convert('plan'),body);assert.equal(plan.records,3);assert.equal(plan.labBook,false);assert.equal(plan.conversion,null);
 assert.equal((await c.call(c.convert('start'),{...body,id:randomUUID(),username:'',password:''})).phase,'moving');
 const original=RecordOwnerTransfer.prototype.perform,calls=[];let interrupted=false;
 t.mock.method(RecordOwnerTransfer.prototype,'perform',function(id,options){
  calls.push(options.until??'complete');
  return original.call(this,id,{...options,checkpoint:async(stage,status)=>{await options.checkpoint?.(stage,status);if(stage==='verified'&&calls.length===2&&!interrupted){interrupted=true;throw new AppError('IO');}}});
 });
 const failed=await c.raw(c.convert('resume'),body);assert.notEqual(failed.status,200);await failed.arrayBuffer();assert.equal(interrupted,true);
 // Interrupted in the first pass: nothing activated or retired, the book still holds every record.
 assert.deepEqual(await c.inBook(),ids);assert.ok(!calls.includes('complete'));
 const result=await c.call(c.convert('resume'),body);assert.equal(result.phase,'switched');
 // Every record was verified before the first activation.
 const firstComplete=calls.indexOf('complete');assert.ok(firstComplete>0);assert.ok(calls.slice(firstComplete).every(call=>call==='complete'));
 assert.equal(result.report.inventory,3);assert.equal(result.report.verified,3);assert.deepEqual(result.report.missing,[]);
 assert.deepEqual(await c.inBook(),[]);assert.equal((await c.storage.read()).book.notebooks.some(book=>book.id===c.notebookId),false);
 const prefix='/api/projects/'+c.project.projectId+'/lab-books/'+c.notebookId;
 const listed=await c.call('/api/projects/'+c.project.projectId+'/lab-books/list',{});assert.ok(listed.items.some(item=>item.labBookId===c.notebookId));
 const labWorkspace=listed.items.find(item=>item.labBookId===c.notebookId).namespaceId;
 for(const id of ids){const read=await c.call(prefix+'/workspace/read/record-content',{workspaceId:labWorkspace,recordId:id,pagedHeader:true});assert.equal(read.recordId,id);}
});

test('a conversion can return every record to its book before it switches over',{timeout:600000},async t=>{
 const c=await conversionFixture(t,2),ids=c.records.map(record=>record.id).sort(),body={workspaceId:c.workspaceId,notebookId:c.notebookId};
 await c.call(c.convert('start'),{...body,id:randomUUID(),username:'',password:''});
 const returned=await c.call(c.convert('return'),body);assert.equal(returned.phase,'returned');
 assert.deepEqual(await c.inBook(),ids);
 const listed=await c.call('/api/projects/'+c.project.projectId+'/lab-books/list',{});assert.equal(listed.items.some(item=>item.labBookId===c.notebookId),false);
});
