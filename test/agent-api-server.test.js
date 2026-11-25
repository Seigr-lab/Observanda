import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {agentServerFixture,result} from './agent-server-fixture.js';
import {AgentKeyStore} from '../src/security/agent-keys.js';
import {validRichText} from '../src/web/rich-text-model.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';

// Keys are made by the owner in the app; here the test makes them in the same store.
async function keys(f){
 const store=new AgentKeyStore(f.device.file+'.agents'),workspaceId=(await result(await f.owner('/api/workspace/read/start',{}))).metadata.id;
 return {workspaceId,create:async(scope,access='write')=>(await store.create({name:'Agent '+randomUUID().slice(0,8),workspaceId,scope,access})).key};
}

test('agents learn the API from the app and work only through their key, scope and the owner\'s unlocked session',{timeout:600000},async t=>{
 const f=await agentServerFixture(t),{workspaceId,create}=await keys(f);
 // Agents find this run's address beside the keys; it changes each time the app starts.
 assert.equal((await new AgentKeyStore(f.device.file+'.agents').endpoint()).origin,f.app.origin);
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
 // Agents write one record at a time; no write reads the whole workspace back,
 // which a large workspace could not answer.
 const wholeReads=[],wholeRead=ResearchCatalogue.prototype.read;ResearchCatalogue.prototype.read=function(...args){wholeReads.push(new Error().stack);return wholeRead.apply(this,args);};
 t.after(()=>{ResearchCatalogue.prototype.read=wholeRead;});
 const created=await result(await f.agent('/api/v1/agent/records/create',{key,data:{...place,record:{type:'note',title:'Release 1.2',status:'completed',tags:['release'],occurredOn:'2026-11-24',text:'# Changes\n\nFixed **two** bugs in `parser`.\n\n- faster start\n- smaller files',sections:[{title:'Known issues',text:'None yet.'}]}}}));
 const read=await result(await f.agent('/api/v1/agent/records/get',{key,data:{...place,recordId:created.id}}));
 assert.equal(read.revision,created.revision);assert.equal(read.title,'Release 1.2');assert.equal(read.occurredOn,'2026-11-24');assert.deepEqual(read.tags,['release']);
 assert.match(read.text,/Fixed two bugs in parser/);assert.deepEqual(read.sections.map(section=>[section.title,section.text]),[['Known issues','None yet.']]);
 const stored=(await result(await f.owner('/api/projects/'+project.projectId+'/lab-books/'+book.labBookId+'/workspace/read/selection',{workspaceId:(await result(await f.owner('/api/projects/'+project.projectId+'/lab-books/'+book.labBookId+'/workspace/read/start',{}))).metadata.id,ids:[created.id]}))).book.entries[0];
 assert.equal(validRichText(stored.body),true);assert.equal(stored.body.content[0].type,'heading');
 const listed=await result(await f.agent('/api/v1/agent/records/list',{key,data:{...place,search:'Release'}}));assert.deepEqual(listed.records.map(item=>item.id),[created.id]);assert.deepEqual({title:listed.records[0].title,type:listed.records[0].type,status:listed.records[0].status},{title:'Release 1.2',type:'note',status:'completed'});assert.equal(listed.total,1);
 const updated=await result(await f.agent('/api/v1/agent/records/update',{key,data:{...place,recordId:created.id,expectedRevision:read.revision,changes:{status:'in progress',sections:[{id:read.sections[0].id,title:'Known issues',text:'One: slow export.'}]}}}));
 assert.notEqual(updated.revision,read.revision);
 assert.deepEqual(wholeReads,[]);ResearchCatalogue.prototype.read=wholeRead;
 const again=await result(await f.agent('/api/v1/agent/records/get',{key,data:{...place,recordId:created.id}}));assert.equal(again.status,'in progress');assert.equal(again.sections[0].id,read.sections[0].id);assert.equal(again.sections[0].text,'One: slow export.');
 assert.equal((await result(await f.agent('/api/v1/agent/records/update',{key,data:{...place,recordId:created.id,expectedRevision:read.revision,changes:{title:'Stale'}}}),409)).code,'RECORD_CHANGED');
 // The owner sees each agent change under the key's name, newest first.
 const changes=(await result(await f.owner('/api/security/agent-keys/activity',{}))).activity;
 assert.deepEqual(changes.map(entry=>[entry.operation,entry.recordId,entry.title,entry.keyName]),[['records/update',created.id,'Release 1.2',me.name],['records/create',created.id,'Release 1.2',me.name]]);
 assert.equal(created.title,'Release 1.2');
 // Scope and access are enforced on every operation.
 const readOnly=await create({kind:'workspace'},'read');
 assert.equal((await result(await f.agent('/api/v1/agent/records/create',{key:readOnly,data:{...place,record:{type:'note',title:'Refused'}}}),403)).code,'AGENT_KEY_SCOPE');
 const scoped=await create({kind:'lab-book',projectId:project.projectId,labBookId:book.labBookId});
 assert.deepEqual((await result(await f.agent('/api/v1/agent/lab-books/list',{key:scoped,data:{projectId:project.projectId}}))).labBooks.map(item=>item.title),['Release log']);
 assert.equal((await result(await f.agent('/api/v1/agent/records/list',{key:scoped,data:{projectId:project.projectId,labBookId:other.labBookId}}),403)).code,'AGENT_KEY_SCOPE');
 assert.equal((await result(await f.agent('/api/v1/agent/records/get',{key:scoped,data:{...place,recordId:created.id}}))).id,created.id);
 // Links reach records in the same lab book and in another lab book of the project.
 const decision=await result(await f.agent('/api/v1/agent/records/create',{key,data:{...place,record:{type:'decision',title:'Choose the parser'}}}));
 const design=await result(await f.agent('/api/v1/agent/records/create',{key,data:{projectId:project.projectId,labBookId:other.labBookId,record:{type:'note',title:'Parser design'}}}));
 let current=await result(await f.agent('/api/v1/agent/records/get',{key,data:{...place,recordId:created.id}}));
 const linked=await result(await f.agent('/api/v1/agent/records/link',{key,data:{...place,recordId:created.id,expectedRevision:current.revision,link:{type:'Builds on',recordId:decision.id}}}));
 const across=await result(await f.agent('/api/v1/agent/records/link',{key,data:{...place,recordId:created.id,expectedRevision:linked.revision,link:{recordId:design.id,labBookId:other.labBookId}}}));
 current=await result(await f.agent('/api/v1/agent/records/get',{key,data:{...place,recordId:created.id}}));
 assert.deepEqual(current.links.map(link=>[link.id,link.type,link.label,link.recordId,link.sameLabBook]),[[linked.linkId,'Builds on','Choose the parser',decision.id,true],[across.linkId,'Related to','Parser design',design.id,false]]);
 assert.equal((await result(await f.agent('/api/v1/agent/records/link',{key:scoped,data:{...place,recordId:created.id,expectedRevision:current.revision,link:{recordId:design.id,labBookId:other.labBookId}}}),403)).code,'AGENT_KEY_SCOPE');
 const unlinked=await result(await f.agent('/api/v1/agent/records/unlink',{key,data:{...place,recordId:created.id,expectedRevision:current.revision,linkId:linked.linkId}}));
 current=await result(await f.agent('/api/v1/agent/records/get',{key,data:{...place,recordId:created.id}}));assert.equal(current.revision,unlinked.revision);assert.deepEqual(current.links.map(link=>link.id),[across.linkId]);
 assert.deepEqual((await result(await f.owner('/api/security/agent-keys/activity',{}))).activity.slice(0,3).map(entry=>entry.operation),['records/unlink','records/link','records/link']);
 // Once the owner locks the workspace, no key works until it is unlocked again.
 await result(await f.owner('/api/access/lock',{}));
 assert.equal((await result(await f.agent('/api/v1/agent/records/get',{key,data:{...place,recordId:created.id}}),401)).code,'ACCESS_LOCKED');
});

