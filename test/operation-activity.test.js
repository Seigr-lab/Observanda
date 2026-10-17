import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {OperationActivity} from '../src/operation-activity.js';
import {operationResponse} from '../src/operation-response.js';
import {operationStage,operationAdvance} from '../src/operation-progress.js';
import {requestWriterWait,queuedWriter,waitForWriter} from '../src/writer-wait.js';
import {AppError} from '../src/errors.js';

class Response extends EventEmitter{
 constructor(){super();this.destroyed=false;this.writableEnded=false;this.events=[];}
 setTimeout(){} writeHead(){} write(line){this.events.push(JSON.parse(line));return true;} end(){this.writableEnded=true;}
}
test('activity survives a disconnected response, isolates scopes and only completes after the command',async()=>{
 const registry=new OperationActivity(),res=new Response(),req={socket:{timeout:60000,setTimeout(){}},headers:{accept:'application/x-ndjson'},operationActivity:()=>registry.begin('a','/api/storage/copy')};
 let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
 const pending=operationResponse(req,res,()=>operationStage('copy-files',{unit:'files',total:2},async()=>{operationAdvance();entered();await gate;operationAdvance();return {secret:'never in activity'};}),()=>{});
 await ready;res.destroyed=true;res.emit('close');
 assert.equal(registry.list('b').length,0);assert.equal(registry.list('a')[0].state,'running');
 registry.clear('a');assert.equal(registry.list('a').length,1);
 registry.relocate('a','b');assert.equal(registry.list('a').length,0);
 release();await pending;assert.equal(registry.list('b')[0].state,'completed');assert.ok(!JSON.stringify(registry.list('b')).includes('secret'));
 registry.clear('b');assert.equal(registry.list('b').length,0);
});
test('JSON clients are observed too and failed operations retain a safe failure receipt',async()=>{
 const registry=new OperationActivity(),res=new Response(),req={socket:{setTimeout(){}},headers:{},operationActivity:()=>registry.begin('a','/api/research/records/save')};
 await assert.rejects(operationResponse(req,res,async()=>{throw new AppError('CONFLICT',['secret input']);},()=>{}),{code:'CONFLICT'});
 const [entry]=registry.list('a');assert.equal(entry.state,'failed');assert.equal(entry.error.code,'CONFLICT');assert.ok(!JSON.stringify(entry).includes('secret input'));
});
test('job heartbeats do not invent progress or expose input, results and leases',()=>{
 const registry=new OperationActivity(),job={id:'one',type:'dataset.prepare',state:'running',input:{secret:true},result:{secret:true},lease:{secret:true},progress:{stage:'Reading rows',done:2,total:7}};
 registry.job('a',job);const first=registry.list('a')[0];registry.job('a',job);assert.equal(registry.list('a')[0].progress.advancedAt,first.progress.advancedAt);
 registry.job('a',{...job,state:'failed',error:'DATASET_JOIN_LENGTH'});
 const last=registry.list('a')[0];assert.equal(last.error.code,'DATASET_JOIN_LENGTH');assert.equal(last.state,'failed');assert.ok(!JSON.stringify(last).includes('secret'));
});
test('structure progress retains measured row counts and the last meaningful stage',()=>{
 const registry=new OperationActivity(),operation=registry.begin('a','/api/workspace/structure');
 operation.progress({stage:'records',loaded:37,total:80});operation.progress({stage:'preparing'});operation.finish();
 const [entry]=registry.list('a');assert.equal(entry.progress.completed,37);assert.equal(entry.progress.stage,'records');assert.equal(entry.state,'completed');
});

test('activity retains only internal owning views and storage always returns to storage',()=>{
 const registry=new OperationActivity();
 for(const view of ['https://example.com','#/preferences/general?secret=private','javascript:alert(1)','#/modules/scientific-calculator/calculation'])registry.begin('a','/api/modules/drafts/write',{view});
 registry.begin('a','/api/storage/copy',{view:'#/workspace'});
 assert.deepEqual(registry.list('a').map(entry=>entry.view),[null,null,null,'#/modules/scientific-calculator/calculation','#/preferences/storage']);
 assert.ok(!JSON.stringify(registry.list('a')).includes('secret'));
});


