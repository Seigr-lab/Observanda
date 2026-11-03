import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {saveWebsiteFeed,removeWebsiteFeed} from '../src/website-dynamic-feeds.js';
import {websitesUsingSource,changeWebsitePlacement} from '../src/website-file-placements.js';
import {prepareFeedUsage,finishFeedUsage,feedUsageWindow} from '../src/website-feed-usage-index.js';

const usage='.observanda/website-files/feed-usage',sites='.observanda/website-files/sites/';
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'website-feed-uses-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const store=new WebsiteFileStore(new Workspace(root,{id:randomUUID(),key:randomBytes(32)}));
 const provenance={workspaceId:store.workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()},sourceId=websiteSourceId(provenance);
 const token=await store.beginSourceUpdate({sourceId,target:'website',provenance});
 const source=await store.putSource({sourceId,title:'Observation',html:'<p>Measured.</p>',provenance},{token});
 const pin={sourceId,sourceRevision:source.revision},site=(await store.create({name:'Field atlas'})).site.id;
 const save=async(id=site)=>saveWebsiteFeed(store,id,{expectedRevision:await store.siteVersion(id),path:'index.html',heading:'Observations',template:'card'});
 const uses=()=>websitesUsingSource(store,{...pin,limit:1});
 return {store,site,pin,save,uses};
}
test('interrupted feed registration selects the published site revision and reclaims unpublished or retired nodes',async t=>{
 const {store,site,pin,save,uses}=await fixture(t),write=store.writeControl.bind(store);
 const state=()=>store.scope(()=>store.control(usage+'/head.json'));
 const nodes=()=>store.scope(()=>store.names(usage+'/nodes',{directories:false})).then(page=>page.items);
 for(const boundary of ['node','site']){
  const fault=t.mock.method(store,'writeControl',async(name,data,...rest)=>{
   if(boundary==='site'&&name===sites+site+'/head.json')throw Error('Interrupted site');
   await write(name,data,...rest);if(boundary==='node'&&name.includes(usage+'/nodes/'))throw Error('Interrupted node');
  });
  await assert.rejects(save(),/Interrupted/);fault.mock.restore();assert.equal((await state()).pending.ready,boundary==='site');
  assert.deepEqual((await uses()).items,[]);
  // A completely unrelated site's commit may recover a transaction whose
  // target is still an ordinary page without a feed.
  await store.create({name:'Independent site'});assert.equal((await state()).pending,undefined);assert.deepEqual(await nodes(),[]);
 }
 const fault=t.mock.method(store,'writeControl',async(name,data,...rest)=>{
  if(name===usage+'/head.json'&&!data.pending)throw Error('Interrupted finalization');return write(name,data,...rest);
 });
 await assert.rejects(save(),/Interrupted finalization/);fault.mock.restore();assert.equal((await uses()).items[0].total,1);
 let direct=await store.insertSource(site,{...pin,expectedRevision:await store.siteVersion(site)});
 assert.equal((await uses()).items[0].total,2);assert.deepEqual(await nodes(),[]);
 await changeWebsitePlacement(store,site,'remove',{...pin,path:'index.html',ordinal:0,expectedRevision:direct.site.revision});assert.equal((await uses()).items[0].total,1);assert.equal((await nodes()).length,1);
 direct=await store.insertSource(site,{...pin,expectedRevision:await store.siteVersion(site)});
 const feed=(await store.scope(()=>store.raw(site))).feeds[0];
 const removed=await removeWebsiteFeed(store,site,{path:'index.html',feedId:feed.id,expectedRevision:direct.site.revision});assert.equal((await uses()).items[0].total,1);
 await changeWebsitePlacement(store,site,'remove',{...pin,path:'index.html',ordinal:0,expectedRevision:removed.site.revision});assert.deepEqual((await uses()).items,[]);
});

