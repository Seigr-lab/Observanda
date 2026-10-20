import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {publicationSourceClient} from '../src/web/publication-source-client.js';
const id=()=>randomUUID();
const setup=()=>({page:'website',book:{id:id(),website:{title:'Host site'}},etag:'a'.repeat(64),storage:{contextId:'host'},access:{locked:false}});
const owner=()=>({workspaceId:id(),projectId:id(),labBookId:null});
const head=(source,snapshotId='b'.repeat(64))=>({owner:source,value:{workspaceId:source.workspaceId,snapshotId,title:'Source',projects:[{id:source.projectId,title:'Project',parentId:null,share:false}],notebooks:[]}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('selected source queries retain their namespace and snapshot without adopting source research',async()=>{
 const state=setup(),source=owner(),calls=[],saved=structuredClone(state.book);let authorizations=0;
 const client=publicationSourceClient({state,access:async run=>{authorizations++;return run();},api:async(route,body,options)=>{
  calls.push({route,body,options});return body.operation==='head'?head(source):{owner:source,value:{workspaceId:source.workspaceId,snapshotId:'b'.repeat(64),items:[]}};
 }});
 await client.open(source,{unlock:true});await client.query('content',{projectId:source.projectId,search:'',cursor:null,workspaceId:id(),snapshotId:'f'.repeat(64)});
 assert.equal(authorizations,1);assert.deepEqual(state.book,saved);assert.equal(calls[1].body.workspaceId,state.book.id);assert.equal(calls[1].body.query.workspaceId,source.workspaceId);assert.equal(calls[1].body.query.snapshotId,'b'.repeat(64));assert.equal(calls[1].options.adopt,false);
 const current=client.current();current.head.title='Mutated client copy';assert.equal(client.current().head.title,'Source');
});

test('switching source cancels obsolete requests even when the transport ignores cancellation',async()=>{
 const state=setup(),a=owner(),b=owner(),pending=deferred(),signals=[];
 const client=publicationSourceClient({state,api:async(_route,body,{signal})=>{signals.push(signal);if(body.sourceId===a.workspaceId)return pending.promise;return head(b);}});
 const first=client.open(a),rejected=assert.rejects(first,{name:'AbortError'});await client.open(b);assert.equal(signals[0].aborted,true);pending.resolve(head(a));await rejected;assert.equal(client.current().owner.workspaceId,b.workspaceId);
});

test('leaving the editor, locking, switching websites or changing the host snapshot rejects late source data',async()=>{
 for(const change of [state=>state.page='module',state=>state.access.locked=true,state=>state.websiteId=id(),state=>state.etag='c'.repeat(64),state=>state.projectOwner={projectId:id()},state=>state.storageUnavailable=true]){
  const state=setup(),source=owner(),pending=deferred();let signal;
  const client=publicationSourceClient({state,api:async(_route,body,options)=>{signal=options.signal;return body.operation==='head'?head(source):pending.promise;}});
  await client.open(source);const query=client.query('content',{projectId:source.projectId,search:'',cursor:null}),rejected=assert.rejects(query,{name:'AbortError'});
  change(state);client.sync();assert.equal(signal.aborted,true);pending.resolve({owner:source,value:{workspaceId:source.workspaceId,snapshotId:'b'.repeat(64)}});await rejected;assert.equal(client.current(),null);
 }
});

test('source routes retain the website host and reject copied IDs from a different owner',async()=>{
 const state=setup(),source=owner(),other={...source,workspaceId:id()},calls=[];state.projectOwner={projectId:id(),labBookId:id()};
 const client=publicationSourceClient({state,api:async(route)=>{calls.push(route);return head(other);}});
 await assert.rejects(client.open(source),/PUBLICATION_SOURCE_RESPONSE/);assert.equal(client.current(),null);
 assert.equal(calls[0],'/api/projects/'+state.projectOwner.projectId+'/lab-books/'+state.projectOwner.labBookId+'/publication-source');
});

test('registry pages are bounded and cannot substitute another host or project',async()=>{
 const state=setup(),source=owner(),item={...source,kind:'project',label:'Source',ancestors:[]},valid={workspaceId:state.book.id,projectId:null,revision:'d'.repeat(64),offset:0,total:1,items:[item]};let response=valid,calls=0;
 const client=publicationSourceClient({state,api:async()=>{calls++;return structuredClone(response);}});
 assert.deepEqual((await client.directory()).items,[item]);assert.equal(client.current(),null);
 for(const bad of [{...valid,workspaceId:id()},{...valid,projectId:id()},{...valid,total:2},{...valid,items:[{...item,labBookId:id()}]},{...valid,total:2,items:[item,item]}]){response=bad;await assert.rejects(client.directory(),/PUBLICATION_SOURCE_RESPONSE/);}
 assert.equal(calls,6);
});

test('an unlock retry cannot outlive the source or editor that requested it',async()=>{
 const state=setup(),source=owner(),permission=deferred();let calls=0;
 const client=publicationSourceClient({state,access:async run=>{await permission.promise;return run();},api:async()=>{calls++;return head(source);}});
 const opening=client.open(source,{unlock:true}),rejected=assert.rejects(opening,{name:'AbortError'});client.close();permission.resolve();await rejected;assert.equal(calls,0);
});

test('canvas metadata reads pin their original snapshot and reject a substituted head',async()=>{
 const state=setup(),source=owner(),snapshotId='c'.repeat(64),calls=[];let substitute=false;
 const client=publicationSourceClient({state,api:async(_route,body)=>{calls.push(body);return head(source,substitute?'d'.repeat(64):snapshotId);}});
 await client.open(source,{snapshotId});assert.equal(calls[0].query.snapshotId,snapshotId);assert.equal(client.current().head.snapshotId,snapshotId);
 substitute=true;await assert.rejects(client.open(source,{snapshotId}),/PUBLICATION_SOURCE_RESPONSE/);assert.equal(client.current(),null);
});

test('source heads retain optional lab-book publication permissions and reject nonboolean values',async()=>{
 const state=setup(),source=owner(),response=head(source);response.value.notebooks=[{id:id(),projectId:source.projectId,title:'Restricted research',share:false}];
 const client=publicationSourceClient({state,api:async()=>structuredClone(response)});
 assert.equal((await client.open(source)).head.notebooks[0].share,false);assert.equal(client.current().head.notebooks[0].share,false);
 response.value.notebooks[0].share='false';await assert.rejects(client.open(source),/PUBLICATION_SOURCE_RESPONSE/);assert.equal(client.current(),null);
 delete response.value.notebooks[0].share;assert.equal(Object.hasOwn((await client.open(source)).head.notebooks[0],'share'),false);
});
