import '../src/storage.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RecordDocument} from '../src/record-document.js';
import {recordTemplateHeader,validateRecordTemplate} from '../src/record-template-document.js';
import {digest,serialize} from '../src/storage-format.js';

test('streamed custom-field validation retains schema, unknown-key and required-value checks',async()=>{
 const original={id:randomUUID(),profileId:null,label:'Observed values',description:'',fields:Array.from({length:70},(_,i)=>({key:'v'+i,label:'Value '+i,type:'number',unit:'',required:true,choices:[]})),values:Object.fromEntries(Array.from({length:70},(_,i)=>['v'+i,String(i)]))};
 const validate=async template=>{
  const nodes=new Map(),blocks={async put(kind,value){const raw=serialize(value),revision=digest(raw);nodes.set(kind+':'+revision,raw);return revision;},async read(kind,revision){return JSON.parse(nodes.get(kind+':'+revision));},tree(){return new RecordValueTree(this);}};
  const tree=blocks.tree(),root=await tree.retain({template}),document=new RecordDocument(blocks,root,{mutable:true});
  const header=await recordTemplateHeader(document);return validateRecordTemplate(document,header);
 };
 await validate(original);
 for(const mutate of [
  t=>t.fields.push(t.fields[0]),t=>delete t.values.v69,t=>t.values.v69='not a number',t=>t.values.extra='1',
  t=>t.fields=null,t=>t.values=null,t=>t.extra=true,t=>delete t.fields,t=>delete t.values,
  t=>t.fields[0].key='constructor',t=>t.values.v0='',t=>t.fields[0].required='yes'
 ]){const value=structuredClone(original);mutate(value);await assert.rejects(validate(value));}
 const optional=structuredClone(original);optional.fields[69].required=false;delete optional.values.v69;await validate(optional);await validate(null);
});

test('streamed choice validation preserves exact duplicate, membership, required and draft semantics',async()=>{
 const original={id:randomUUID(),profileId:null,label:'Observed choices',description:'',fields:[{key:'observed',label:'Observation',type:'select',unit:'',required:true,choices:Array.from({length:97},(_,i)=>'Choice '+i+' '+('x'.repeat(120)))}],values:{}};original.values.observed=original.fields[0].choices.at(-1);
 const validate=async(template,options={})=>{
  const nodes=new Map(),blocks={async put(kind,value){const raw=serialize(value),revision=digest(raw);nodes.set(kind+':'+revision,raw);return revision;},async read(kind,revision){return JSON.parse(nodes.get(kind+':'+revision));},tree(){return new RecordValueTree(this);}};
  const root=await blocks.tree().retain({template}),document=new RecordDocument(blocks,root),json=document.tree.json.bind(document.tree);
  document.tree.read=async()=>{throw Error('Template validation hydrated a field or choices');};
  document.tree.json=async function*(revision,settings){const node=await document.tree.node(revision);assert.ok(!['array','object'].includes(node.type),'Template validation serialized a growing collection');yield* json(revision,settings);};
  return validateRecordTemplate(document,await recordTemplateHeader(document),options);
 };
 await validate(original);
 for(const mutate of [t=>t.fields[0].choices.push(t.fields[0].choices[0]),t=>t.fields[0].choices[96]=' ',t=>t.fields[0].choices[96]=false,t=>t.fields[0].choices=[],t=>t.fields[0].extra=true,t=>t.values.observed='Choice absent',t=>delete t.values.observed,t=>t.values.observed=false,t=>t.values.extra='value']){const value=structuredClone(original);mutate(value);await assert.rejects(validate(value));}
 const incomplete=structuredClone(original);delete incomplete.values.observed;await validate(incomplete,{draft:true});
 const optional=structuredClone(incomplete);optional.fields[0].required=false;await validate(optional);
 const invalidDraft=structuredClone(original);invalidDraft.values.observed='Unknown';await assert.rejects(validate(invalidDraft,{draft:true}));
});
