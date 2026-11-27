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
 for(const name of ['me','projects/list','lab-books/list','lab-books/create','records/list','records/get','records/create','records/update'])assert.ok(description.paths['/api/v1/agent/'+name],name);
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
 // Text reads back in the Markdown it was written in, so an agent can check and resend it.
 assert.equal(read.text,'# Changes\n\nFixed **two** bugs in `parser`.\n\n- faster start\n- smaller files');assert.deepEqual(read.sections.map(section=>[section.title,section.text]),[['Known issues','None yet.']]);
 const stored=(await result(await f.owner('/api/projects/'+project.projectId+'/lab-books/'+book.labBookId+'/workspace/read/selection',{workspaceId:(await result(await f.owner('/api/projects/'+project.projectId+'/lab-books/'+book.labBookId+'/workspace/read/start',{}))).metadata.id,ids:[created.id]}))).book.entries[0];
 assert.equal(validRichText(stored.body),true);assert.equal(stored.body.content[0].type,'heading');
 const listed=await result(await f.agent('/api/v1/agent/records/list',{key,data:{...place,search:'Release'}}));assert.deepEqual(listed.records.map(item=>item.id),[created.id]);assert.deepEqual({title:listed.records[0].title,type:listed.records[0].type,status:listed.records[0].status},{title:'Release 1.2',type:'note',status:'completed'});assert.equal(listed.total,1);
 const updated=await result(await f.agent('/api/v1/agent/records/update',{key,data:{...place,recordId:created.id,expectedRevision:read.revision,changes:{status:'in progress',sections:[{id:read.sections[0].id,title:'Known issues',text:'One: slow export.'}]}}}));
 assert.notEqual(updated.revision,read.revision);
 assert.deepEqual(wholeReads,[]);ResearchCatalogue.prototype.read=wholeRead;
 // The owner opening the website editor keeps the workspace unlocked; agents keep working.
 await result(await f.owner('/api/website-files/session',{}));
 assert.equal((await result(await f.agent('/api/v1/agent/records/get',{key,data:{...place,recordId:created.id}}))).id,created.id);
 const again=await result(await f.agent('/api/v1/agent/records/get',{key,data:{...place,recordId:created.id}}));assert.equal(again.status,'in progress');assert.equal(again.sections[0].id,read.sections[0].id);assert.equal(again.sections[0].text,'One: slow export.');
 assert.equal((await result(await f.agent('/api/v1/agent/records/update',{key,data:{...place,recordId:created.id,expectedRevision:read.revision,changes:{title:'Stale'}}}),409)).code,'RECORD_CHANGED');
 // The owner sees each agent change under the key's name, newest first.
 const changes=(await result(await f.owner('/api/security/agent-keys/activity',{}))).activity;
 assert.deepEqual(changes.map(entry=>[entry.operation,entry.recordId,entry.title,entry.keyName]),[['records/update',created.id,'Release 1.2',me.name],['records/create',created.id,'Release 1.2',me.name]]);
 // An agent creates a lab book without any password; it opens like the rest of the workspace.
 const added=await result(await f.agent('/api/v1/agent/lab-books/create',{key,data:{projectId:project.projectId,title:'Manager notes'}}));
 assert.equal(added.title,'Manager notes');
 assert.deepEqual((await result(await f.agent('/api/v1/agent/lab-books/list',{key,data:{projectId:project.projectId}}))).labBooks.map(item=>item.title).sort(),['Design notes','Manager notes','Release log']);
 const first=await result(await f.agent('/api/v1/agent/records/create',{key,data:{projectId:project.projectId,labBookId:added.labBookId,record:{type:'note',title:'First entry'}}}));
 assert.equal((await result(await f.agent('/api/v1/agent/records/get',{key,data:{projectId:project.projectId,labBookId:added.labBookId,recordId:first.id}}))).title,'First entry');
 // A lab book name is unique in its project; a key for one lab book cannot add lab books.
 assert.equal((await result(await f.agent('/api/v1/agent/lab-books/create',{key,data:{projectId:project.projectId,title:'Manager notes'}}),409)).code,'EXISTS');
 assert.equal((await result(await f.agent('/api/v1/agent/lab-books/create',{key:await create({kind:'lab-book',projectId:project.projectId,labBookId:book.labBookId}),data:{projectId:project.projectId,title:'Elsewhere'}}),403)).code,'AGENT_KEY_SCOPE');
 assert.deepEqual((await result(await f.owner('/api/security/agent-keys/activity',{}))).activity.slice(0,2).map(entry=>[entry.operation,entry.labBookId,entry.title]),[['records/create',added.labBookId,'First entry'],['lab-books/create',added.labBookId,'Manager notes']]);
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

