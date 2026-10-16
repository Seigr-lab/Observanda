import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {indexedBook} from './publication-index-fixture.js';
import {buildPublication,verifyPublication} from '../src/publication.js';
import {PUBLIC_COLLECTION_ROWS,collectionPagePath,collectionPageFromPath} from '../src/web/public-collection-pages.js';
import {createRegion,assignRegion} from '../src/web/website-regions.js';
import {defaultFeed} from '../src/web/website-feed-model.js';
import {projectPublicationLinks} from '../src/publication-links.js';
import {selectedContent} from '../src/web/website-model.js';
import {defaultPageLayout} from '../src/web/website-layouts.js';

const recordIds=html=>[...html.matchAll(/data-record-id="([^"]+)"/g)].map(m=>m[1]);
test('default project and lab-book collections retain every selected record through bounded static pages',()=>{
 const book=indexedBook(),output=buildPublication(book);verifyPublication(output);
 for(const target of ['project:'+book.projects[0].id,'notebook:'+book.notebooks[0].id]){
  const ids=[];
  for(let index=0;index<Math.ceil(601/PUBLIC_COLLECTION_ROWS);index++){
   const name=collectionPagePath(target,index),html=output.files.get(name);assert.ok(html,name);
   const rows=recordIds(html);assert.equal(rows.length,Math.min(PUBLIC_COLLECTION_ROWS,601-index*PUBLIC_COLLECTION_ROWS));ids.push(...rows);
   assert.ok(!html.includes('PRIVATE_RECORD_SENTINEL'));assert.match(html,/data-collection-next/);assert.ok(html.includes('data-page="'+target+'"'));
   assert.deepEqual(collectionPageFromPath(name),{target,page:index});
  }
  assert.equal(new Set(ids).size,601);assert.deepEqual(new Set(ids),new Set(book.entries.filter(r=>r.share).map(r=>r.id)));
  assert.equal(output.pages.filter(p=>collectionPageFromPath(p.path)?.target===target).length,1);
 }
});

test('collection continuation uses the owning layout and independent footer-feed identities',()=>{
 const book=indexedBook(53),target='notebook:'+book.notebooks[0].id,footer=createRegion(book.website,'footer','Footer readings',{makeId:randomUUID});assignRegion(book.website,'*','footer',footer.id);
 footer.sections=[{id:'reading-feed',kind:'records',title:'Featured readings',show:true,layout:'inherit',filter:{projectId:null,tag:'',limit:2},feed:{...defaultFeed('records'),pageSize:1}}];
 const output=buildPublication(book);verifyPublication(output);const feeds=[];
 for(let page=0;page<3;page++){
  const html=output.files.get(collectionPagePath(target,page)),id=/data-public-feed="([a-f0-9]+)"/.exec(html)[1];feeds.push(id);
  const fallback=output.files.get('notebooks/feed-'+id+'-1.html');assert.ok(fallback);
  const main=html.match(/<main[^>]*>([\s\S]*?)<\/main>/)[1],continued=fallback.match(/<main[^>]*>([\s\S]*?)<\/main>/)[1];assert.equal(main,continued);
 }
 assert.equal(new Set(feeds).size,3);
});

test('collection paths are canonical and cannot collide with legacy publication aliases',()=>{
 const book=indexedBook(53),target='project:'+book.projects[0].id,name=collectionPagePath(target,1);
 const config={version:1,pages:[{id:randomUUID(),path:name,title:'Earlier collection',anchors:[{id:randomUUID(),fragment:'old',label:'Old reading',target:{workspaceId:book.id,kind:'record',id:book.entries[0].id}}]}]};
 assert.throws(()=>projectPublicationLinks(book.id,selectedContent(book),config),{code:'PUBLICATION_LINKS'});
 for(const path of [name.replace('-records-1','-records-0'),name.replace('-records-1','-records-01'),name.replace('-records-1','-records-9007199254740992'),'entries/'+book.entries[0].id+'-records-1.html',name+'/../private'])assert.equal(collectionPageFromPath(path),null);
 assert.throws(()=>collectionPagePath(target,-1));assert.throws(()=>collectionPagePath('entry:'+book.entries[0].id,0));
});

test('independent books keep their own collections and replacement layouts do not acquire default record pages',()=>{
 const book=indexedBook(53),first=book.notebooks[0],second={...structuredClone(first),id:randomUUID(),title:'Another lab book'};book.notebooks.push(second);
 const other=Array.from({length:3},(_,i)=>({...structuredClone(book.entries[i]),id:randomUUID(),notebookId:second.id,title:'Other record '+i}));book.entries.push(...other);
 let output=buildPublication(book);verifyPublication(output);
 assert.deepEqual(new Set(recordIds(output.files.get(collectionPagePath('notebook:'+second.id,0)))),new Set(other.map(r=>r.id)));
 for(let page=0;page<3;page++)assert.ok(recordIds(output.files.get(collectionPagePath('notebook:'+first.id,page))).every(id=>!other.some(r=>r.id===id)));
 assert.equal(recordIds(output.files.get(collectionPagePath('project:'+first.projectId,2))).length,8);
 book.website.layouts.push({...defaultPageLayout('notebook:'+first.id),placement:'replace',sections:[{id:'custom-heading',kind:'heading',title:'A custom landing page',level:2,show:true}]});
 output=buildPublication(book);verifyPublication(output);assert.ok(!output.files.has(collectionPagePath('notebook:'+first.id,1)));assert.equal(recordIds(output.files.get(collectionPagePath('notebook:'+first.id,0))).length,0);assert.match(output.files.get(collectionPagePath('notebook:'+first.id,0)),/A custom landing page/);
});
