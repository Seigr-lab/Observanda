import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {WebsiteFileStore} from '../src/website-file-store.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {registerPublishingData} from '../src/web/publishing-data.js';

const providers=()=>{const map=new Map();registerPublishingData({register:value=>map.set(value.id,value)});return map;};
const page=title=>'<!doctype html><html lang="en"><head><title>'+title+'</title></head><body><main><h1>'+title+'</h1></main></body></html>';

test('dashboard cards list the websites made in the website editor and their pages',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-publishing-data-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{await closeIdleMutationFiles();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:150});});
 const store=new WebsiteFileStore(f.workspace);
 const atlasId=randomUUID(),courseId=randomUUID();await store.importFiles(atlasId,{name:'Field atlas',files:new Map([['style.css',''],['index.html',page('Field atlas')],['notes.html',page('Field notes')]])});
 await store.importFiles(courseId,{name:'Course',files:new Map([['style.css',''],['index.html',page('Course')]])});
 const calls=[],signal=new AbortController().signal;
 const api=async(route,data,options)=>{calls.push({route,data,options});return store.list(data);};
 const {website,pages}=Object.fromEntries(providers()),context={book:{id:f.vault.id},etag:'a'.repeat(64)};
 const sites=await website.load({context,api,signal});
 assert.deepEqual(calls.map(call=>[call.route,call.data,call.options.adopt,call.options.signal===signal]),[['/api/website-files/list',{limit:100},false,true]]);
 const cards=website.items(context,sites),byName=Object.fromEntries(cards.map(card=>[card.title,card]));
 assert.deepEqual(byName['Field atlas'].data,{pages:2,drafts:0});assert.deepEqual(byName.Course.data,{pages:1,drafts:0});
 assert.deepEqual(byName['Field atlas'].action,{name:'site-open',id:atlasId});
 const listed=pages.items(context,sites);
 assert.deepEqual(listed.map(item=>[item.title,item.data.site,item.data.path]).sort(),[['Course','Course','index.html'],['Field atlas','Field atlas','index.html'],['Field notes','Field atlas','notes.html']]);
 assert.ok(listed.every(item=>item.action.name==='site-open'));assert.equal(listed.find(item=>item.data.site==='Course').action.id,courseId);
});

test('dashboard website cards refuse a response that is not a website list',async()=>{
 const {website}=Object.fromEntries(providers());
 await assert.rejects(website.load({context:{book:{id:'x'},etag:'a'},api:async()=>({items:null}),signal:new AbortController().signal}));
});
