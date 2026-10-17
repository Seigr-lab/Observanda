// Initialize the catalogue module graph before using its standalone document adapter.
import '../src/storage.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RecordDocument} from '../src/record-document.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {recordTemplateChoices,recordTemplateDefinition,recordTemplateSearchText} from '../src/record-template-document.js';
import {digest,serialize} from '../src/storage-format.js';

async function fixture(){
 const choices=Array.from({length:4097},(_,i)=>'Choice '+String(i).padStart(4,'0')+' '+('observed '.repeat(16))),nodes=new Map();
 const blocks={async put(kind,value){const raw=serialize(value),revision=digest(raw);nodes.set(kind+':'+revision,raw);return revision;},async read(kind,revision){return JSON.parse(nodes.get(kind+':'+revision));},tree(){return new RecordValueTree(this);}};
 const root=await blocks.tree().retain({template:{id:randomUUID(),profileId:null,label:'Saved choices',description:'',fields:[{key:'observed',label:'Observation',type:'select',unit:'',required:true,choices}],values:{observed:choices.at(-1)}}});
 return {choices,document:new RecordDocument(blocks,root,{mutable:true})};
}
test('selected field metadata and choice windows never hydrate the schema or choice collection',async()=>{
 const {document,choices}=await fixture(),read=document.tree.read.bind(document.tree),json=document.tree.json.bind(document.tree);let visited=0;
 document.tree.read=async revision=>{const node=await document.tree.node(revision);assert.ok(!['array','object'].includes(node.type),'Selected read hydrated a collection');return read(revision);};
 document.tree.json=async function*(revision,options){const node=await document.tree.node(revision);assert.ok(!['array','object'].includes(node.type),'Selected read serialized a collection');yield* json(revision,options);};
 const items=document.items.bind(document);document.items=async function*(path,options){for await(const row of items(path,options)){if(path.at(-1)==='choices')visited++;yield row;}};
 const definition=await recordTemplateDefinition(document,'template:observed');assert.equal((await document.field(['template','values','observed'])).value,choices.at(-1));assert.equal(definition.choiceCount,choices.length);assert.equal(Object.hasOwn(definition,'choices'),false);assert.equal(visited,0);
 const pin=definition.schemaRevision,page=await recordTemplateChoices(document,'template:observed',{schemaRevision:pin,offset:4064});
 assert.deepEqual(page,{schemaRevision:pin,offset:4064,total:4097,next:4096,items:choices.slice(4064,4096)});assert.equal(visited,32);
 const last=await recordTemplateChoices(document,'template:observed',{schemaRevision:pin,offset:4096});assert.deepEqual(last.items,[choices.at(-1)]);assert.equal(last.next,null);assert.equal(visited,33);
 const search=await recordTemplateChoices(document,'template:observed',{schemaRevision:pin,query:'CHOICE 409'});assert.equal(search.total,7);assert.deepEqual(search.items,choices.slice(4090));assert.equal(search.next,null);
 const edited=await document.property(['template','values'],'observed',choices[0]);assert.equal((await recordTemplateDefinition(edited,'template:observed')).schemaRevision,pin);
 const changed=await document.replace(['template','fields','0','choices','0'],'New choice');await assert.rejects(recordTemplateChoices(changed,'template:observed',{schemaRevision:pin}),{code:'RECORD_CHANGED'});
 await assert.rejects(recordTemplateChoices(document,'template:missing',{schemaRevision:pin}),{code:'MISSING'});
 for(const options of [{offset:-1},{offset:0.5},{query:'x'.repeat(161)},{schemaRevision:'wrong'}])await assert.rejects(recordTemplateChoices(document,'template:observed',{schemaRevision:pin,...options}),{code:'INVALID'});
 const controller=new AbortController();controller.abort();await assert.rejects(recordTemplateChoices(document,'template:observed',{schemaRevision:pin,signal:controller.signal}),{name:'AbortError'});
});

test('template search spelling preserves joined values and lowered vocabulary windows without reading choices',async()=>{
 const {document}=await fixture(),field=document.field.bind(document),read=document.tree.read.bind(document.tree);
 const choices=await document.reference(['template','fields','0','choices']);
 document.field=async(path,options)=>{assert.notDeepEqual(path,['template']);return field(path,options);};
 document.tree.read=async revision=>{assert.notEqual(revision,choices);return read(revision);};
 for(const values of [{a:'Alpha',b:null,c:false,d:''},{a:'A'.repeat(2046)+'??',b:'? '.repeat(4000),c:'\ud800',d:'\udfff'},{}]){
  const changed=await document.replace(['template','values'],values),selected=changed.field.bind(changed),valueRead=changed.tree.read.bind(changed.tree);changed.field=async(path,options)=>{assert.notDeepEqual(path,['template']);return selected(path,options);};changed.tree.read=async revision=>{assert.notEqual(revision,choices);return valueRead(revision);};
  const expected=['Saved choices',...Object.values(values)].join(' '),text=await recordTemplateSearchText(changed);
  const actual=typeof text==='string'?text:(await Array.fromAsync(text)).join('');assert.equal(actual.toLocaleLowerCase(),expected.toLocaleLowerCase());
  if(typeof text==='string')assert.equal(text,expected);else{
   const again=await recordTemplateSearchText(changed),parts=await Array.fromAsync(again);assert.ok(parts.every(part=>part.length<=2048));assert.deepEqual(parts,Array.from({length:Math.ceil(expected.toLocaleLowerCase().length/2048)},(_,i)=>expected.toLocaleLowerCase().slice(i*2048,(i+1)*2048)));
  }
 }
 const absent=await document.property([],'template',null,{remove:true}),empty=await document.replace(['template'],null);assert.equal(await recordTemplateSearchText(absent),'');assert.equal(await recordTemplateSearchText(empty),'');
});
