import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateNotebook} from '../src/model.js';
import {buildPublication,verifyPublication} from '../src/publication.js';
import {defaultFeed,validFeed} from '../src/web/website-feed-model.js';
import {feedFilePath,PUBLIC_FEEDS_SCRIPT} from '../src/publication-feeds.js';
import {assertPublicFiles} from '../src/privacy.js';

export function feedBook(count=23){
 const book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Observation '+String(i).padStart(3,'0'),body:'Shared results '+i,share:true,tags:[i%3?'field':'control'],type:i%2?'run':'protocol',occurredOn:'2026-10-'+String(i%28+1).padStart(2,'0'),sections:[],figures:[],attachments:[],relations:[]}));
 book.entries.push({...structuredClone(seed),id:randomUUID(),title:'PRIVATE_RECORD',body:'PRIVATE_BODY',share:false,sections:[],figures:[],attachments:[],relations:[]});
 book.website.home.sections=[{id:'records',kind:'records',title:'Field observations',show:true,layout:'inherit',feed:{...defaultFeed('records'),visitorFilters:true,visitorOrder:true,visitorView:true}}];
 return book;
}

test('feed settings preserve selection meaning and reject malformed page sizes without a total selection ceiling',()=>{
 const book=feedBook();assert.doesNotThrow(()=>validateNotebook(book));
 book.website.home.sections[0].filter={projectId:null,tag:'',limit:100000};assert.doesNotThrow(()=>validateNotebook(book));
 for(const pageSize of [0,-1,1.2,Infinity,Number.MAX_SAFE_INTEGER+1])assert.equal(validFeed({...defaultFeed('records'),pageSize},'records'),false);
 assert.equal(validFeed({...defaultFeed('records'),order:'alphabetical'},'records'),false);
 assert.equal(validFeed(defaultFeed('pages'),'pages'),true);
 assert.deepEqual(upgradeNotebook(book).website.home.sections[0].feed,book.website.home.sections[0].feed);
});

test('static feed pages preserve ten-entry navigation, exact selection, private exclusion and the complete website shell',()=>{
 const book=feedBook(),candidate=buildPublication(book);verifyPublication(candidate);
 const pages=[...candidate.files].filter(([name])=>feedFilePath(name));assert.equal(pages.length,3);
 const ids=[];
 for(const [index,[,html]] of pages.entries()){
  const feed=/<div id="feed-[\s\S]*?<\/nav><\/div>/.exec(html)[0],rows=[...feed.matchAll(/data-feed-id="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(rows.length,index<2?10:3);ids.push(...rows);
  assert.ok(html.includes('<footer class="site-footer">'));assert.ok(html.includes('public-feeds.js'));assert.ok(!html.includes('PRIVATE_RECORD'));
 }
 assert.equal(new Set(ids).size,23);assert.deepEqual(new Set(ids),new Set(book.entries.filter(r=>r.share).map(r=>r.id)));
 assert.equal(candidate.files.get('public-feeds.js'),PUBLIC_FEEDS_SCRIPT);
 assert.throws(()=>assertPublicFiles(new Map([['public-feeds.js',PUBLIC_FEEDS_SCRIPT+'alert(1)']])),{code:'UNSAFE'});
 assert.equal(feedFilePath('feed-invalid-0.html'),false);
 const section=book.website.home.sections[0];section.feed.navigation=false;section.feed.visitorFilters=false;section.feed.visitorOrder=false;section.feed.visitorView=false;
 const first=buildPublication(book).files.get('index.html');assert.ok(!first.includes('data-feed-controls'));assert.ok(!first.includes('data-feed-next'));
});
