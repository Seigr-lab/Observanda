import {test} from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {testServer} from './device-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {clearVault} from '../src/encryption.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';

const column=(name,representation='text')=>({name,representation,radix:10,unit:'',missing:[{value:'',meaning:'Not acquired'}],time:{kind:'unknown',reference:'',resolution:'',uncertainty:''}});

test('publishing an editor website first reports placed results whose analysis inputs changed',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-analysis-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0];
 const f=await encryptedFixture(directory,book),m=new ResearchMaterials(f.workspace);
 let app=null;
 t.after(async()=>{await app?.close();await closeIdleMutationFiles();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 // A result statement cites an analysis of a dataset.
 const bytes=Buffer.from('Value,State\n10,correct\n12,mismatched'),upload=await m.startImport({recordId:record.id,name:'readings.csv',size:bytes.length});
 await m.appendImport(upload.id,0,[bytes]);const artifact=await m.finishImport(upload.id),columns=[column('Value','integer'),column('State')];
 const dataset=await m.dataset({recordId:record.id,title:'Run observations',artifact,columns});
 const analysis=await m.analysis({recordId:record.id,title:'Signal calculation',inputs:[dataset],tool:'Synthetic calculator',version:'1',parameters:'None',outputs:[]});
 const saved=await f.workspace.read(),entry=saved.book.entries.find(item=>item.id===record.id);
 entry.results={version:1,statements:[{id:randomUUID(),kind:'conclusion',basis:'retained',title:'Signal result',text:'One of two readings matched.',limitations:'Synthetic readings only.',source:{kind:'analysis',id:analysis.id,revision:analysis.revision}}]};
 await f.workspace.save(saved.book,saved.etag);
 // The record is placed on an editor website, which keeps its own copy.
 const store=new WebsiteFileStore(f.workspace),notebook=saved.book.notebooks.find(item=>item.id===entry.notebookId);
 const provenance={workspaceId:saved.book.id,projectId:notebook.projectId,notebookId:notebook.id,recordId:entry.id},sourceId=websiteSourceId(provenance);
 const placed=await store.putSource({sourceId,title:entry.title,html:'<p>One of two readings matched.</p>',provenance},{token:await store.beginSourceUpdate({sourceId})});
 const siteId=randomUUID(),created=await store.create({id:siteId,name:'Field results'});
 const site=await store.insertSources(siteId,{expectedRevision:created.site.revision,sources:[{sourceId,sourceRevision:placed.revision}],position:{before:0}});
 const revision=site.site?.revision??site.revision;assert.ok(revision);

 app=await testServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});
 const cookie=session.headers.get('x-observanda-session').split(';')[0],headers={Origin:app.origin,'X-Observanda-Session':cookie,'Content-Type':'application/json'};
 const context=(await (await fetch(app.origin+'/api/storage',{headers})).json()).contextId;
 const check=data=>fetch(app.origin+'/api/website-analysis/check',{method:'POST',headers:{...headers,'X-Observanda-Workspace':context},body:JSON.stringify(data)});

 assert.equal((await check({siteId})).status,422);
 assert.equal((await check({siteId,expectedRevision:'0'.repeat(64)})).status,409);
 const current=await check({siteId,expectedRevision:revision}),clean=await current.json();
 assert.equal(current.status,200,JSON.stringify(clean));
 assert.deepEqual({records:clean.records,total:clean.total,items:clean.items,truncated:clean.truncated},{records:1,total:0,items:[],truncated:false});

 // A new dataset revision leaves the cited analysis behind its input.
 await m.dataset({recordId:record.id,title:'Run observations',id:dataset.id,expectedRevision:dataset.revision,artifact,baseDataset:dataset,columnChanges:[{index:0,column:{...columns[0],unit:'count'}}]});
 const changed=await (await check({siteId,expectedRevision:revision})).json();
 assert.equal(changed.total,1);assert.equal(changed.items.length,1);
 const [item]=changed.items;
 assert.deepEqual({sourceId:item.sourceId,recordId:item.recordId,recordTitle:item.recordTitle,label:item.label,reason:item.reason,changed:item.changed},{sourceId,recordId:entry.id,recordTitle:entry.title,label:'Signal result',reason:'inputs',changed:1});
 assert.equal(item.sample[0].label,'Run observations');assert.equal(item.sample[0].revision,dataset.revision);assert.notEqual(item.sample[0].current,dataset.revision);
});