test('the owner creates scoped keys only for existing lab books, lists and revokes them',{timeout:600000},async t=>{
 const f=await agentServerFixture(t),project=await f.createProject('Software notes'),book=await f.createBook(project.projectId,'Release log');
 const created=await result(await f.owner('/api/security/agent-keys/create',{name:'Release agent',scope:{kind:'lab-book',projectId:project.projectId,labBookId:book.labBookId},access:'write'}));
 assert.match(created.key,/^obsk_/);assert.deepEqual(created.agentKey.scope,{kind:'lab-book',projectId:project.projectId,labBookId:book.labBookId});
 assert.equal((await result(await f.owner('/api/security/agent-keys/create',{name:'Nowhere',scope:{kind:'lab-book',projectId:project.projectId,labBookId:randomUUID()},access:'read'}),404)).code,'NOT_FOUND');
 assert.equal((await result(await f.owner('/api/security/agent-keys/create',{name:'Extra',scope:{kind:'workspace'},access:'read',owner:'someone'}),422)).code,'INVALID');
 const listed=await result(await f.owner('/api/security/agent-keys/list',{}));assert.deepEqual(listed.agentKeys.map(key=>key.name),['Release agent']);assert.equal(listed.agentKeys[0].sha256,undefined);
 assert.equal((await result(await f.agent('/api/v1/agent/me',{key:created.key}))).name,'Release agent');
 // Agent keys cannot manage keys: these routes need the owner's own session.
 assert.equal((await result(await f.agent('/api/security/agent-keys/list',{key:created.key,data:{}}),403)).code,'ORIGIN');
 await result(await f.owner('/api/security/agent-keys/revoke',{id:created.agentKey.id}));
 assert.equal((await result(await f.agent('/api/v1/agent/me',{key:created.key}),401)).code,'AGENT_KEY_INVALID');
});

