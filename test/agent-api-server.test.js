import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {agentServerFixture,result} from './agent-server-fixture.js';
import {AgentKeyStore} from '../src/security/agent-keys.js';
import {validRichText} from '../src/web/rich-text-model.js';

// Keys are made by the owner in the app; here the test makes them in the same store.
async function keys(f){
 const store=new AgentKeyStore(f.device.file+'.agents'),workspaceId=(await result(await f.owner('/api/workspace/read/start',{}))).metadata.id;
 return {workspaceId,create:async(scope,access='write')=>(await store.create({name:'Agent '+randomUUID().slice(0,8),workspaceId,scope,access})).key};
}

test('agents learn the API from the app and work only through their key, scope and the owner\'s unlocked session',{timeout:600000},async t=>{
 const f=await agentServerFixture(t),{workspaceId,create}=await keys(f);
 const project=await f.createProject('Software notes'),book=await f.createBook(project.projectId,'Release log'),other=await f.createBook(project.projectId,'Design notes');
 // The description needs no key and names this build's operations.
 const description=await result(await f.agent('/api/v1/openapi.json'));
 assert.equal(description.openapi,'3.1.0');assert.equal(description.servers[0].url,f.app.origin);
 for(const name of ['me','projects/list','lab-books/list','records/list','records/get','records/create','records/update'])assert.ok(description.paths['/api/v1/agent/'+name],name);
 assert.equal(description.paths['/api/v1/agent/records/create'].post.requestBody.content['application/json'].schema.properties.record.required.join(),'type,title');
 // No key, a browser origin, or a session mixed with a key is refused.
 assert.equal((await result(await f.agent('/api/v1/agent/me'),401)).code,'AGENT_KEY_INVALID');
 const key=await create({kind:'workspace'});
 assert.equal((await result(await f.agent('/api/v1/agent/me',{key,headers:{Origin:'https://example.org'}}),403)).code,'ORIGIN');
 assert.equal((await result(await f.agent('/api/v1/agent/me',{key,headers:{'X-Observanda-Session':f.session}}),401)).code,'AUTH');
 assert.equal((await result(await f.agent('/api/v1/agent/me',{key:key.slice(0,-1)+(key.endsWith('A')?'B':'A')}),401)).code,'AGENT_KEY_INVALID');
 const me=await result(await f.agent('/api/v1/agent/me',{key}));assert.equal(me.workspaceId,workspaceId);assert.equal(me.access,'write');assert.equal(me.apiVersion,'1.0.0');
 // Listing follows the app's own projects and lab books.
 const projects=await result(await f.agent('/api/v1/agent/projects/list',{key,data:{}}));
 assert.deepEqual(projects.projects.map(item=>item.title),['Software notes']);assert.equal(projects.nextCursor,null);
 const books=await result(await f.agent('/api/v1/agent/lab-books/list',{key,data:{projectId:project.projectId}}));
 assert.deepEqual(books.labBooks.map(item=>item.title).sort(),['Design notes','Release log']);
 assert.equal((await result(await f.agent('/api/v1/agent/lab-books/list',{key,data:{projectId:project.projectId,extra:true}}),422)).code,'INVALID');
 // A record written in Markdown is stored as the app's rich text and read back.
 const place={projectId:project.projectId,labBookId:book.labBookId};
 const created=await result(await f.agent('/api/v1/agent/records/create',{key,data:{...place,record:{type:'note',title:'Release 1.2',status:'completed',tags:['release'],occurredOn:'2026-11-24',text:'# Changes\n\nFixed **two** bugs in `parser`.\n\n- faster start\n- smaller files',sections:[{title:'Known issues',text:'None yet.'}]}}}));
 const read=await result(await f.agent('/api/v1/agent/records/get',{key,data:{...place,recordId:created.id}}));
 assert.equal(read.revision,created.revision);assert.equal(read.title,'Release 1.2');assert.equal(read.occurredOn,'2026-11-24');assert.deepEqual(read.tags,['release']);
 assert.match(read.text,/Fixed two bugs in parser/);assert.deepEqual(read.sections.map(section=>[section.title,section.text]),[['Known issues','None yet.']]);
 const stored=(await result(await f.owner('/api/projects/'+project.projectId+'/lab-books/'+book.labBookId+'/workspace/read/selection',{workspaceId:(await result(await f.owner('/api/projects/'+project.projectId+'/lab-books/'+book.labBookId+'/workspace/read/start',{}))).metadata.id,ids:[created.id]}))).book.entries[0];
 assert.equal(validRichText(stored.body),true);assert.equal(stored.body.content[0].type,'heading');
 const listed=await result(await f.agent('/api/v1/agent/records/list',{key,data:{...place,search:'Release'}}));assert.deepEqual(listed.records.map(item=>item.id),[created.id]);assert.deepEqual({title:listed.records[0].title,type:listed.records[0].type,status:listed.records[0].status},{title:'Release 1.2',type:'note',status:'completed'});assert.equal(listed.total,1);
 const updated=await result(await f.agent('/api/v1/agent/records/update',{key,data:{...place,recordId:created.id,expectedRevision:read.revision,changes:{status:'in progress',sections:[{id:read.sections[0].id,title:'Known issues',text:'One: slow export.'}]}}}));
 assert.notEqual(updated.revision,read.revision);
 const again=await result(await f.agent('/api/v1/agent/records/get',{key,data:{...place,recordId:created.id}}));assert.equal(again.status,'in progress');assert.equal(again.sections[0].id,read.sections[0].id);assert.equal(again.sections[0].text,'One: slow export.');
 assert.equal((await result(await f.agent('/api/v1/agent/records/update',{key,data:{...place,recordId:created.id,expectedRevision:read.revision,changes:{title:'Stale'}}}),409)).code,'RECORD_CHANGED');
 // Scope and access are enforced on every operation.
 const readOnly=await create({kind:'workspace'},'read');
 assert.equal((await result(await f.agent('/api/v1/agent/records/create',{key:readOnly,data:{...place,record:{type:'note',title:'Refused'}}}),403)).code,'AGENT_KEY_SCOPE');
 const scoped=await create({kind:'lab-book',projectId:project.projectId,labBookId:book.labBookId});
 assert.deepEqual((await result(await f.agent('/api/v1/agent/lab-books/list',{key:scoped,data:{projectId:project.projectId}}))).labBooks.map(item=>item.title),['Release log']);
 assert.equal((await result(await f.agent('/api/v1/agent/records/list',{key:scoped,data:{projectId:project.projectId,labBookId:other.labBookId}}),403)).code,'AGENT_KEY_SCOPE');
 assert.equal((await result(await f.agent('/api/v1/agent/records/get',{key:scoped,data:{...place,recordId:created.id}}))).id,created.id);
 // Once the owner locks the workspace, no key works until it is unlocked again.
 await result(await f.owner('/api/access/lock',{}));
 assert.equal((await result(await f.agent('/api/v1/agent/records/get',{key,data:{...place,recordId:created.id}}),401)).code,'ACCESS_LOCKED');
});
