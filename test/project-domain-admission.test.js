import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readProjectDomainRegistry} from '../src/project-domain-registry.js';
import {catalogueRequiresDomains} from '../src/catalogue-format.js';
function empty(format,project){return {workspace:project?{projectId:'selected-project'}:{},db:{all:async sql=>{assert.equal(sql,'SELECT version FROM catalogue_format');return [{version:format}];},get:async(sql,slot)=>{assert.equal(sql,'SELECT payload FROM state WHERE slot=$1');assert.equal(slot,'project-domains');return null;}},snapshot(){assert.fail('An absent optional domain must not read research');}};}
test('directory and other feature generations require a domain manifest only when their owner flag declares it',async()=>{
 for(let format=50;format<=1657;format++)for(const project of [false,true]){
  if(catalogueRequiresDomains(format))await assert.rejects(readProjectDomainRegistry(empty(format,project)),{code:'CATALOGUE_DAMAGED'});
  else assert.equal(await readProjectDomainRegistry(empty(format,project)),null);
 }
});
test('earlier project admission still detects a missing required domain manifest',async()=>{
 for(let format=3;format<50;format++)for(const project of [false,true]){
  if(catalogueRequiresDomains(format)||project&&format>=22)await assert.rejects(readProjectDomainRegistry(empty(format,project)),{code:'CATALOGUE_DAMAGED'});
  else assert.equal(await readProjectDomainRegistry(empty(format,project)),null);
 }
});