test('closing the app withdraws its agent address',{timeout:600000},async t=>{
 const f=await agentServerFixture(t),keys=new AgentKeyStore(f.device.file+'.agents');
 assert.equal((await keys.endpoint()).origin,f.app.origin);await f.app.close();assert.equal(await keys.endpoint(),null);
});

test('agents attach files from a folder on this computer through the checked intake',{timeout:600000},async t=>{
 const f=await agentServerFixture(t),{create}=await keys(f),project=await f.createProject('Software notes'),book=await f.createBook(project.projectId,'Release log');
 const key=await create({kind:'workspace'}),place={projectId:project.projectId,labBookId:book.labBookId};
 const {mkdir,writeFile}=await import('node:fs/promises'),pathModule=(await import('node:path')).default,source=pathModule.join(f.directory,'build-output');
 await mkdir(pathModule.join(source,'logs'),{recursive:true});await writeFile(pathModule.join(source,'report.txt'),'All 412 tests passed.\n');await writeFile(pathModule.join(source,'logs','build.log'),'Built in 3.2 s\n');
 const record=await result(await f.agent('/api/v1/agent/records/create',{key,data:{...place,record:{type:'run',title:'Build 1.2.0'}}}));
 const read=await result(await f.agent('/api/v1/agent/records/get',{key,data:{...place,recordId:record.id}}));
 const readOnly=await create({kind:'workspace'},'read');
 assert.equal((await result(await f.agent('/api/v1/agent/files/attach',{key:readOnly,data:{...place,recordId:record.id,expectedRevision:read.revision,source,paths:['report.txt'],title:'Refused'}}),403)).code,'AGENT_KEY_SCOPE');
 const attached=await result(await f.agent('/api/v1/agent/files/attach',{key,data:{...place,recordId:record.id,expectedRevision:read.revision,source,paths:['report.txt','logs/build.log'],title:'Build output',tool:'ci',toolVersion:'1',sourceRevision:'abc123'}}));
 assert.equal(attached.id,record.id);assert.match(attached.pin,/^[a-f0-9]{64}$/);
 const wait=async states=>{for(let i=0;i<300;i++){const value=await result(await f.agent('/api/v1/agent/files/status',{key,data:{...place,recordId:record.id,proposalId:attached.proposalId}}));if(states.includes(value.state))return value;await new Promise(resolve=>setTimeout(resolve,200));}throw Error('The attachment did not reach '+states.join(' or '));};
 const prepared=await wait(['prepared']);assert.deepEqual(prepared.files.map(file=>file.path).sort(),['logs/build.log','report.txt']);assert.equal(prepared.completed,false);
 assert.equal((await result(await f.agent('/api/v1/agent/files/apply',{key,data:{...place,recordId:record.id,proposalId:attached.proposalId,pin:'0'.repeat(64)}}),422)).code,'INTAKE_CHANGED');
 await result(await f.agent('/api/v1/agent/files/apply',{key,data:{...place,recordId:record.id,proposalId:attached.proposalId,pin:attached.pin}}));
 const done=await wait(['completed']);assert.equal(done.completed,true);
 const changes=(await result(await f.owner('/api/security/agent-keys/activity',{}))).activity;
 assert.deepEqual(changes.slice(0,2).map(entry=>[entry.operation,entry.title]),[['files/attach','Build 1.2.0'],['records/create','Build 1.2.0']]);
});
