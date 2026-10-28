import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RecordValueTree} from '../src/record-value-tree.js';
import {digest,serialize} from '../src/storage-format.js';
import {revisionText} from '../src/web/revision-model.js';
import {createHash} from 'node:crypto';
import {RecordDocument} from '../src/record-document.js';
import {queryTextMatches} from '../src/record-query-storage.js';

function memory(){
 const nodes=new Map(),reads=[];return {nodes,reads,
  async put(kind,value){const encoded=serialize(value),hash=digest(encoded);assert.ok(Buffer.byteLength(encoded)<=65536);nodes.set(kind+':'+hash,encoded);return hash;},
  async read(kind,hash){reads.push(kind+':'+hash);const encoded=nodes.get(kind+':'+hash);assert.equal(digest(encoded),hash);return JSON.parse(encoded);}
 };
}

test('repeated property selection reuses checked references only for the same immutable tree',async()=>{
 const storage=memory(),tree=new RecordValueTree(storage),value={title:'Before',body:'x'.repeat(9000),sections:[{title:'Section'}]},root=await tree.retain(value);
 assert.deepEqual(await tree.selected(root,['title']),{found:true,value:'Before'});
 assert.deepEqual(await tree.selected(root,['absent']),{found:false});
 storage.reads.length=0;
 for(let i=0;i<100;i++){
  assert.deepEqual(await tree.selected(root,['title']),{found:true,value:'Before'});
  assert.deepEqual(await tree.selected(root,['absent']),{found:false});
 }
 assert.ok(storage.reads.length<=300,'Repeated field lookup re-enumerated the property list');
 const changed=await tree.replace(root,['title'],'After');
 assert.deepEqual(await tree.selected(changed,['title']),{found:true,value:'After'});
 assert.deepEqual(await tree.selected(root,['title']),{found:true,value:'Before'});
 const node=await tree.node(root),entry=await tree.index.entryAt({root:node.root},0);
 storage.nodes.delete('value:'+entry.revision);
 await assert.rejects(new RecordValueTree(storage).selected(root,['title']));
});
test('joined query text streams retained fields without flattening them and preserves old text roots',async()=>{
 const storage=memory(),tree=new RecordValueTree(storage),values=['','a','','b\n','\ud800','\udfff','"quoted" \\','α🔬'.repeat(17000)];let root=null;
 for(let i=0;i<values.length;i++)root=await tree.index.change(root,'field:'+String(i).padStart(8,'0'),await storage.put('value',{type:'item',value:await tree.retain(values[i])}));await tree.index.flush(root);
 const original=await storage.put('value',{type:'joined-string',root});assert.equal(await tree.read(original),values.join(' '));
 storage.reads.length=0;const changed=await tree.index.change(root,'field:00000003',await storage.put('value',{type:'item',value:await tree.retain('Corrected text')}));await tree.index.flush(changed);const next=await storage.put('value',{type:'joined-string',root:changed});assert.ok(storage.reads.length<15);
 tree.read=()=>{throw Error('A joined query assembled its full text');};
 for(const [ref,text] of [[original,values.join(' ')],[next,values.map((v,i)=>i===3?'Corrected text':v).join(' ')]]){
  assert.equal((await Array.fromAsync(tree.text(ref,[]))).join(''),text);
  for(const canonical of [true,false]){const chunks=await Array.fromAsync(tree.json(ref,{canonical}));assert.equal(chunks.join(''),JSON.stringify(text));assert.ok(chunks.every(value=>Buffer.byteLength(value)<=65536));}
 }
 const badRoot=await tree.index.change(root,'field:00000007',await storage.put('value',{type:'item',value:await tree.retain(17)}));await tree.index.flush(badRoot);const bad=await storage.put('value',{type:'joined-string',root:badRoot});
 await assert.rejects(Array.fromAsync(tree.text(bad,[])),{code:'CATALOGUE_DAMAGED'});await assert.rejects(Array.fromAsync(tree.json(bad)),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(queryTextMatches(tree.text(bad,[]),'a'),{code:'CATALOGUE_DAMAGED'});
 const end=await tree.index.entryAt({root},values.length-1),saved=storage.nodes.get('value:'+end.revision);storage.nodes.delete('value:'+end.revision);await assert.rejects(queryTextMatches(tree.text(original,[]),'a'));storage.nodes.set('value:'+end.revision,saved);
 await assert.rejects(Array.fromAsync(tree.text(original,[],{signal:AbortSignal.abort()})),{name:'AbortError'});
});
test('record content seeks late sections, shares unchanged revisions and preserves JSON values',async()=>{
 const storage=memory(),tree=new RecordValueTree(storage),record={title:'Retained writing',sections:Array.from({length:1103},(_,i)=>({id:String(i),title:'Section '+i,body:'Exactly '+i+': '+('α🔬\n\\"'.repeat(300))})),metadata:{null:null,empty:'',number:1.23e-24,truth:false}};
 const original=structuredClone(record),root=await tree.retain(record);assert.deepEqual(await tree.read(root),original);
 storage.reads.length=0;
 const late=await new RecordValueTree(storage).page(root,['sections'],{offset:1099,limit:4});
 assert.deepEqual(late,{offset:1099,total:1103,values:record.sections.slice(1099)});assert.ok(storage.reads.length<30,storage.reads.length+' metadata reads');
 const count=storage.nodes.size;record.sections[1].body='A revised conclusion.';record.title='Amendment';
 const next=await new RecordValueTree(storage).retain(record);assert.notEqual(next,root);assert.ok(storage.nodes.size-count<20,(storage.nodes.size-count)+' new nodes');
 assert.deepEqual(await new RecordValueTree(storage).read(next),record);assert.deepEqual(await tree.read(root),original);
 const selected=await tree.selected(next,['sections','1','body']);assert.deepEqual(selected,{found:true,value:'A revised conclusion.'});
 assert.deepEqual(await tree.selected(root,['sections','99999']),{found:false});assert.deepEqual(await tree.selected(root,['metadata','null']),{found:true,value:null});
 assert.deepEqual(await tree.selected(root,['metadata','absent']),{found:false});
 await assert.rejects(tree.page(root,['sections'],{offset:-1}),{code:'INVALID'});
 await assert.rejects(tree.page(root,['metadata']),{code:'INVALID'});
});
test('large string blocks preserve escapes, surrogate pairs and lone surrogate code units',async()=>{
 const storage=memory(),tree=new RecordValueTree(storage),value=('Text 🔬\uD800\uDC00\uD800\n\t\\"\u0000'.repeat(50000)),root=await tree.retain(value);
 assert.equal(await tree.read(root),value);assert.ok((await tree.node(root)).root.count>32);
 tree.read=()=>{throw Error('Streaming a stored string must not assemble it.');};
 for(const canonical of [false,true]){
  const hash=createHash('sha256');let largest=0,chunks=0;
  for await(const text of tree.json(root,{canonical})){hash.update(text);largest=Math.max(largest,Buffer.byteLength(text));chunks++;}
  assert.equal(hash.digest('hex'),digest(JSON.stringify(value)));assert.ok(chunks>32);assert.ok(largest<=32772,largest+' output bytes');
 }
 const controller=new AbortController(),iterator=tree.json(root,{signal:controller.signal});await iterator.next();controller.abort(Error('Stopped traversal'));
 await assert.rejects(iterator.next(),/Stopped traversal/);
});
test('counted sequence boundaries retain every member and numeric object key order',async()=>{
 for(const count of [31,32,33,1023,1024,1025]){
  const tree=new RecordValueTree(memory()),value=Array.from({length:count},(_,i)=>({id:i,body:'v'.repeat(400)})),root=await tree.retain(value);
  assert.deepEqual(await tree.read(root),value);assert.deepEqual((await tree.page(root,[],{offset:count-1})).values,value.slice(-1));
 }
 const tree=new RecordValueTree(memory()),value=JSON.parse('{"10":"ten","2":"two","__proto__":{"safe":true},"body":"'+('x'.repeat(9000))+'"}');
 assert.equal(serialize(await tree.read(await tree.retain(value))),serialize(value));assert.equal({}.safe,undefined);
});
test('a selected block amendment reads only its path and keeps both exact revision inputs',async()=>{
 const storage=memory(),tree=new RecordValueTree(storage),record={id:'stable',sections:Array.from({length:5003},(_,i)=>({title:'Section '+i,body:'Original '+i+': '+('x'.repeat(900))})),body:'a'.repeat(9000),metadata:{z:2,a:1,'10':'ten','2':'two'}};
 const root=await tree.retain(record);storage.reads.length=0;const before=storage.nodes.size;
 const next=await new RecordValueTree(storage).replace(root,['sections','4999','body'],'Reviewed replacement');
 assert.ok(storage.reads.length<40,storage.reads.length+' reads');assert.ok(storage.nodes.size-before<15,(storage.nodes.size-before)+' new nodes');
 const original=structuredClone(record);record.sections[4999].body='Reviewed replacement';
 assert.deepEqual(await tree.read(root),original);assert.deepEqual(await tree.read(next),record);
 for(const [revision,value] of [[root,original],[next,record]]){
  const parts=[];for await(const part of tree.json(revision))parts.push(part);
  assert.equal(parts.join('')+'\n',serialize(value));
  const canonical=[];for await(const part of tree.json(revision,{canonical:true}))canonical.push(part);
  assert.equal(canonical.join(''),revisionText(value));
 }
 assert.equal(await tree.replace(next,['sections','4999','body'],'Reviewed replacement'),next);
 await assert.rejects(tree.replace(root,['sections','5003','body'],'no'),{code:'INVALID'});
 await assert.rejects(tree.replace(root,['sections','0','missing'],'no'),{code:'INVALID'});
});
test('record blocks reject values that JSON would silently omit or change',async()=>{
 const tree=new RecordValueTree(memory()),cycle={};cycle.self=cycle;
 for(const value of [undefined,NaN,Infinity,{field:undefined},[undefined],new Array(3),{value:new Date()},cycle,{fn(){}}])await assert.rejects(tree.retain(value),{code:'INVALID'});
 const root=await tree.retain({body:'valid'});await assert.rejects(tree.replace(root,['body'],{number:NaN}),{code:'INVALID'});
 assert.deepEqual(await tree.read(root),{body:'valid'});
});

test('appending across array page boundaries preserves exact originals without enumerating their prefix',async t=>{
 for(const count of [0,1,31,32,33,1023,1024,1025,5003]){
  const storage=memory();storage.tree=()=>new RecordValueTree(storage);
  const values=Array.from({length:count},(_,i)=>({id:String(i),body:'Exact prior '+i+' '+('x'.repeat(400))})),record={title:'Original',values},root=await storage.tree().retain(record),document=new RecordDocument(storage,root,{mutable:true});
  if(count>=31)document.items=async function*(){throw Error('Append enumerated an existing array');};
  const added=Array.from({length:65},(_,i)=>({id:'added-'+i,body:'New exact '+i})),before=storage.nodes.size;storage.reads.length=0;
  const next=await document.splice(['values'],count,0,added),reads=storage.reads.length,writes=storage.nodes.size-before;
  assert.ok(reads<450,`${count}: ${reads} reads`);assert.ok(writes<180,`${count}: ${writes} new nodes`);
  assert.deepEqual(await next.tree.read(next.root),{...record,values:[...values,...added]});assert.deepEqual(await document.tree.read(root),record);
  assert.equal((await next.encoding()).revision,digest(serialize({...record,values:[...values,...added]})));
  assert.equal(await next.splice(['values'],count,0,[]),next);
  const controller=new AbortController();controller.abort();await assert.rejects(next.splice(['values'],count+65,0,[{id:'cancelled'}],{signal:controller.signal}),{name:'AbortError'});
  t.diagnostic(`${count} prior items: append 65 used ${reads} reads and ${writes} new nodes`);
 }
});
