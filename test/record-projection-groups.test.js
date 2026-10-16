import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RecordDocument} from '../src/record-document.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RecordContainerBuilder} from '../src/record-tree-values.js';
import {groupRecordProjection} from '../src/record-projection-groups.js';
import {digest,serialize} from '../src/storage-format.js';
const ordinal=value=>String(value).padStart(16,'0');
function memory(){const nodes=new Map();return {reads:0,writes:0,async put(kind,value){const text=serialize(value),revision=digest(text);assert.ok(Buffer.byteLength(text)<=65536);nodes.set(kind+':'+revision,text);this.writes++;return revision;},async read(kind,revision){this.reads++;return JSON.parse(nodes.get(kind+':'+revision));},tree(){return new RecordValueTree(this);}};}
const project=row=>row.labels.map(label=>({label}));
const groups=[{field:['intro'],project:values=>values.map(label=>({label}))},{collection:['rows'],fields:['labels'],project},{field:['outro'],project:values=>values.map(label=>({label}))}];
const options={path:['links'],groups};
const expected=record=>[...groups[0].project(record.intro),...record.rows.flatMap(project),...groups[2].project(record.outro)];
async function previous(document,result){const builder=new RecordContainerBuilder(document.blocks,'object');await builder.add({name:'links',value:result});return {document,tree:document.tree,root:await builder.finish()};}

test('variable output groups update only an amended source while later logical positions change',async t=>{
 const measured=[];
 for(const count of [257,2003]){
  const blocks=memory(),record={intro:['Intro',''],outro:['End'],rows:Array.from({length:count},(_,i)=>({labels:['Reference '+i,'Duplicate','Duplicate'],unrelated:'Unchanged body '.repeat(600)}))},document=new RecordDocument(blocks,await blocks.tree().retain(record),{mutable:true}),before=await groupRecordProjection(document,null,options),prior=await previous(document,before),position=1,next=await document.replace(['rows',String(position),'labels'],['Corrected']),reference=next.reference.bind(next);
  next.reference=(path,flags)=>{if(path[0]==='rows'&&path.length>1)assert.equal(Number(path[1]),position);return reference(path,flags);};
  blocks.reads=blocks.writes=0;const after=await groupRecordProjection(next,prior,options);measured.push(blocks.reads);assert.ok(blocks.reads<150);assert.ok(blocks.writes<20);t.diagnostic(count+' groups: '+blocks.reads+' reads and '+blocks.writes+' writes');
  const changed=structuredClone(record);changed.rows[position].labels=['Corrected'];assert.deepEqual(await next.tree.read(after),expected(changed));assert.deepEqual(await document.tree.read(before),expected(record));
  const a=await document.tree.node(before),b=await next.tree.node(after),changes=await Array.fromAsync(next.tree.index.differences(a.root,b.root));assert.equal(changes.length,3);assert.ok(changes.every(value=>value.id.startsWith(ordinal(1)+':'+ordinal(position)+':')));
 }
 assert.ok(Math.abs(measured[1]-measured[0])<30);
});

test('grouped arrays preserve exact order, duplicate links, old arrays and scalar/collection transitions',async()=>{
 const blocks=memory(),record={intro:['I'],outro:['E'],rows:Array.from({length:67},(_,i)=>({labels:i%3?['Label '+i,'Repeated']:[]}))};let document=new RecordDocument(blocks,await blocks.tree().retain(record),{mutable:true}),root=await blocks.tree().retain(expected(record));
 for(const [path,value] of [[['rows','1','labels'],['Unicode 🌿','\ud800','']], [['intro'],[]], [['outro'],['Revised','End']], [['rows'],[...record.rows].reverse()], [['rows'],record.rows.slice(10,15)], [['rows'],[]], [['rows'],record.rows], [['intro'],['New intro']], [['rows','1','labels'],Array.from({length:81},(_,i)=>'Link '+i)], [['rows','1','labels'],[]]]){
  const next=await document.replace(path,value),after=await groupRecordProjection(next,await previous(document,root),options),valueRecord=await next.tree.read(next.root);
  assert.deepEqual(await next.tree.read(after),expected(valueRecord));assert.equal((await Array.fromAsync(next.tree.json(after,{canonical:true}))).join(''),JSON.stringify(expected(valueRecord)));document=next;root=after;
 }
 assert.equal(await groupRecordProjection(document,await previous(document,root),options),root);
 const controller=new AbortController();let closed=false;
 const cancelled={path:['links'],groups:[{field:['intro'],async *project(){try{yield {label:'First'};controller.abort();yield {label:'Cancelled'};}finally{closed=true;}}}]};
 await assert.rejects(groupRecordProjection(document,null,cancelled,{signal:controller.signal}),{name:'AbortError'});assert.equal(closed,true);
 // A gap in a retained owner's output positions is corruption, not a new list.
 const fresh=await groupRecordProjection(document,null,options),node=await document.tree.node(fresh),index=document.tree.index,prefix=ordinal(1)+':'+ordinal(2)+':',gap=await index.remove(node.root,prefix+ordinal(0));await index.flush(gap);
 const broken=await blocks.put('value',{type:'keyed-array',root:gap}),next=await document.replace(['rows','2','labels'],['Changed']);await assert.rejects(groupRecordProjection(next,await previous(document,broken),options),{code:'CATALOGUE_DAMAGED'});
});
