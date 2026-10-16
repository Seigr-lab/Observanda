import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RecordDocument} from '../src/record-document.js';
import {RecordContainerBuilder} from '../src/record-tree-values.js';
import {filterRecordProjection} from '../src/record-projection-filter.js';
import {digest,serialize} from '../src/storage-format.js';
const ordinal=value=>String(value).padStart(16,'0');
function memory(){const nodes=new Map();return {nodes,reads:0,writes:0,async put(kind,value){const raw=serialize(value),revision=digest(raw);assert.ok(Buffer.byteLength(raw)<=65536);nodes.set(kind+':'+revision,raw);this.writes++;return revision;},async read(kind,revision){this.reads++;const raw=nodes.get(kind+':'+revision);assert.equal(digest(raw),revision);return JSON.parse(raw);},tree(){return new RecordValueTree(this);}};}
const project=item=>({id:item.id,label:item.label});
const options={path:['values'],collection:['files'],fields:['id','label','visible'],include:item=>item.visible,project};
async function previous(document,result){const builder=new RecordContainerBuilder(document.blocks,'object');await builder.add({name:'values',value:result});return {document,tree:document.tree,root:await builder.finish()};}

test('filtered lists change one source slot without reading or renumbering later results',async t=>{
 const measured=[];
 for(const count of [257,2003]){
  const blocks=memory(),files=Array.from({length:count},(_,i)=>({id:'file-'+i,label:'Saved '+i,visible:i%3!==0,transcript:'Unchanged evidence '.repeat(500)})),document=new RecordDocument(blocks,await blocks.tree().retain({files}),{mutable:true}),before=await filterRecordProjection(document,null,options),prior=await previous(document,before),position=1,next=await document.replace(['files',String(position),'visible'],false),reference=next.reference.bind(next);
  next.reference=(path,flags)=>{if(path[0]==='files'&&path.length>1)assert.equal(Number(path[1]),position,'Read an unchanged source file');return reference(path,flags);};
  blocks.reads=blocks.writes=0;const after=await filterRecordProjection(next,prior,options);measured.push(blocks.reads);assert.ok(blocks.reads<130);assert.ok(blocks.writes<20);t.diagnostic(count+' files: '+blocks.reads+' reads and '+blocks.writes+' writes');
  assert.deepEqual(await next.tree.read(after),files.filter((item,i)=>i!==position&&item.visible).map(project));assert.deepEqual(await document.tree.read(before),files.filter(item=>item.visible).map(project));
  const a=await document.tree.node(before),b=await next.tree.node(after),changes=await Array.fromAsync(next.tree.index.differences(a.root,b.root));assert.deepEqual(changes.map(value=>value.id),[ordinal(position)]);
 }
 assert.ok(Math.abs(measured[1]-measured[0])<30,'Filtered work grew with unchanged collection');
});

test('filtered projections preserve order and exact values through inclusion, reorder, empty lists and older arrays',async()=>{
 const blocks=memory(),files=Array.from({length:97},(_,i)=>({id:'file-'+i,label:i%2?'Unicode 🌿 \\ \ud800':null,visible:i%3!==0}));let document=new RecordDocument(blocks,await blocks.tree().retain({files}),{mutable:true}),root=await blocks.tree().retain(files.filter(options.include).map(project));
 for(const current of [[...files].reverse(),files.slice(3),[],files.map(item=>({...item,visible:false})),files,files.map(item=>({...item,visible:true})),[...files,{id:'tail',label:'Exact',visible:true}]]){
  const next=await document.replace(['files'],current),retained=await filterRecordProjection(next,await previous(document,root),options),expected=current.filter(options.include).map(project);
  assert.deepEqual(await next.tree.read(retained),expected);assert.equal((await Array.fromAsync(next.tree.json(retained,{canonical:true}))).join(''),JSON.stringify(expected));
  assert.equal(await next.tree.arrayLength(retained,[]),expected.length);assert.deepEqual((await next.tree.page(retained,[],{offset:Math.max(0,expected.length-3)})).values,expected.slice(-3));
  assert.equal(await filterRecordProjection(next,await previous(next,retained),options),retained);document=next;root=retained;
 }
 const next=await document.replace(['files','1','label'],'Later caption'),prior=await previous(document,root),controller=new AbortController();controller.abort();await assert.rejects(filterRecordProjection(next,prior,options,{signal:controller.signal}),{name:'AbortError'});
 const changed=await filterRecordProjection(next,prior,options),selected=(await next.tree.selected(changed,['0','id'])).value;assert.equal(selected,'file-1');
 const invalid=await blocks.put('value',{type:'keyed-array',root:await next.tree.index.make({entries:[{id:ordinal(1000),revision:await blocks.put('value',{type:'item',value:await next.tree.retain('Unexpected')})}]})});
 const node=await next.tree.node(invalid);await next.tree.index.flush(node.root);
 await assert.rejects(filterRecordProjection(next,await previous(document,invalid),options),{code:'CATALOGUE_DAMAGED'});
});

test('keyed arrays seek by logical rank and validate all streamed children',async()=>{
 const blocks=memory(),tree=blocks.tree(),expected=[];
 // Build a key-based index using source positions with gaps.
 let root=null;for(let i=0;i<5003;i++){const value={id:i,label:'Exact '+i};expected.push(value);root=await tree.index.change(root,ordinal(i*3),await blocks.put('value',{type:'item',value:await tree.retain(value)}));if(i%32===0)await tree.index.flush(root);}await tree.index.flush(root);
 const retained=await blocks.put('value',{type:'keyed-array',root});blocks.reads=0;assert.deepEqual((await tree.page(retained,[],{offset:4999,limit:4})).values,expected.slice(4999));assert.ok(blocks.reads<35);
 const amended=await tree.replace(retained,['4999','label'],'Corrected');assert.equal((await tree.selected(amended,['4999','label'])).value,'Corrected');assert.deepEqual(await tree.read(retained),expected);
 assert.equal((await Array.fromAsync(tree.json(retained))).join('')+'\n',serialize(expected));
 const entry=await tree.index.entryAt({root},5002),badRoot=await tree.index.change(root,entry.id,await blocks.put('value',{type:'property',name:'invalid',value:await tree.retain('Not an array item')}));await tree.index.flush(badRoot);const bad=await blocks.put('value',{type:'keyed-array',root:badRoot});
 await assert.rejects(tree.read(bad),{code:'CATALOGUE_DAMAGED'});await assert.rejects(Array.fromAsync(tree.json(bad)),{code:'CATALOGUE_DAMAGED'});await assert.rejects(tree.page(bad,[],{offset:5002}),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(Array.fromAsync(tree.json(retained,{signal:AbortSignal.abort()})),{name:'AbortError'});
});
