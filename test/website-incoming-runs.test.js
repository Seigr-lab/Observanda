import {test} from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {runFixture} from './run-fixture.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {testServer} from './device-fixture.js';
import {executeResearchRequest} from '../src/research-requests.js';
import {PublicationConversion} from '../src/publication-conversion.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {clearVault} from '../src/encryption.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';

test('an experiment placed on a website lists its shared runs and is flagged when they change',async t=>{
 const {book,parent,runs}=runFixture(3,0);
 runs[0].share=true;runs[1].share=true;runs[2].share=false;
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-incoming-runs-'));
 const f=await encryptedFixture(directory,book),store=new WebsiteFileStore(f.workspace),conversion=new PublicationConversion(f.workspace,{store});
 let app=null;
 t.after(async()=>{await app?.close();await closeIdleMutationFiles();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const command=(name,data)=>executeResearchRequest(f.workspace,'/api/research/records/'+name,data,{publicationConversion:conversion});
 const share=async recordId=>{const identity={workspaceId:book.id,recordId},base=await command('values/read',{...identity,field:'share'});await command('values/save',{...identity,field:'share',expectedRevision:base.revision,value:{value:true}});};
 await share(parent.id);
 const notebook=book.notebooks.find(item=>item.id===parent.notebookId),sourceId=websiteSourceId({workspaceId:book.id,recordId:parent.id,projectId:notebook.projectId,notebookId:notebook.id});
 const created=await store.create({name:'Field notes'}),siteId=created.site.id,placed=await store.insertSource(siteId,{expectedRevision:created.site.revision,sourceId});

 // The copy lists the shared runs, which link to the experiment, and never the private one.
 const listed=html=>runs.filter(run=>html.includes(run.title)).map(run=>run.title);
 const first=await store.open(siteId);
 assert.match(first.html,/Runs and takes/);
 assert.deepEqual(listed(first.html),[runs[0].title,runs[1].title]);

 app=await testServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});
 const cookie=session.headers.get('x-observanda-session').split(';')[0],headers={Origin:app.origin,'X-Observanda-Session':cookie,'Content-Type':'application/json'};
 const context=(await (await fetch(app.origin+'/api/storage',{headers})).json()).contextId;
 const post=(route,data)=>fetch(app.origin+route,{method:'POST',headers:{...headers,'X-Observanda-Workspace':context},body:JSON.stringify(data)});
 const check=async revision=>{const response=await post('/api/website-record-updates/check',{siteId,expectedRevision:revision}),value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};

 // Unchanged runs: nothing to update.
 assert.equal((await check(placed.site.revision)).total,0);

 // Sharing another run changes what the copy should list, though the experiment itself was not saved.
 await share(runs[2].id);
 assert.deepEqual(listed((await store.open(siteId)).html),[runs[0].title,runs[1].title]);
 const changed=await check(placed.site.revision);
 assert.equal(changed.total,1);assert.deepEqual(changed.items.map(item=>({sourceId:item.sourceId,recordId:item.recordId})),[{sourceId,recordId:parent.id}]);

 const applied=await post('/api/website-record-updates/apply',{siteId,expectedRevision:placed.site.revision,sourceIds:[sourceId]}),result=await applied.json();
 assert.equal(applied.status,200,JSON.stringify(result));assert.equal(result.updated,1);
 assert.deepEqual(listed((await store.open(siteId)).html),runs.map(run=>run.title));
 assert.equal((await check(result.revision)).total,0);
});
