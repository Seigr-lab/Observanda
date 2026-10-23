import test from 'node:test';
import assert from 'node:assert/strict';
import {MaterialSequence} from '../src/material-sequence.js';
import {defaultDomain} from '../src/web/measurement-domain-model.js';
import {retainDomainValue,verifyDomainValue,domainValuePage,domainValuesEqual,domainValueKey} from '../src/measurement-domain-storage.js';
function fixture(){const values=new Map(),workspace={readMetadata:async key=>values.get(key)??null,writeMetadata:async(key,value)=>{values.set(key,value);}},materials={workspace,sequences:new MaterialSequence(workspace)};return {materials,values,retain:(source,domain)=>retainDomainValue(materials,{kind:'string',value:source},domain,fn=>fn())};}
test('native domains preserve exact component spelling and compare declared values across radices',async()=>{
 const f=fixture(),senary={...defaultDomain('vector'),component:{version:1,representation:'radix-fraction',radix:6}},decimal=defaultDomain('vector');
 const a=await f.retain('["10","0.3"]',senary),b=await f.retain('[6,0.5]',decimal);assert.equal(domainValuesEqual(f.materials,a,b),true);assert.equal(a.original,'["10","0.3"]');
 const page=await domainValuePage(f.materials,a);assert.deepEqual(page.items.map(item=>[item.position,item.spelling,item.exact]),[[[0],'10','6/1'],[[1],'0.3','1/2']]);await verifyDomainValue(f.materials,a);
 const complex=await f.retain('["1.25","-2"]',defaultDomain('complex'));assert.equal((await domainValuePage(f.materials,complex)).items[1].exact,'-2/1');assert.throws(()=>domainValuesEqual(f.materials,a,complex));
});
test('unknown codec versions and distinct symbols survive without inferred numeric meaning',async()=>{
 const f=fixture(),domain={...defaultDomain('matrix'),codecVersion:99},original='uninterpreted future syntax '+String.fromCodePoint(0x1f41d).repeat(9000),unknown=await f.retain(original,domain);assert.equal(unknown.components,null);assert.equal(unknown.identity,null);assert.equal((await domainValuePage(f.materials,unknown)).supported,false);await verifyDomainValue(f.materials,unknown);assert.throws(()=>domainValueKey(f.materials,unknown,domain),{code:'MEASUREMENT_DOMAIN_UNSUPPORTED'});
 const a=await f.retain('01',defaultDomain('symbol')),b=await f.retain('1',defaultDomain('symbol'));assert.equal(domainValuesEqual(f.materials,a,b),false);assert.equal(a.components,null);await verifyDomainValue(f.materials,a);
});
test('large matrices page complete components and verify against retained source',async()=>{
 const f=fixture(),domain={...defaultDomain('matrix'),shape:[257,17]},source=JSON.stringify(Array.from({length:257},(_,row)=>Array.from({length:17},(_,column)=>String(row*17+column)))),value=await f.retain(source,domain);
 assert.equal(value.components.count,4369);assert.equal(value.components.chunkSize,16);assert.equal(value.original.format,'dataset-cell');const page=await domainValuePage(f.materials,value,{offset:4367,limit:2});assert.deepEqual(page.items.map(item=>item.position),[[256,15],[256,16]]);assert.equal(page.next,null);assert.equal(page.items[1].spelling,'4368');await verifyDomainValue(f.materials,value);
 await assert.rejects(verifyDomainValue(f.materials,{...value,identity:'0'.repeat(64)}),{code:'MATERIAL_MISSING'});for(const raw of f.values.values())assert(Buffer.byteLength(raw)<=1048576);
});
test('shape, partial values, scalar budgets and cancellation refuse without truncation',async()=>{
 const f=fixture(),matrix=defaultDomain('matrix');await assert.rejects(f.retain('[[1,2,3],[4]]',matrix));await assert.rejects(f.retain('[[1,2],[3,4],[5,6]]',matrix));await assert.rejects(f.retain('[1,true]',defaultDomain('complex')));await assert.rejects(f.retain('["'+'1'.repeat(8193)+'",2]',defaultDomain('complex')),{code:'MEASUREMENT_DOMAIN_COMPONENT_LIMIT'});
 const missing=await f.retain('[1,null]',defaultDomain('complex'));assert.equal(missing.complete,false);assert.equal(domainValuesEqual(f.materials,missing,missing),null);assert.equal((await domainValuePage(f.materials,missing)).items[1].presence,'null');await verifyDomainValue(f.materials,missing);
 const controller=new AbortController();controller.abort();await assert.rejects(retainDomainValue(f.materials,{kind:'string',value:'[1,2]'},defaultDomain('complex'),fn=>fn(),{signal:controller.signal}),{name:'AbortError'});
});
