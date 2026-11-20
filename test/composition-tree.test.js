import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newElement,insertElement,moveElement,childrenOf,cloneElements,validTree} from '../src/web/composition-tree.js';
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