test('module activity belongs to its lists and editors without crossing module boundaries',async()=>{
 const {activityViewMatches}=await import('../src/web/activity-owner.js');
 assert.equal(activityViewMatches('#/modules/planning','#/modules/planning/scope/workspace/subscription'),true);
 assert.equal(activityViewMatches('#/modules/planning','#/modules/planning'),true);
 assert.equal(activityViewMatches('#/modules/planning','#/modules/planning-other'),false);
 assert.equal(activityViewMatches('#/modules/planning','#/preferences/storage'),false);
 assert.equal(activityViewMatches(null,'#/preferences/storage'),false);
 assert.equal(activityViewMatches('#/preferences/storage','#/preferences/storage'),true);
});

test('project activity identifies only writers belonging to the same project',async()=>{
 const {activityResource,activityCommand}=await import('../src/web/activity-owner.js');
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
 assert.equal(activityResource('/api/projects/'+a+'/research/records/writing/save'),activityResource('/api/projects/'+a+'/research/records/save'));
 assert.notEqual(activityResource('/api/projects/'+a+'/research/records/save'),activityResource('/api/projects/'+b+'/research/records/save'));
 assert.notEqual(activityResource('/api/projects/'+a+'/research/records/save'),activityResource('/api/storage/copy'));
 assert.equal(activityCommand('/api/projects/'+a+'/research/records/save'),'/api/research/records/save');
 assert.equal(activityCommand('/api/storage/move'),'/api/storage/move');
});


test('successful command recovery resolves only earlier failures for that identity and scope',()=>{
 const registry=new OperationActivity(),recoveryKey='project-create:11111111-1111-4111-8111-111111111111',other='project-create:22222222-2222-4222-8222-222222222222';
 registry.begin('a','/api/projects/create',{recoveryKey}).finish(new AppError('ACCESS_DENIED'));
 registry.begin('a','/api/projects/create',{recoveryKey:other}).finish(new AppError('CONFLICT'));
 registry.begin('b','/api/projects/create',{recoveryKey}).finish(new AppError('ACCESS_DENIED'));
 registry.begin('a','/api/projects/create/resume',{recoveryKey}).finish();
 const values=registry.list('a');assert.equal(values[0].state,'failed');assert.ok(values[0].resolvedAt);assert.equal(values[1].resolvedAt,undefined);assert.equal(registry.list('b')[0].resolvedAt,undefined);assert.ok(!JSON.stringify(values).includes(recoveryKey));assert.equal(values[0].commandId,'11111111-1111-4111-8111-111111111111');
 registry.begin('a','/api/projects/create/resume',{recoveryKey}).finish(new AppError('CONFLICT'));assert.equal(registry.list('a').at(-1).resolvedAt,undefined);
 registry.clear('a');assert.equal(registry.list('a').length,0);assert.equal(registry.list('b').length,1);
});


test('retrying the same command replaces its current failure without claiming recovery or hiding unrelated failures',()=>{
 const registry=new OperationActivity(),recoveryKey='project-open:11111111-1111-4111-8111-111111111111';
 registry.begin('a','/api/projects/open',{recoveryKey}).finish(new AppError('ACCESS_DENIED'));registry.begin('a','/api/projects/create').finish(new AppError('CONFLICT'));
 const retry=registry.begin('a','/api/projects/open',{recoveryKey}),running=registry.list('a');assert.equal(running[0].supersededBy,running[2].id);assert.equal(running[0].resolvedAt,undefined);assert.equal(running[1].supersededBy,undefined);
 retry.finish(new AppError('ACCESS_DENIED'));assert.equal(registry.list('a').at(-1).supersededBy,undefined);assert.equal(registry.list('a').at(-1).resolvedAt,undefined);
 registry.begin('a','/api/projects/open',{recoveryKey}).finish();assert.ok(registry.list('a')[0].resolvedAt);assert.ok(registry.list('a')[2].resolvedAt);assert.equal(registry.list('a')[1].resolvedAt,undefined);
});

for(const streamed of [false,true])test('durable '+(streamed?'streamed':'JSON')+' command keeps later writes after disconnection and retains access checks',async()=>{
 const activity=new OperationActivity(),res=new Response();let checks=0,allowed=true,entered,release;
 const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const req={socket:{timeout:60000,setTimeout(){}},headers:streamed?{accept:'application/x-ndjson'}:{},waitForWriter:true,checkWriter:async()=>{checks++;if(!allowed)throw new AppError('ACCESS_LOCKED');},operationActivity:()=>activity.begin('a','/api/projects/open')};
 const running=requestWriterWait(req,res,()=>operationResponse(req,res,async({signal})=>{
  assert.equal(signal,undefined);await queuedWriter('durable',async()=>waitForWriter(async()=>{}));entered();await gate;
  await queuedWriter('durable',async()=>waitForWriter(async()=>{}));allowed=false;
  await assert.rejects(queuedWriter('durable',async()=>assert.fail('Revoked writer admitted')),{code:'ACCESS_LOCKED'});
  return {ok:true};
 },()=>{}, {continueAfterDisconnect:true}));
 await ready;res.destroyed=true;res.emit('close');release();await running;assert.ok(checks>=4);assert.equal(activity.list('a')[0].state,'completed');
});