test('agents run the app\'s own commands within their key: lab book data, websites and PDFs, never security',{timeout:600000},async t=>{
 const f=await agentServerFixture(t),{create}=await keys(f),project=await f.createProject('Software notes'),book=await f.createBook(project.projectId,'Release log'),other=await f.createBook(project.projectId,'Design notes');
 const key=await create({kind:'workspace'}),place={projectId:project.projectId,labBookId:book.labBookId},workspaceIdOf=(await result(await f.owner('/api/workspace/read/start',{}))).metadata.id;
 const app=(command,options)=>f.agent('/api/v1/agent/app/'+command,options);
 // The installed app describes these commands to agents.
 const description=await result(await f.agent('/api/v1/openapi.json'));
 assert.ok(description.paths['/api/v1/agent/app/{command}'].post);assert.ok(description.paths['/api/v1/agent/app/{command}'].get);
 // A record made available for publication through the same command as the app's own control.
 const record=await result(await f.agent('/api/v1/agent/records/create',{key,data:{...place,record:{type:'experiment',title:'Coil test'}}}));
 const prefix='projects/'+project.projectId+'/lab-books/'+book.labBookId;
 const workspaceId=(await result(await app(prefix+'/workspace/read/start',{key,data:{}}))).metadata.id,identity={workspaceId,recordId:record.id,field:'share'};
 const before=await result(await app(prefix+'/research/records/values/read',{key,data:identity}));assert.equal(before.value.value,false);
 await result(await app(prefix+'/research/records/values/save',{key,data:{...identity,expectedRevision:before.revision,value:{value:true}}}));
 assert.equal((await result(await app(prefix+'/research/records/values/read',{key,data:identity}))).value.value,true);
 // The workspace's own lab book is reached with workspace keys only.
 const root=await result(await app('workspace/read/start',{key,data:{}}));assert.equal(root.metadata.id,workspaceIdOf);
 assert.equal((await result(await app('notebook',{key}))).book.id,workspaceIdOf);
 assert.equal((await result(await app('workspace/read/start',{key:await create({kind:'project',projectId:project.projectId}),data:{}}),403)).code,'AGENT_KEY_SCOPE');
 // Websites: the same editor commands, for workspace keys.
 const site=await result(await app('website-files/create',{key,data:{name:'Lab site',html:'<!doctype html><html><head><title>Lab</title></head><body><main><p>Hello</p></main></body></html>'}}));
 const sites=(await result(await app('website-files/list',{key,data:{}}))).items;assert.deepEqual(sites.map(item=>[item.id,item.name]),[[site.site.id,'Lab site']]);
 // The owner sees the agent's changes under its name.
 const changes=(await result(await f.owner('/api/security/agent-keys/activity',{}))).activity;
 assert.deepEqual(changes.slice(0,2).map(entry=>[entry.operation,entry.keyName]),[['app/website',changes[0].keyName],['app/research',changes[0].keyName]]);
 assert.equal(changes[1].projectId,project.projectId);assert.equal(changes[1].labBookId,book.labBookId);
 // A read key only reads; a lab book key reaches only its lab book and no websites.
 const readOnly=await create({kind:'workspace'},'read');
 assert.ok((await result(await app('website-files/list',{key:readOnly,data:{}}))).items);
 assert.equal((await result(await app('website-files/create',{key:readOnly,data:{name:'Refused',html:'<!doctype html><html><head><title>R</title></head><body></body></html>'}}),403)).code,'AGENT_KEY_SCOPE');
 assert.equal((await result(await app(prefix+'/research/records/values/save',{key:readOnly,data:{...identity,expectedRevision:before.revision,value:{value:false}}}),403)).code,'AGENT_KEY_SCOPE');
 const scoped=await create({kind:'lab-book',...place});
 assert.equal((await result(await app(prefix+'/research/records/values/read',{key:scoped,data:identity}))).value.value,true);
 assert.equal((await result(await app('projects/'+project.projectId+'/lab-books/'+other.labBookId+'/workspace/read/start',{key:scoped,data:{}}),403)).code,'AGENT_KEY_SCOPE');
 assert.equal((await result(await app('website-files/list',{key:scoped,data:{}}),403)).code,'AGENT_KEY_SCOPE');
 // Passwords, keys, preferences and storage stay with the owner.
 for(const command of [prefix+'/access/details','projects/'+project.projectId+'/access/details','security/agent-keys/list','preferences','access/lock','storage/check','workspaces'])
  assert.equal((await result(await app(command,{key,data:{}}),404)).code,'NOT_FOUND',command);
 assert.equal((await result(await app('website-files/../security/agent-keys/list',{key,data:{}}),404)).code,'NOT_FOUND');
 // Without a key, the app's commands are not reachable from a program.
 assert.equal((await result(await app('website-files/list',{data:{}}),403)).code,'ORIGIN');
});

