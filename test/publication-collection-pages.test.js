import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {indexedBook} from './publication-index-fixture.js';
import {buildPublication,verifyPublication} from '../src/publication.js';
import {PUBLIC_COLLECTION_ROWS,collectionPagePath,collectionPageFromPath} from '../src/web/public-collection-pages.js';

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

test('collection paths are canonical and cannot collide with legacy publication aliases',()=>{
 const book=indexedBook(53),target='project:'+book.projects[0].id,name=collectionPagePath(target,1);
 const config={version:1,pages:[{id:randomUUID(),path:name,title:'Earlier collection',anchors:[{id:randomUUID(),fragment:'old',label:'Old reading',target:{workspaceId:book.id,kind:'record',id:book.entries[0].id}}]}]};
 for(const path of [name.replace('-records-1','-records-0'),name.replace('-records-1','-records-01'),name.replace('-records-1','-records-9007199254740992'),'entries/'+book.entries[0].id+'-records-1.html',name+'/../private'])assert.equal(collectionPageFromPath(path),null);
 assert.throws(()=>collectionPagePath(target,-1));assert.throws(()=>collectionPagePath('entry:'+book.entries[0].id,0));
});

