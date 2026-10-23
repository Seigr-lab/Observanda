import {validRetainedTable,retainedTableView} from '../src/web/retained-table-model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultDomain,validDomainDefinition,domainCapabilities,sameDomainSpace,domainComponentIndex,domainComponentPosition,domainComponentCount} from '../src/web/measurement-domain-model.js';
test('domain admission pins exact scalar contexts and requires explicit shapes',()=>{
 for(const codec of ['symbol','vector','matrix','complex'])assert(validDomainDefinition(defaultDomain(codec)));
 const a=defaultDomain('vector');a.component={version:1,representation:'radix-fraction',radix:6};assert(validDomainDefinition(a));
 const b={...a,component:{version:1,representation:'rational',radix:10}};assert(sameDomainSpace(a,b));assert(!sameDomainSpace(a,{...b,namespace:'other'}));
 assert(!validDomainDefinition({...a,shape:[0]}));assert(!validDomainDefinition({...a,component:{version:1,representation:'decimal',radix:6}}));assert(!validDomainDefinition({...defaultDomain('complex'),shape:[3]}));
});
test('unknown codecs preserve declarations but have no semantic capabilities',()=>{
 const unknown={...defaultDomain('matrix'),codecVersion:27};assert(validDomainDefinition(unknown));assert.deepEqual(domainCapabilities(unknown),{supported:false,equality:false,ordering:false,copy:false,choose:false,extract:false,componentPlot:false});
 assert(validDomainDefinition({...unknown,codec:'external.future-domain'}));assert(!sameDomainSpace(unknown,unknown));assert.throws(()=>domainComponentIndex(unknown,[0,0]));assert(!validDomainDefinition({...unknown,version:2}));
});
test('component ordinals address large shapes without materializing values or inventing ordering',()=>{
 const domain={...defaultDomain('matrix'),shape:[1000000,1000000]};assert(validDomainDefinition(domain));assert.equal(domainComponentCount(domain),1000000000000);const position=[999999,999998];assert.deepEqual(domainComponentPosition(domain,domainComponentIndex(domain,position)),position);assert.equal(domainCapabilities(domain).ordering,false);
 assert.throws(()=>domainComponentIndex(domain,[1000000,0]));assert(!validDomainDefinition({...domain,shape:[Number.MAX_SAFE_INTEGER,2]}));assert(!validDomainDefinition({...domain,shape:Array(17).fill(1)}));
});

test('historical inline tables refuse domain formats while query windows describe declared domains',()=>{const domain=defaultDomain('complex'),table={version:2,selection:{columns:[0],offset:0,count:1,includeExcluded:false},headers:['Value'],formats:[{representation:'domain',radix:10,domain}],rows:[{cells:['[1,2]'],presence:['value'],exclusion:null}]};assert.equal(validRetainedTable(table),false);assert.equal(validRetainedTable({version:3,selection:{columns:'all',offset:0,count:null,includeExcluded:false}}),true);assert.match(retainedTableView(table,String),/observanda.complex v1/);});
