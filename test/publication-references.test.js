import {test} from 'node:test';
import assert from 'node:assert/strict';
import {referenceBook} from './publication-reference-fixture.js';
import {buildPublication,verifyPublication} from '../src/publication.js';

test('published references continue completely with their record and composition, without requiring scripts',()=>{
 for(const count of [53,157]){
  const book=referenceBook(count),target=book.entries[0];book.entries.at(-1).share=false;
  const output=buildPublication(book);verifyPublication(output);let file='entries/'+target.id+'.html',seen=[],pages=0;
  for(;;){
   const html=output.files.get(file),part=/<div id="record-references">([\s\S]*?)<\/nav><\/div>/.exec(html)?.[1];assert.ok(part,file);
   const ids=[...part.matchAll(/href="\.\.\/entries\/([a-f0-9-]+)\.html"/g)].map(m=>m[1]);assert.ok(ids.length<=24);seen.push(...ids);pages++;
   assert.ok(html.includes(target.body));assert.ok(html.includes(book.website.footer));assert.ok(html.includes('data-page="entry:'+target.id+'"'));assert.ok(!html.includes(book.entries.at(-1).title));
   const next=/rel="next" href="([^"]+)"/.exec(part)?.[1];if(!next)break;file='entries/'+next.split('#')[0];
  }
  assert.equal(pages,Math.ceil((count-1)/24));assert.equal(new Set(seen).size,count-1);assert.deepEqual([...seen].sort(),book.entries.slice(1,-1).map(r=>r.id).sort());
  assert.equal(output.pages.filter(p=>p.path.includes('references-')).length,0);
 }
});
