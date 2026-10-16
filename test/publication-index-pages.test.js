import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {indexedBook} from './publication-index-fixture.js';
import {buildPublication,verifyPublication} from '../src/publication.js';
import {PUBLIC_INDEX_ROWS,publicIndexPage} from '../src/web/public-browse-pages.js';
import {assertPublicFiles} from '../src/privacy.js';
import {projectPublicationLinks} from '../src/publication-links.js';
import {selectedContent} from '../src/web/website-model.js';
import {createRegion,assignRegion} from '../src/web/website-regions.js';
import {defaultFeed} from '../src/web/website-feed-model.js';

test('static index pages contain every selected record once with bounded markup and complete manifests',()=>{
 const book=indexedBook(),candidate=buildPublication(book);verifyPublication(candidate);
 const pages=[...candidate.files].filter(([name])=>publicIndexPage(name)!==null).sort(([a],[b])=>publicIndexPage(a)-publicIndexPage(b)),ids=[];assert.equal(pages.length,Math.ceil(601/PUBLIC_INDEX_ROWS));
 let identity;
 for(const [index,[name,html]] of pages.entries()){
  const rows=[...html.matchAll(/data-public-record="([^"]+)"/g)].map(m=>m[1]);assert.equal(rows.length,Math.min(PUBLIC_INDEX_ROWS,601-index*PUBLIC_INDEX_ROWS));ids.push(...rows);assert.ok(!html.includes('PRIVATE_RECORD_SENTINEL'));assert.ok(html.includes('data-index-next'));assert.match(html,/<footer class="site-footer">/);
  const config=JSON.parse(/data-book-static="([^"]+)"/.exec(html)[1].replaceAll('&quot;','"'));identity??=config.identity;assert.equal(config.identity,identity);assert.equal(config.page,index);assert.equal(config.total,601);assert.equal(publicIndexPage(name),index);
 }
 assert.equal(new Set(ids).size,601);assert.deepEqual(new Set(ids),new Set(book.entries.filter(r=>r.share).map(r=>r.id)));assert.equal(candidate.pages.filter(p=>publicIndexPage(p.path)!==null).length,1);
 for(const name of ['browse-0.html','browse-01.html','browse--1.html','browse-1.html/../private','browse-9007199254740992.html'])assert.equal(publicIndexPage(name),null);
 const selection=selectedContent(book),config={version:1,pages:[{id:randomUUID(),path:'browse-1.html',title:'Old index',anchors:[{id:randomUUID(),fragment:'old',label:'Old reading',target:{workspaceId:book.id,kind:'record',id:book.entries[0].id}}]}]};
 assert.throws(()=>projectPublicationLinks(book.id,selection,config),{code:'PUBLICATION_LINKS'});
});
test('earlier shipped index scripts remain admitted without admitting altered code',async()=>{
 for(const version of [1,2]){const old=await readFile(new URL('./fixtures/public-book-v'+version+'.txt',import.meta.url),'utf8');assert.doesNotThrow(()=>assertPublicFiles(new Map([['public-book.js',old]])));assert.throws(()=>assertPublicFiles(new Map([['public-book.js',old+'\nalert(1)']])) ,{code:'UNSAFE'});}
});

test('an authored footer feed keeps the owning index page through fallback navigation',()=>{
 const book=indexedBook(53),footer=createRegion(book.website,'footer','Footer readings',{makeId:randomUUID});assignRegion(book.website,'*','footer',footer.id);
 footer.sections=[{id:'reading-feed',kind:'records',title:'Featured readings',show:true,layout:'inherit',filter:{projectId:null,tag:'',limit:2},feed:{...defaultFeed('records'),pageSize:1}}];
 const output=buildPublication(book);verifyPublication(output);const feedIds=[];
 for(const name of ['browse.html','browse-1.html','browse-2.html']){
  const html=output.files.get(name),id=/data-public-feed="([a-f0-9]+)"/.exec(html)[1];feedIds.push(id);
  const continued=output.files.get('feed-'+id+'-1.html');assert.ok(continued);assert.deepEqual([...continued.matchAll(/data-public-record="([^"]+)"/g)].map(m=>m[1]),[...html.matchAll(/data-public-record="([^"]+)"/g)].map(m=>m[1]));
 }
 assert.equal(new Set(feedIds).size,3);
});
