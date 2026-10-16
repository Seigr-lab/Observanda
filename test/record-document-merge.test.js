import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RecordDocument} from '../src/record-document.js';
import {mergeRecordDocuments} from '../src/record-document-merge.js';
import {reconcileRecords} from '../src/web/record-merge.js';
import {digest,serialize} from '../src/storage-format.js';

function memory(){const nodes=new Map();return {async put(kind,value){const raw=serialize(value),revision=digest(raw);nodes.set(kind+revision,raw);return revision;},async read(kind,revision){return JSON.parse(nodes.get(kind+revision));},tree(){return new RecordValueTree(this);}};}
const section=id=>({id,title:id,body:'Source '+id});
const record=ids=>({id:'record',title:'Record',body:'',notebookId:'book',share:true,createdAt:'original',updatedAt:'original',sections:ids.map(section),attachments:[],contributors:[],relations:[],figures:[]});
async function compare(base,mine,stored,version){
 const blocks=memory(),tree=blocks.tree(),roots=await Promise.all([base,mine,stored].map(value=>tree.retain(value))),document=new RecordDocument(blocks,roots[2],{mutable:true}),conflicts=[];
 const merged=await mergeRecordDocuments(document,{base:roots[0],mine:roots[1],stored:roots[2],choose:async item=>{conflicts.push(item);return item[version];}});
 const plan=reconcileRecords([{base,record:mine}],[stored]),expected=plan.resolveVersions(new Map(plan.conflicts.map(item=>[item.key,{version}])))[0];
 assert.deepEqual(await tree.read(merged.root),expected);
 assert.deepEqual(conflicts.map(item=>JSON.stringify(['record',...item.path])).sort(),plan.conflicts.map(item=>item.key).sort());
 for(const [i,root] of roots.entries())assert.deepEqual(await tree.read(root),[base,mine,stored][i]);
}
test('stored reconciliation agrees with ordinary independent edits, removals and conflicting orders',async()=>{
 const base=record(['a','b','c','d']),mine=record(['b','a','c','local','d']),stored=record(['a','b','remote','c','d']);mine.sections[0].body='My b';stored.sections.at(-1).body='Saved d';
 await compare(base,mine,stored,'mine');stored.sections.reverse();
 for(const version of ['mine','stored'])await compare(base,mine,stored,version);
 mine.sections.splice(0,1);stored.sections.find(item=>item.id==='b').body='Concurrent removal conflict';
 for(const version of ['mine','stored'])await compare(base,mine,stored,version);
});
test('stored reconciliation preserves exact result claims, optional removal and notebook privacy',async()=>{
 const base=record([]),mine=structuredClone(base),stored=structuredClone(base),statement=(id,text)=>({id,kind:'number',title:id,text,basis:'authored',source:null,limitations:'Declared scope'});
 base.results={version:1,statements:[statement('a','1/3'),statement('b','10')]};mine.results=structuredClone(base.results);stored.results=structuredClone(base.results);
 mine.results.statements[0].text='2/3';stored.results.statements[1].text='11';await compare(base,mine,stored,'mine');
 stored.results.statements[0]={...stored.results.statements[0],basis:'retained',source:{kind:'analysis',id:'source',revision:'exact'},text:'Retained calculation'};
 for(const version of ['mine','stored'])await compare(base,mine,stored,version);
 delete mine.results;stored.body='Concurrent prose';mine.notebookId='new book';await compare(base,mine,stored,'mine');
});
test('stored conflict planning never reads complete arrays or records and cancels without publication',async()=>{
 const blocks=memory(),tree=blocks.tree(),base=record(Array.from({length:257},(_,i)=>'s'+i)),mine=structuredClone(base),stored=structuredClone(base);
 for(let i=0;i<257;i++){mine.sections[i].body='Mine '+i+' '+('x'.repeat(9000));stored.sections[i].body='Saved '+i+' '+('y'.repeat(9000));}
 const roots=await Promise.all([base,mine,stored].map(value=>tree.retain(value))),read=RecordValueTree.prototype.read;
 RecordValueTree.prototype.read=async function(ref){const node=await this.node(ref);if(node.type==='array'||node.type==='object')throw Error('Complete source assembled');return read.call(this,ref);};
 try{
  let conflicts=0;const document=new RecordDocument(blocks,roots[2],{mutable:true});
  const merged=await mergeRecordDocuments(document,{base:roots[0],mine:roots[1],stored:roots[2],choose:async item=>{conflicts++;return item.mine;}});
  assert.equal(conflicts,257);assert.equal((await merged.field(['sections','256','body'])).value,mine.sections[256].body);
  const controller=new AbortController();controller.abort(Error('Stop comparison'));
  await assert.rejects(mergeRecordDocuments(document,{base:roots[0],mine:roots[1],stored:roots[2],choose:()=>{throw Error('Unexpected conflict');},signal:controller.signal}),/Stop comparison/);
 }finally{RecordValueTree.prototype.read=read;}
});
