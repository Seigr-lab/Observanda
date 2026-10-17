import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {ConfigurationDocuments,verifyConfigurationBlocks} from '../src/configuration-documents.js';
import {ConfigurationIndex} from '../src/configuration-index.js';
import {ConfigurationValueBlocks} from '../src/configuration-block-store.js';
import {validConfigurationReference} from '../src/web/configuration-reference.js';
import {RecordDocument} from '../src/record-document.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {copyRecordValue} from '../src/record-document-copy.js';
import {digest,serialize} from '../src/storage-format.js';
import {seal,unseal} from '../src/encryption.js';
function fixture(){
 const states=new Map(),key=randomBytes(32),owner={workspaceId:randomUUID(),projectId:randomUUID(),notebookId:randomUUID(),slot:'configuration'};let version=122,writes=0;
 const db={id:randomUUID(),
  async all(sql,...args){
   if(sql==='SELECT version FROM catalogue_format')return [{version}];
   if(sql.startsWith('SELECT slot,payload FROM state WHERE slot=ANY'))return args[0].filter(slot=>states.has(slot)).map(slot=>({slot,payload:states.get(slot)}));
   if(sql.startsWith('SELECT slot,payload FROM state WHERE slot LIKE'))return [...states].filter(([slot])=>slot.startsWith(args[0].slice(0,-1))&&slot>args[1]).sort(([a],[b])=>a<b?-1:a>b?1:0).slice(0,64).map(([slot,payload])=>({slot,payload}));
   assert.fail(sql);
  },
  async get(sql,slot){if(sql==='SELECT payload FROM state WHERE slot=$1')return states.has(slot)?{payload:states.get(slot)}:undefined;assert.fail(sql);},
  async run(sql,...args){if(sql.startsWith('INSERT INTO state VALUES')){writes++;for(let i=0;i<args.length;i+=2){assert.ok(!states.has(args[i]));states.set(args[i],Buffer.from(args[i+1]));}return;}assert.fail(sql);}
 };
 const store={db,workspace:{},encode(kind,slot,value){return seal(Buffer.from(serialize(value)),key,kind+':'+slot);},decode(kind,slot,value){if(!value)throw Object.assign(Error('Missing'),{code:'CATALOGUE_DAMAGED'});return JSON.parse(unseal(value,key,kind+':'+slot).toString());}};
 return {owner,store,states,get writes(){return writes;},set version(value){version=value;},close(){key.fill(0);}};
}
const field=(key,choices=[])=>({key,label:key,type:choices.length?'select':'text',unit:'',required:false,choices});
const section=(key,fields=[],profileId=null)=>({id:randomUUID(),profileId,key,label:key,description:'Retained definition',enabled:true,fields});
const schema=()=>({profiles:[{id:'retained-profile',version:17,enabled:true}],sections:[section('first',[field('one')],'retained-profile'),section('last',[field('two',['A','B'])])]});
function memory(){const nodes=new Map();return {tree(){return new RecordValueTree(this);},async put(kind,value){const text=serialize(value),revision=digest(text);nodes.set(kind+':'+revision,text);return revision;},async read(kind,revision){const text=nodes.get(kind+':'+revision);assert.ok(text);return JSON.parse(text);}};}
async function text(document){let value='';for await(const chunk of document.tree.json(document.root))value+=chunk;return value+'\n';}

