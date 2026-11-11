import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {Workspace} from '../src/storage.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {saveWebsiteFeed} from '../src/website-dynamic-feeds.js';
import {readableDay} from '../src/website-record-language.js';

test('a card list shows the date, type and excerpt chosen for it, in the page language',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'website-feed-cards-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{
  await closeIdleMutationFiles();if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('website-feed-cards-'))throw Error('Unexpected fixture');
  await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:150});
 });
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),store=new WebsiteFileStore(workspace);
 const notebookId=randomUUID(),recordId=randomUUID(),provenance={workspaceId:workspace.vault.id,notebookId,recordId},sourceId=websiteSourceId(provenance);
 const html='<section data-observanda-part="title"><h2>Hive 4 inspection</h2></section><article class="record-page"><div class="entry-meta" data-observanda-part="metadata"><span>observation</span><time datetime="2026-05-02">2026-05-02</time><span>completed</span></div><div data-observanda-part="body"><p>Brood frames inspected after the spring flow.</p></div></article>';
 await store.putSource({sourceId,provenance,title:'Hive 4 inspection',html},{token:await store.beginSourceUpdate({sourceId,target:'website',provenance})});
 const start=await store.create({name:'Apiari',language:'ca'}),site=start.site.id;
 await assert.rejects(saveWebsiteFeed(store,site,{expectedRevision:start.site.revision,path:'index.html',heading:'Entrades',template:'full',cardFields:['date']}),{code:'INVALID'});
 await assert.rejects(saveWebsiteFeed(store,site,{expectedRevision:start.site.revision,path:'index.html',heading:'Entrades',template:'card',cardFields:['cover']}),{code:'INVALID'});
 const plain=await saveWebsiteFeed(store,site,{expectedRevision:start.site.revision,path:'index.html',heading:'Entrades',template:'card'});
 assert.match(plain.html,/<h3>Hive 4 inspection<\/h3><\/article>/);
 const cards=await saveWebsiteFeed(store,site,{expectedRevision:plain.site.revision,path:'index.html',heading:'Entrades',template:'card',cardFields:['excerpt','date','type']});
 assert.match(cards.html,new RegExp('<p class="website-feed-card-meta"><span data-feed-field="type" data-observanda-value="observation">Observació</span> <span data-feed-field="date" data-observanda-value="2026-05-02">'+readableDay('2026-05-02','ca')+'</span></p>'));
 assert.match(cards.html,/<p class="website-feed-card-excerpt">[^<]*Brood frames inspected after the spring flow\.[^<]*<\/p>/);
 const feed=(await store.scope(()=>store.raw(site))).feeds.at(-1);assert.deepEqual(feed.cardFields,['date','type','excerpt']);
});
