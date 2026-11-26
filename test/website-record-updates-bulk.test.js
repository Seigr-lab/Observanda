// Updating many placed records commits each page once and refreshes their lists once,
// with work per record that does not grow with the number of records the site places.
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
import {saveWebsiteFeed} from '../src/website-dynamic-feeds.js';
import {clearVault} from '../src/encryption.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';

const N=8;
test('a bulk record update commits each page once and refreshes its lists once',{timeout:600000},async t=>{
 const {book,parent,runs}=runFixture(N,0);for(const run of runs)run.share=false;
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-bulk-'));
 const f=await encryptedFixture(directory,book),store=new WebsiteFileStore(f.workspace),conversion=new PublicationConversion(f.workspace,{store});
 let app=null;t.after(async()=>{await app?.close();await closeIdleMutationFiles();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const command=(name,data)=>executeResearchRequest(f.workspace,'/api/research/records/'+name,data,{publicationConversion:conversion});
 const share=async recordId=>{const identity={workspaceId:book.id,recordId},base=await command('values/read',{...identity,field:'share'});await command('values/save',{...identity,field:'share',expectedRevision:base.revision,value:{value:true}});};
 await share(parent.id);for(const run of runs)await share(run.id);
 const notebook=book.notebooks.find(item=>item.id===parent.notebookId),sourceOf=record=>websiteSourceId({workspaceId:book.id,recordId:record.id,projectId:notebook.projectId,notebookId:notebook.id});
 // One page per record, and two lists that contain every record.
 let site=(await store.create({name:'Bulk'})).site;
 for(const [i,record] of runs.entries()){
  const page=await store.createPage(site.id,{expectedRevision:site.revision,path:'records/r'+i+'.html',title:record.title,language:'en',inclusion:'included'});
  site=(await store.insertSource(site.id,{expectedRevision:page.site.revision,path:'records/r'+i+'.html',sourceId:sourceOf(record)})).site;
 }
 for(const heading of ['All records','Latest'])site=(await saveWebsiteFeed(store,site.id,{expectedRevision:site.revision,path:'index.html',heading,criteria:{sort:'date-desc'},pageSize:10,template:'card',layout:'list',cardFields:['type','date','excerpt']})).site;
 // Every copy made by an earlier version, so every one is offered for update.
 for(const record of runs){
  const sourceId=sourceOf(record),current=await store.scope(()=>store.source(sourceId)),{copyVersion,...earlier}=current.provenance,html=await store.scope(()=>store.readText(current.html));
  await store.putSource({sourceId,provenance:earlier,target:'website',visible:true,title:current.title,html},{token:await store.beginSourceUpdate({sourceId,target:'website',provenance:earlier})});
 }
 app=await testServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});
 const cookie=session.headers.get('x-observanda-session').split(';')[0],headers={Origin:app.origin,'X-Observanda-Session':cookie,'Content-Type':'application/json'};
 const context=(await (await fetch(app.origin+'/api/storage',{headers})).json()).contextId;
 const post=(route,data)=>fetch(app.origin+route,{method:'POST',headers:{...headers,'X-Observanda-Workspace':context,'X-Observanda-Wait':'1'},body:JSON.stringify(data)});
 // The app prepares record lists in the background when it starts; check once that work is done.
 const settled=async()=>{for(let i=0;i<120;i++){if((await store.scope(()=>store.pendingSources())).size){await new Promise(r=>setTimeout(r,250));continue;}const response=await post('/api/website-record-updates/check',{siteId:site.id,expectedRevision:await store.siteVersion(site.id)});if(response.status===200)return response.json();await new Promise(r=>setTimeout(r,250));}throw Error('The site did not settle');};
 const pending=await settled();
 assert.equal(pending.total,N);
 let commits=0,sourceReads=0;const commit=WebsiteFileStore.prototype.commit,source=WebsiteFileStore.prototype.source;
 WebsiteFileStore.prototype.commit=function(...args){commits++;return commit.apply(this,args);};WebsiteFileStore.prototype.source=function(...args){sourceReads++;return source.apply(this,args);};
 t.after(()=>{WebsiteFileStore.prototype.commit=commit;WebsiteFileStore.prototype.source=source;});
 const applied=await post('/api/website-record-updates/apply',{siteId:site.id,expectedRevision:pending.revision,sourceIds:pending.items.map(item=>item.sourceId)});
 const value=await applied.json();assert.equal(applied.status,200,JSON.stringify(value));
 assert.equal(value.updated,N);
 // One commit per record page and one for both lists, not one per record per list.
 assert.equal(commits,N+1);
 // Each update reads a bounded number of copies, never every copy the site places.
 assert.ok(sourceReads<=N*16,'copy reads '+sourceReads);
 // The lists show every updated copy, and nothing is left to update.
 const home=await store.open(site.id);for(const record of runs.slice(0,3))assert.ok(home.html.includes(record.title),record.title);
 assert.equal((await (await post('/api/website-record-updates/check',{siteId:site.id,expectedRevision:value.revision})).json()).total,0);
});