test('legacy configuration read is immutable; selected descriptor edits preserve old schema bytes and indexed child windows',async t=>{
 const f=fixture();t.after(f.close);const documents=new ConfigurationDocuments(f.store),value=schema(),legacy=await documents.open(f.owner,value);
 assert.equal(f.writes,0);assert.equal(legacy.descriptor,null);assert.deepEqual(await legacy.header(),{counts:{profiles:1,sections:2,fields:2,choices:2}});
 const reference=await documents.retainInline(f.owner,value);assert.ok(validConfigurationReference(reference,f.owner));const original=await documents.open(f.owner,reference),before=await text(original.document);assert.equal(before,serialize(value));
 const selected=await original.item({collection:'sections',key:value.sections[1].id});assert.ok(!Object.hasOwn(selected.value,'fields'));assert.equal(selected.counts.fields,1);
 const next=await documents.applySelected(original,[{type:'replace',collection:'fields',sectionId:value.sections[1].id,key:'two',value:{label:'Revised choice'}}]);
 const reader=await documents.open(f.owner,next);assert.equal((await reader.item({collection:'fields',sectionId:value.sections[1].id,key:'two'})).value.label,'Revised choice');
 assert.deepEqual((await reader.window({collection:'choices',sectionId:value.sections[1].id,fieldKey:'two',offset:1,limit:1})).rows.map(row=>row.value),['B']);
 assert.equal(await text(original.document),before);assert.equal(await reader.item({collection:'sections',key:randomUUID()}),null);
 const custom=await reader.window({collection:'sections',allowedProfiles:[],available:true,limit:1});assert.equal(custom.total,1);assert.equal(custom.rows[0].key,value.sections[1].id);assert.equal(custom.next,null);
 const included=await reader.window({collection:'sections',allowedProfiles:['retained-profile'],available:true,offset:1,limit:1});assert.equal(included.total,2);assert.equal(included.rows[0].key,value.sections[1].id);assert.equal(included.offset,1);assert.equal(included.next,null);
 assert.equal((await reader.window({collection:'sections',allowedProfiles:['retained-profile'],query:'LAST'})).total,1);
 await documents.verify(f.owner,next);await verifyConfigurationBlocks(f.store);const count=f.writes;
 await reader.window({collection:'sections'});await reader.item({collection:'choices',sectionId:value.sections[1].id,fieldKey:'two',key:'B'});assert.equal(f.writes,count,'Selected reads wrote durable nodes');
 const seeded=memory(),template=new RecordDocument(seeded,null,{mutable:true}),chosen=await reader.sectionReference({id:value.sections[1].id});template.root=await copyRecordValue(reader.document,template,chosen.fields);
 assert.deepEqual(await template.tree.read(template.root),[{...value.sections[1].fields[0],label:'Revised choice'}]);
});

test('selected scalar and late choice edits avoid unchanged schema positions as each collection grows',async t=>{
 const f=fixture();t.after(f.close);const documents=new ConfigurationDocuments(f.store),value={profiles:[],sections:Array.from({length:193},(_,i)=>section('section-'+i,[field('field'+i)]))};
 value.sections[192].fields=Array.from({length:97},(_,i)=>field('late'+i));value.sections[192].fields[96]=field('late96',Array.from({length:193},(_,i)=>'Choice '+i));
 const reference=await documents.retainInline(f.owner,value),reader=await documents.open(f.owner,reference),last=value.sections[192];
 const source=reader.document.tree.select.bind(reader.document.tree);reader.document.tree.select=async(root,path)=>{if(path[0]==='sections'&&path[1]!==undefined)assert.equal(path[1],'192');if(path[2]==='fields'&&path[3]!==undefined)assert.equal(path[3],'96');return source(root,path);};
 const row=await reader.item({collection:'choices',sectionId:last.id,fieldKey:'late96',key:'Choice 192'});assert.equal(row.position,192);
 const positions=[],select=RecordValueTree.prototype.select;RecordValueTree.prototype.select=async function(root,path){if(path[0]==='sections'&&path[1]!==undefined)positions.push(path.slice());return select.call(this,root,path);};
 let next;try{next=await documents.applySelected(reader,[{type:'replace',collection:'choices',sectionId:last.id,fieldKey:'late96',key:'Choice 192',value:'Last revised choice'}]);}finally{RecordValueTree.prototype.select=select;}
 assert.ok(positions.length>0);assert.ok(positions.every(path=>path[1]==='192'&&(path[2]!=='fields'||path[3]===undefined||path[3]==='96')),'Selected edit traversed another section or field');
 const reopened=await documents.open(f.owner,next);assert.equal((await reopened.item({collection:'choices',sectionId:last.id,fieldKey:'late96',key:'Last revised choice'})).position,192);
 assert.deepEqual(await reopened.header(),{counts:{profiles:0,sections:193,fields:289,choices:193}});await documents.verify(f.owner,next);
});

