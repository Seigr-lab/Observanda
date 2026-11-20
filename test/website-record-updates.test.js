import {test} from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {testServer} from './device-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {executeResearchRequest} from '../src/research-requests.js';
import {PublicationConversion} from '../src/publication-conversion.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {clearVault} from '../src/encryption.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';

test('a record edited after it was placed updates its website copy only when the author asks',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-updates-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0];record.share=false;
 const f=await encryptedFixture(directory,book),store=new WebsiteFileStore(f.workspace),conversion=new PublicationConversion(f.workspace,{store});
 let app=null;
 t.after(async()=>{await app?.close();await closeIdleMutationFiles();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const command=(name,data)=>executeResearchRequest(f.workspace,'/api/research/records/'+name,data,{publicationConversion:conversion});
 const identity={workspaceId:book.id,recordId:record.id},save=async(field,value)=>{const base=await command('values/read',{...identity,field});await command('values/save',{...identity,field,expectedRevision:base.revision,value:{value}});};
 await save('share',true);
 const notebook=book.notebooks.find(item=>item.id===record.notebookId),sourceId=websiteSourceId({...identity,projectId:notebook.projectId,notebookId:notebook.id});
 const created=await store.create({name:'Field notes'}),siteId=created.site.id,placed=await store.insertSource(siteId,{expectedRevision:created.site.revision,sourceId});
 // The author styles the page; that edit belongs to the website.
 const styled=await store.save(siteId,{path:placed.path,expectedRevision:placed.site.revision,html:placed.html,css:'p{color:teal}'});

 app=await testServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});
 const cookie=session.headers.get('x-observanda-session').split(';')[0],headers={Origin:app.origin,'X-Observanda-Session':cookie,'Content-Type':'application/json'};
 const context=(await (await fetch(app.origin+'/api/storage',{headers})).json()).contextId;
 const post=(route,data)=>fetch(app.origin+route,{method:'POST',headers:{...headers,'X-Observanda-Workspace':context},body:JSON.stringify(data)});
 const check=async revision=>{const response=await post('/api/website-record-updates/check',{siteId,expectedRevision:revision}),value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};

 assert.equal((await check(styled.site.revision)).total,0);
 assert.equal((await post('/api/website-record-updates/check',{siteId})).status,422);

 // A later lab book edit does not change the website by itself.
 await save('title','Seeds unfold overnight');
 assert.doesNotMatch((await store.open(siteId)).html,/Seeds unfold overnight/);
 const changed=await check(styled.site.revision);
 assert.equal(changed.total,1);assert.deepEqual(changed.items.map(item=>({sourceId:item.sourceId,recordId:item.recordId})),[{sourceId,recordId:record.id}]);

 assert.equal((await post('/api/website-record-updates/apply',{siteId,expectedRevision:'0'.repeat(64),sourceIds:[sourceId]})).status,409);
 const applied=await post('/api/website-record-updates/apply',{siteId,expectedRevision:styled.site.revision,sourceIds:[sourceId]}),result=await applied.json();
 assert.equal(applied.status,200,JSON.stringify(result));assert.equal(result.updated,1);assert.notEqual(result.revision,styled.site.revision);

 const current=await store.open(siteId);
 assert.match(current.html,/Seeds unfold overnight/);assert.equal(current.css,'p{color:teal}');
 assert.equal((await check(result.revision)).total,0);
 const row=await f.workspace.catalogue(async catalogue=>catalogue.member(await catalogue.snapshot(),record.id));
 assert.equal((await store.scope(()=>store.source(sourceId))).provenance.recordRevision,row.revision);
});
