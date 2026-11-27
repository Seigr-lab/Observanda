import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {agentServerFixture,result} from './agent-server-fixture.js';
import {AgentKeyStore} from '../src/security/agent-keys.js';
import {AGENT_APP_GUIDE} from '../src/agent-app-guide.js';

// A "{name}" string takes the earlier value as it is; "{name}" inside text is replaced.
function fill(value,values){
 const known=name=>{assert.ok(Object.hasOwn(values,name),'No earlier step gives '+name+'.');return values[name];};
 if(typeof value==='string'){const whole=/^\{([A-Za-z]+)\}$/.exec(value);return whole?known(whole[1]):value.replace(/\{([A-Za-z]+)\}/g,(_,name)=>known(name));}
 if(Array.isArray(value))return value.map(item=>fill(item,values));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,fill(item,values)]));
 return value;
}

test('every command in the published agent guide works as documented, in order, against the app',{timeout:600000},async t=>{
 const f=await agentServerFixture(t),store=new AgentKeyStore(f.device.file+'.agents');
 const workspaceId=(await result(await f.owner('/api/workspace/read/start',{}))).metadata.id;
 const key=(await store.create({name:'Guide agent',workspaceId,scope:{kind:'workspace'},access:'write'})).key;
 const app=(command,options)=>f.agent('/api/v1/agent/app/'+command,options);
 assert.equal(new Set(AGENT_APP_GUIDE.map(step=>step.id)).size,AGENT_APP_GUIDE.length);
 // The installed app publishes the guide with the command it explains.
 const description=await result(await f.agent('/api/v1/openapi.json')),operations=description.paths['/api/v1/agent/app/{command}'];
 // The whole guide is at the top of the description; each method carries its own steps, and none an empty list.
 assert.deepEqual(description.info['x-observanda-guide'].map(step=>step.id),AGENT_APP_GUIDE.map(step=>step.id));assert.match(description.info.description,/x-observanda-guide/);
 for(const method of ['GET','POST']){
  const steps=AGENT_APP_GUIDE.filter(step=>step.method===method),published=operations[method.toLowerCase()]['x-observanda-guide'];
  if(steps.length){assert.deepEqual(published.map(step=>step.id),steps.map(step=>step.id));assert.match(operations[method.toLowerCase()].description,/x-observanda-guide lists the main commands/);}
  else{assert.equal(published,undefined);assert.match(operations[method.toLowerCase()].description,/at the top of this description/);}
 }
 for(const step of AGENT_APP_GUIDE)assert.ok(Object.values(operations).some(operation=>(operation['x-observanda-guide']??[]).some(item=>item.id===step.id&&item.command===step.command)),step.id);
 const project=await f.createProject('Field trials'),book=await f.createBook(project.projectId,'Coil measurements');
 const record=await result(await f.agent('/api/v1/agent/records/create',{key,data:{projectId:project.projectId,labBookId:book.labBookId,record:{type:'experiment',title:'Coil test'}}}));
 const values={projectId:project.projectId,labBookId:book.labBookId,recordId:record.id,newId:randomUUID()};
 const site=reply=>{values.siteRevision=reply.site.revision;};
 // One check per guide step: a step added to the guide without a check fails here.
 const checks={
  'lab-book-start':reply=>{assert.notEqual(reply.metadata.id,workspaceId);values.workspaceId=reply.metadata.id;},
  'record-read':reply=>{const entry=reply.book.entries.find(item=>item.id===values.recordId);assert.equal(entry.title,'Coil test');assert.deepEqual(entry.attachments,[]);assert.match(reply.recordRevisions[values.recordId],/^[a-f0-9]{64}$/);},
  'record-share-read':reply=>{assert.equal(reply.value.value,false);values.valueRevision=reply.revision;},
  'record-share-save':async()=>{
   const read=AGENT_APP_GUIDE.find(step=>step.id==='record-share-read');
   assert.equal((await result(await app(fill(read.command,values),{key,data:fill(read.body,values)}))).value.value,true);
  },
  'workspace-start':reply=>{assert.equal(reply.metadata.id,workspaceId);values.rootWorkspaceId=reply.metadata.id;},
  'website-session':reply=>{assert.deepEqual(reply.sites,[]);},
  'website-create':reply=>{assert.equal(reply.site.name,'Lab results');values.siteId=reply.site.id;site(reply);},
  'website-list':reply=>{assert.deepEqual(reply.items.map(item=>[item.id,item.name]),[[values.siteId,'Lab results']]);assert.equal(reply.items[0].revision,values.siteRevision);},
  'website-page-create':reply=>{assert.equal(reply.path,'results.html');assert.ok(reply.site.pages.some(page=>page.path==='results.html'&&page.title==='Results'&&!page.draft));site(reply);},
  'website-open':reply=>{
   assert.equal(reply.path,'results.html');assert.equal(reply.site.revision,values.siteRevision);
   values.html=reply.html.replace('</main>','<p>Measured by an agent.</p></main>');assert.notEqual(values.html,reply.html);values.css=reply.css+'\np{margin:0}';
  },
  'website-save':reply=>{assert.match(reply.html,/Measured by an agent\./);assert.match(reply.css,/p\{margin:0\}/);assert.notEqual(reply.site.revision,values.siteRevision);site(reply);},
  'website-feed-save':reply=>{assert.ok(reply.feedId);values.feedId=reply.feedId;assert.notEqual(reply.site.revision,values.siteRevision);site(reply);},
  'website-feed-read':reply=>{
   assert.equal(reply.revision,values.siteRevision);
   assert.deepEqual(reply.feeds.map(feed=>[feed.id,feed.heading,feed.template,feed.layout,feed.pageSize]),[[values.feedId,'Experiments','full','list',12]]);
   assert.deepEqual(reply.feeds[0].criteria,{recordType:'experiment',sort:'title-asc'});
  },
  'website-saved-search-save':reply=>{assert.equal(reply.id,values.newId);assert.equal(reply.name,'Experiments');assert.equal(reply.criteria.recordType,'experiment');},
  'website-saved-search-list':reply=>{assert.deepEqual(reply.items.map(item=>[item.id,item.name]),[[values.newId,'Experiments']]);assert.equal(reply.next,null);},
  'website-publish-target':reply=>{assert.equal(reply.kind,'choose');},
  'website-destination':reply=>{assert.equal(reply.configured,false);},
  'pdf-list':reply=>{assert.deepEqual(reply.items,[]);assert.equal(reply.next,null);}
 };
 const ran=[];
 for(const step of AGENT_APP_GUIDE){
  assert.ok(checks[step.id],'The guide step '+step.id+' has no check in this test.');
  const command=fill(step.command,values),body=fill(step.body,values);
  const reply=await result(await app(command,step.method==='GET'?{key}:{key,data:body??{}}),200);
  await checks[step.id](reply);ran.push(step.id);
 }
 // No check is left for a step the guide no longer has.
 assert.deepEqual(Object.keys(checks),ran);
});
