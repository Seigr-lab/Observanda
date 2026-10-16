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
