import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newElement,insertElement,moveElement,childrenOf,cloneElements,validTree} from '../src/web/composition-tree.js';
import {createNotebook,upgradeNotebook,validateNotebook} from '../src/model.js';
import {buildPublication,publicProjection} from '../src/publication.js';
const node=(kind,id)=>newElement(kind,()=>id);
test('nested moves preserve IDs, content and subtree ordering, and reject cycles and missing parents',()=>{
 let elements=[node('container','row'),node('heading','title'),node('container','other')];
 elements=moveElement(elements,'title','row');elements=insertElement(elements,{...node('text','copy'),body:'Retain me'},'row');
 elements=moveElement(elements,'row','other');
 assert.equal(childrenOf(elements,'other')[0].id,'row');assert.deepEqual(childrenOf(elements,'row').map(e=>e.id),['title','copy']);
 assert.equal(elements.find(e=>e.id==='copy').body,'Retain me');
 assert.throws(()=>moveElement(elements,'other','row'));assert.throws(()=>moveElement(elements,'title','missing'));assert.ok(validTree(elements));
 const duplicate=cloneElements(elements,(()=>{let i=0;return()=>'copy'+i++;})());
 assert.ok(validTree(duplicate));assert.equal(new Set([...elements,...duplicate].map(e=>e.id)).size,8);
});
test('format 11 migrates without changing authored elements or research; older schemas reject container fields',()=>{
 const old=createNotebook('Studio','');old.formatVersion=11;delete old.website.home.enabled;delete old.website.home.introduction;old.website.home.sections=[{id:'text',kind:'text',title:'Existing text',body:'Keep this',show:true}];
 const bytes=JSON.stringify(old),next=upgradeNotebook(old);assert.equal(JSON.stringify(old),bytes);assert.deepEqual(next.website.home.sections,old.website.home.sections);assert.deepEqual(next.entries,old.entries);assert.equal(next.formatVersion,21);
 old.website.home.sections.push(node('container','row'));assert.throws(()=>validateNotebook(old));next.website.home.sections.push(node('container','row'));assert.doesNotThrow(()=>validateNotebook(next));
});
test('publication renders nested layouts once and suppresses every descendant of excluded containers',()=>{
 const book=createNotebook('Studio','');book.website.home.enabled=true;book.website.home.sections=[node('container','row'),{...node('heading','title'),parentId:'row',title:'A careful look',level:1},{...node('text','copy'),parentId:'row',body:'Research and sound.'},node('asset','image')];
 const result=buildPublication(book),html=result.files.get('index.html');
 assert.equal(html.split('data-section-id="title"').length-1,1);assert.match(html,/container-content container-row/);assert.match(html,/<h1>A careful look<\/h1>/);assert.doesNotMatch(html,/data-section-id="image"/);
 book.website.home.sections[0].show=false;
 const excluded=buildPublication(book);assert.doesNotMatch(excluded.files.get('index.html'),/A careful look|Research and sound/);
 const design=buildPublication(book,{designTarget:'home'});assert.match(design.files.get('index.html'),/data-section-id="image"/);assert.match(design.files.get('index.html'),/A careful look/);
 assert.equal(publicProjection(book).website.home.sections.length,0);
});

test('expandable sections retain nested editable content, opening state and private exclusions',()=>{
 const book=createNotebook('Research notes','');book.website.home.enabled=true;
 let elements=[{...node('disclosure','progress'),title:'Development status'},node('container','panels'),{...node('text','claim'),body:'Observation retained.'}];
 elements=moveElement(elements,'panels','progress');elements=moveElement(elements,'claim','panels');book.website.home.sections=elements;validateNotebook(book);
 assert.throws(()=>moveElement(elements,'progress','panels'));assert.ok(validTree(cloneElements(elements,(()=>{let id=0;return()=>'copy'+id++;})())));
 let html=buildPublication(book).files.get('index.html');assert.match(html,/<details class="section-disclosure-content"><summary>Development status<\/summary>/);assert.match(html,/Observation retained\./);
 elements[0].open=true;html=buildPublication(book).files.get('index.html');assert.match(html,/<details class="section-disclosure-content" open>/);
 elements[0].show=false;const projection=publicProjection(book);assert.equal(projection.website.home.sections.length,0);assert.doesNotMatch(buildPublication(book).files.get('index.html'),/Observation retained\./);
 elements[0].show=true;elements[0].open='true';assert.throws(()=>validateNotebook(book),{code:'INVALID'});
});