test('agents link a run to its investigation with the app\'s workflow roles',{timeout:600000},async t=>{
 const f=await agentServerFixture(t),{create}=await keys(f),project=await f.createProject('Bench work'),book=await f.createBook(project.projectId,'Coil tests');
 const key=await create({kind:'workspace'}),place={projectId:project.projectId,labBookId:book.labBookId};
 const make=async(type,title)=>result(await f.agent('/api/v1/agent/records/create',{key,data:{...place,record:{type,title}}}));
 const first=await make('experiment','First coil'),second=await make('experiment','Second coil'),run=await make('run','Coil run 1'),method=await make('protocol','Winding method');
 const get=async id=>result(await f.agent('/api/v1/agent/records/get',{key,data:{...place,recordId:id}}));
 const link=async(recordId,linkValue,status=200)=>result(await f.agent('/api/v1/agent/records/link',{key,data:{...place,recordId,expectedRevision:(await get(recordId)).revision,link:linkValue}}),status);
 // A run belongs to one investigation: linking another replaces it.
 await link(run.id,{recordId:first.id,role:'run-of'});
 assert.deepEqual((await get(run.id)).links.map(item=>[item.role,item.type,item.recordId]),[['run-of','Run / take of',first.id]]);
 await link(run.id,{recordId:second.id,role:'run-of',type:'Run of'});
 assert.deepEqual((await get(run.id)).links.map(item=>[item.role,item.type,item.recordId]),[['run-of','Run of',second.id]]);
 // Only a run can be a run of something, and never of another run.
 assert.equal((await link(first.id,{recordId:second.id,role:'run-of'},422)).code,'INVALID');
 const other=await make('run','Coil run 2');assert.equal((await link(other.id,{recordId:run.id,role:'run-of'},422)).code,'INVALID');
 // An exact role keeps the target's saved revision; an ordinary link has no role.
 await link(run.id,{recordId:method.id,role:'uses-method'});await link(run.id,{recordId:first.id});
 const links=(await get(run.id)).links;assert.deepEqual(links.map(item=>item.role),['run-of','uses-method',null]);
 const stored=(await result(await f.owner('/api/projects/'+project.projectId+'/lab-books/'+book.labBookId+'/workspace/read/selection',{workspaceId:(await result(await f.owner('/api/projects/'+project.projectId+'/lab-books/'+book.labBookId+'/workspace/read/start',{}))).metadata.id,ids:[run.id]}))).book.entries[0];
 assert.equal(stored.relations.find(item=>item.role==='uses-method').target.revision,(await get(method.id)).revision);
});