test('a historical per-source feed row migrates without losing lookup or an independently placed copy',async t=>{
 const {store,site,pin,save,uses}=await fixture(t),saved=await save(),copied=(await store.create({name:'Direct copy'})).site;
 await store.insertSource(copied.id,{...pin,expectedRevision:copied.revision});
 const marker='.observanda/website-files/sources/'+pin.sourceId+'/placements/'+site+'.json';
 await store.scope(async()=>{
  const old={...await store.raw(site),feedPlacementsIndexed:true};delete old.revision;old.revision=createHash('sha256').update(JSON.stringify(old)).digest('hex');
  await store.writeControl(marker,{siteId:site,sourceId:pin.sourceId,feedOnly:true});
  await store.writeControl(sites+site+'/revisions/'+old.revision+'.json',old);await store.writeControl(sites+site+'/head.json',{revision:old.revision});await store.writeControl(usage+'/head.json',{version:1,root:null});
 },{write:true});
 const list=async()=>{const ids=[];let after=null;do{const r=await websitesUsingSource(store,{...pin,after,limit:1});ids.push(...r.items.map(i=>i.siteId));after=r.next;}while(after);return ids;};
 assert.deepEqual(await list(),[site,copied.id].sort());
 const next=await store.open(site);await store.save(site,{...next,html:next.html.replace('</main>','<p>Editorial.</p></main>'),expectedRevision:next.site.revision});
 assert.equal(await store.scope(()=>store.control(marker,{missing:true})),null);assert.deepEqual(await list(),[site,copied.id].sort());
 await removeWebsiteFeed(store,site,{path:'index.html',feedId:saved.feedId,expectedRevision:await store.siteVersion(site)});
 assert.equal((await uses()).items[0].siteId,copied.id);
});

test('a read-only where-used query detects a concurrent removal that reclaims its index page',async t=>{
 const {store,site,save,uses}=await fixture(t),saved=await save(),control=store.control.bind(store);
 const reached=Promise.withResolvers(),resume=Promise.withResolvers();let delayed=false;
 const wait=t.mock.method(store,'control',async(name,...args)=>{
  if(!delayed&&name.includes(usage+'/nodes/')){delayed=true;reached.resolve();await resume.promise;}
  return control(name,...args);
 });
 const reading=assert.rejects(uses(),{code:'WEBSITE_CHANGED'});await reached.promise;
 try{await removeWebsiteFeed(store,site,{path:'index.html',feedId:saved.feedId,expectedRevision:saved.site.revision});}
 finally{resume.resolve();}
 await reading;wait.mock.restore();assert.deepEqual((await uses()).items,[]);
});

test('a 1,024-member batch writes 33 ordered nodes and a one-member departure keeps unaffected branches',async t=>{
 const {store,site}=await fixture(t),prior=await store.scope(()=>store.raw(site));
 const ids=Array.from({length:1024},(_,i)=>i.toString(16).padStart(64,'0')),next=(list,revision)=>({...prior,revision,feedPlacementsIndexed:2,feeds:[{members:list.map(id=>({id}))}]});
 const before=next(ids,'1'.repeat(64)),after=next(ids.slice(1),'2'.repeat(64));
 await store.scope(async()=>{
  const apply=async(old,value)=>{
   const prepared=await prepareFeedUsage(store,old,value);await store.writeControl(sites+site+'/head.json',{revision:value.revision});await finishFeedUsage(store,prepared);return prepared.pending;
  };
  const first=await apply(prior,before);assert.equal(first.created.length,33);assert.equal(first.retired.length,0);
  const second=await apply(before,after);assert.equal(second.created.length,2);assert.equal(second.retired.length,2);
  assert.deepEqual((await feedUsageWindow(store,ids[0],null,1)).ids,[]);assert.deepEqual((await feedUsageWindow(store,ids[1],null,1)).ids,[site]);
  const files=await store.names(usage+'/nodes',{limit:100,directories:false});assert.equal(files.items.length,33);
  await store.remove(usage+'/head.json');await assert.rejects(feedUsageWindow(store,ids[1],null,1),{code:'FORMAT'});
 },{write:true});
});