test('selected identity/order edits retain duplicate protection, draft admission and semantic profile moves',async t=>{
 const f=fixture();t.after(f.close);const documents=new ConfigurationDocuments(f.store),value=schema();value.sections.splice(1,0,section('disabled',[],'retained-profile'));value.sections[1].enabled=false;value.sections.push(section('third',[],'retained-profile'));
 let reference=await documents.retainInline(f.owner,value),reader=await documents.open(f.owner,reference);
 reference=await documents.applySelected(reader,[{type:'move',collection:'sections',key:value.sections[0].id,direction:1}]);reader=await documents.open(f.owner,reference);
 assert.equal((await reader.item({collection:'sections',key:value.sections[0].id})).position,3);assert.equal((await reader.item({collection:'sections',key:value.sections[1].id})).position,1);
 await assert.rejects(documents.applySelected(reader,[{type:'append',collection:'sections',value:value.sections[0]}]),{code:'INVALID'});
 await assert.rejects(documents.applySelected(reader,[{type:'replace',collection:'sections',key:value.sections[0].id,value:{fields:[]}}]),{code:'INVALID'});
 await assert.rejects(documents.applySelected(reader,[{type:'remove',collection:'profiles',key:'retained-profile'}]),{code:'INVALID'});
 reference=await documents.applySelected(reader,[{type:'replace',collection:'sections',key:value.sections[0].id,value:{label:''}}]);reader=await documents.open(f.owner,reference,{draft:true});assert.equal((await reader.item({collection:'sections',key:value.sections[0].id})).value.label,'');
 await assert.rejects(documents.verify(f.owner,reference),{code:'CATALOGUE_DAMAGED'});await documents.verify(f.owner,reference,{draft:true});
});

test('owner binding, copy, cancellation and independent reverse node verification remain exact',async t=>{
 const f=fixture(),g=fixture();t.after(f.close);t.after(g.close);const documents=new ConfigurationDocuments(f.store),value=schema(),reference=await documents.retainInline(f.owner,value),reader=await documents.open(f.owner,reference);
 await assert.rejects(documents.open({...f.owner,notebookId:randomUUID()},reference),{code:'CATALOGUE_DAMAGED'});
 const copied=await new ConfigurationDocuments(g.store).clone(g.owner,reader);assert.equal(await text((await new ConfigurationDocuments(g.store).verify(g.owner,copied)).document),serialize(value));assert.equal(copied.owner.workspaceId,g.owner.workspaceId);
 const fresh=await new ConfigurationDocuments(g.store).clone(g.owner,reader,{freshSectionIds:true,uuid:randomUUID}),freshReader=await new ConfigurationDocuments(g.store).verify(g.owner,fresh);assert.notEqual((await freshReader.window({collection:'sections'})).rows[0].key,value.sections[0].id);assert.equal((await freshReader.window({collection:'sections'})).rows[0].value.key,value.sections[0].key);
 const cancelled=new AbortController();cancelled.abort(new Error('Cancelled selection'));const writes=f.writes;await assert.rejects(documents.applySelected(reader,[{type:'remove',collection:'sections',key:value.sections[0].id}],{signal:cancelled.signal}),/Cancelled selection/);assert.equal(f.writes,writes);
 const selected=await reader.index.table.find(reader.index.value,'o:sections:'+String(0).padStart(16,'0')),derivedSlot='configuration-block:value:'+selected.revision,derived=f.states.get(derivedSlot);
 f.states.delete(derivedSlot);await assert.rejects(documents.verify(f.owner,reference),{code:'CATALOGUE_DAMAGED'});f.states.set(derivedSlot,derived);
 f.states.set(derivedSlot,f.store.encode('state',derivedSlot,{type:'inline',value:null}));await assert.rejects(documents.verify(f.owner,reference),{code:'CATALOGUE_DAMAGED'});f.states.set(derivedSlot,derived);
 const extraIndex=structuredClone(reference);extraIndex.index.root=await reader.index.table.change(reference.index.root,'unexpected:row',selected.revision);await reader.index.table.flush(extraIndex.index.root);await reader.document.blocks.flush();await assert.rejects(documents.verify(f.owner,extraIndex),{code:'CATALOGUE_DAMAGED'});
 const bad=structuredClone(reference);bad.index.source='0'.repeat(64);await assert.rejects(documents.open(f.owner,bad),{code:'CATALOGUE_DAMAGED'});
 const slot='configuration-block:value:'+reference.root,original=f.states.get(slot);f.states.set(slot,f.store.encode('state',slot,{type:'inline',value:{profiles:[],sections:[]}}));await assert.rejects(documents.verify(f.owner,reference),{code:'CATALOGUE_DAMAGED'});f.states.set(slot,original);
 const extra='configuration-block:value:'+'e'.repeat(64);f.states.set(extra,f.store.encode('state',extra,{type:'inline',value:null}));await assert.rejects(verifyConfigurationBlocks(f.store),{code:'CATALOGUE_DAMAGED'});f.states.delete(extra);await verifyConfigurationBlocks(f.store);f.version=121;await assert.rejects(verifyConfigurationBlocks(f.store),{code:'CATALOGUE_DAMAGED'});
});
