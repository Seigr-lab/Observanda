import {materialRequest} from '../src/material-requests.js';
import {projectRequest} from '../src/project-application.js';
import {workspaceSnapshotRequest} from '../src/workspace-read-admission.js';
import {comparisonFixture} from './analysis-comparison-fixture.js';
import {prepareComparisonAdmission} from '../src/comparison-job-admission.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ComparisonJobAccess} from '../src/comparison-job-access.js';
import {AppError} from '../src/errors.js';
import {comparisonRouteWitness} from '../src/comparison-route-witness.js';
import {databaseCapacity} from '../src/postgres.js';
test('comparison capabilities bind the exact result namespace, job and immutable command',()=>{
 const grants=new ComparisonJobAccess(),namespace=randomUUID(),id=randomUUID(),command={input:'retained revision'},open=()=>{};
 grants.bind(namespace,id,command,open);
 assert.throws(()=>grants.take(randomUUID(),{id,input:{command}}),{code:'ANALYSIS_SOURCE_ACCESS'});
 assert.equal(grants.take(namespace,{id,input:{command}}),open);
 assert.throws(()=>grants.take(namespace,{id,input:{command}}),{code:'ANALYSIS_SOURCE_ACCESS'});
 grants.bind(namespace,id,command,open);
 assert.throws(()=>grants.take(namespace,{id,input:{command:{input:'different revision'}}}),{code:'ANALYSIS_SOURCE_ACCESS'});
});
test('another worker consumes only the initiating client capability; restart grants nothing',async()=>{
 const grants=new ComparisonJobAccess(),namespace=randomUUID(),job={id:randomUUID(),input:{command:{version:2}}};let allowed=true;
 grants.bind(namespace,job.id,job.input.command,async()=>{if(!allowed)throw new AppError('ACCESS_LOCKED');return 'initiator';});
 const admitted=grants.take(namespace,job);allowed=false;
 await assert.rejects(admitted(),{code:'ACCESS_LOCKED'});
 assert.throws(()=>new ComparisonJobAccess().take(namespace,job),{code:'ANALYSIS_SOURCE_ACCESS'});
});
test('rollback removes only its own pending capability and cannot replace a live grant',()=>{
 const grants=new ComparisonJobAccess(),namespace=randomUUID(),id=randomUUID(),command={};
 const rollback=grants.bind(namespace,id,command,()=>1);
 assert.throws(()=>grants.bind(namespace,id,command,()=>2),{code:'JOB_CHANGED'});
 rollback();grants.bind(namespace,id,command,()=>3);rollback();
 assert.equal(grants.take(namespace,{id,input:{command}})(),3);
});

test('a different result worker cannot use an originating result grant after revocation',{timeout:90000},async t=>{
 const f=await comparisonFixture(t,{groups:1}),command=structuredClone(f.command);command.comparison.version=2;command.comparison.sources[0].dataset.workspaceId=f.book.id;
 let allowed=true,opened=0,closed=0;const baseline=databaseCapacity().active,owner={workspaceId:f.book.id,projectId:null,labBookId:null},readers=[];
 const sourceAccess=async storage=>{
  opened++;const routes=comparisonRouteWitness({root:null,changes:async function*(){},locate:async()=>owner});readers.push(routes);
  return {use:async(ref,consume)=>{await routes.observe(ref,owner);return consume(storage,ref);},verify:()=>routes.verify(null),verifyGrants:async()=>{},captureRoutes:refs=>routes.capture(refs),assertRoutes:value=>routes.assert(value),close:async()=>{closed++;await routes.close();}};
 };
 const check=async()=>{if(!allowed)throw new AppError('ACCESS_LOCKED');};
 const admission=await prepareComparisonAdmission(f.m,command,{sourceAccess,check}),grants=new ComparisonJobAccess(),job={id:randomUUID(),input:{command}};
 grants.bind(f.book.id,job.id,command,admission.open);await admission.close();assert.equal(closed,1);
 assert.equal(databaseCapacity().active,baseline);await assert.rejects(readers[0].capture([command.comparison.sources[0].dataset]),{code:'WORKSPACE_CHANGED'});
 const open=grants.take(f.book.id,job);allowed=false;await assert.rejects(open(f.workspace),{code:'ACCESS_LOCKED'});assert.equal(opened,1);
 allowed=true;const access=await open(f.workspace);await access.verify();allowed=false;await assert.rejects(access.verify(),{code:'ACCESS_LOCKED'});await access.close();assert.equal(closed,2);
 assert.equal(databaseCapacity().active,baseline);
});

test('retained source discovery and result pages use read admission at every owner route',()=>{
 const project=randomUUID(),book=randomUUID();
 for(const action of ['source-owners','source-items','source-resolve','comparison-page']){
  const route='/api/research/materials/'+action;
  assert.equal(materialRequest(route).write,false);assert.equal(workspaceSnapshotRequest('POST',route),true);
  assert.equal(projectRequest('/api/projects/'+project+route.slice(4),'POST').write,false);
  assert.equal(projectRequest('/api/projects/'+project+'/lab-books/'+book+route.slice(4),'POST').write,false);
 }
});