test('project progress follows the selected project across owner routes',async()=>{
 const {activityOwner,activityViewMatches}=await import('../src/web/activity-owner.js');
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',view='#/projects/'+a;
 assert.equal(activityOwner('/api/projects/open',view),view);
 assert.equal(activityViewMatches(view,'#/owners/'+a+'/projects/'+a),true);
 assert.equal(activityViewMatches(view,'#/owners/'+b+'/projects/'+a),false);
 assert.equal(activityViewMatches(view,'#/preferences/storage'),false);
});

test('reacquiring a writer retains the active stage and restores it after a wait',()=>{
 const activity=new OperationActivity(),operation=activity.begin('a','/api/projects/open');
 operation.progress({stage:'activate-destination',completed:7,total:9,unit:'items'});operation.running();assert.equal(activity.list('a')[0].progress.stage,'activate-destination');
 operation.waiting();operation.progress({stage:'waiting-writer',completed:0,unit:'items'});operation.running();
 const [entry]=activity.list('a');assert.equal(entry.state,'running');assert.equal(entry.progress.stage,'activate-destination');assert.equal(entry.progress.completed,7);assert.equal(entry.progress.total,9);
});


test('lab book progress identifies its own writer and returns deletion to the containing project',async()=>{
 const {activityOwner,activityResource,activityCommand,activityViewMatches}=await import('../src/web/activity-owner.js');
 const project='11111111-1111-4111-8111-111111111111',a='22222222-2222-4222-8222-222222222222',b='33333333-3333-4333-8333-333333333333';
 const base='/api/projects/'+project,first=base+'/lab-books/'+a,second=base+'/lab-books/'+b;
 assert.notEqual(activityResource(first+'/research/records/save'),activityResource(second+'/research/records/save'));
 assert.notEqual(activityResource(first+'/research/records/save'),activityResource(base+'/workspace/structure'));
 assert.equal(activityCommand(first+'/research/records/save'),'/api/research/records/save');
 assert.equal(activityCommand(first+'/storage/delete/resume'),'/api/storage/delete/resume');
 assert.equal(activityViewMatches(activityOwner(first+'/storage/delete','#/preferences'), '#/owners/'+project+'/projects/'+project),true);
 assert.equal(activityViewMatches(activityOwner(base+'/lab-books/import/resume','#/preferences'), '#/owners/'+project+'/projects/'+project),true);
});


test('an unmet access prerequisite creates no failed activity, while an admitted failure stays visible',async()=>{
 const registry=new OperationActivity(),res=new Response(),req={socket:{setTimeout(){}},headers:{},operationActivity:()=>registry.begin('scope','/api/projects/selected/storage/delete')};
 const access=new AppError('ACCESS_LOCKED');access.operationNotStarted=true;
 await assert.rejects(operationResponse(req,res,async()=>{throw access;},()=>{}),{code:'ACCESS_LOCKED'});
 assert.deepEqual(registry.list('scope'),[]);assert.equal(registry.failureSequence,0);
 await assert.rejects(operationResponse(req,res,async()=>{throw new AppError('ACCESS_LOCKED');},()=>{}),{code:'ACCESS_LOCKED'});
 assert.equal(registry.list('scope')[0].state,'failed');assert.equal(registry.failureSequence,1);
});


test('a recovered cancelled move returns its receipt and records cancellation without a failed activity',async()=>{
 const {recordOwnerTransferCompletionError}=await import('../src/record-owner-transfer-application.js');
 const registry=new OperationActivity(),res=new Response(),req={socket:{timeout:60000,setTimeout(){}},headers:{},operationActivity:()=>registry.begin('a','/api/research/records/transfer/resume')},receipt={phase:'cancelled'};
 const result=await operationResponse(req,res,async()=>receipt,value=>value,{completionError:recordOwnerTransferCompletionError});
 assert.equal(result,receipt);assert.equal(registry.list('a')[0].state,'cancelled');assert.equal(registry.list('a')[0].error.code,'RECORD_TRANSFER_CANCELLED');assert.equal(registry.failureSequence,0);
 assert.equal(recordOwnerTransferCompletionError({phase:'complete'}),null);
});
