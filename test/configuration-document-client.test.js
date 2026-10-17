import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {configurationDocumentClient} from '../src/web/configuration-document-client.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ids=()=>({workspaceId:randomUUID(),projectId:randomUUID(),notebookId:randomUUID(),slot:'configuration'});
const receipt=(owner,draft=null)=>({native:true,configurationPin:{workspaceId:owner.workspaceId,projectId:owner.projectId,notebookId:owner.notebookId,slot:owner.slot,snapshotId:hash('snapshot'),revision:hash('configuration')},header:{counts:{profiles:0,sections:1,fields:0,choices:0}},draft});
const unavailable=()=>Object.assign(Error('Synthetic lost acknowledgement'),{code:'IO'});

test('selected configuration changes preserve newer typing and exact lost-acknowledgement identities',async t=>{
 const owner=ids(),state={storage:{contextId:'local'},book:{id:owner.workspaceId}},calls=[],replays=new Map();let envelope=receipt(owner),generation=0,latest='',loseChange=true,release,entered;
 const held=new Promise(resolve=>entered=resolve);
 const client=configurationDocumentClient({state,api:async(route,command)=>{
  const operation=route.split('/').at(-1);calls.push({operation,command:structuredClone(command)});
  if(operation==='open')return structuredClone(envelope);
  if(replays.has(command.commandId))return structuredClone(replays.get(command.commandId));
  assert.equal(command.expectedRevision,envelope.draft?.revision??null);
  if(operation==='change'){
   latest=command.operations[0].value.label;envelope=receipt(owner,{id:envelope.draft?.id??randomUUID(),revision:hash(++generation),dirty:true});replays.set(command.commandId,structuredClone(envelope));
   if(loseChange){loseChange=false;entered();await new Promise(resolve=>release=resolve);throw unavailable();}
  }else if(operation==='save'){envelope=receipt(owner);replays.set(command.commandId,structuredClone(envelope));}
  else throw Error('Unexpected '+operation);
  return structuredClone(envelope);
 }});
 t.after(()=>client.stop());await client.open(owner);
 client.changed({type:'replace',collection:'sections',key:'selected',value:{label:'First'}});
 const first=client.flush(),rejected=assert.rejects(first,/Synthetic/);await held;
 client.changed({type:'replace',collection:'sections',key:'selected',value:{label:'Typed during the request'}});release();await rejected;
 assert.equal(client.isDirty(),true);await client.save();assert.equal(client.isDirty(),false);assert.equal(latest,'Typed during the request');
 const writes=calls.filter(call=>call.operation==='change');assert.equal(writes.length,3);assert.deepEqual(writes[1].command,writes[0].command);assert.notEqual(writes[2].command.commandId,writes[0].command.commandId);assert.equal(writes[2].command.operations[0].value.label,'Typed during the request');
});

test('selected configuration cancellation is read-only when pristine and retries the exact durable discard',async t=>{
 const owner=ids(),state={storage:{contextId:'local'},book:{id:owner.workspaceId}},calls=[],history=new Map();let envelope=receipt(owner),lose=true;
 const client=configurationDocumentClient({state,api:async(route,command)=>{
  const operation=route.split('/').at(-1);calls.push({operation,command:structuredClone(command)});
  if(operation==='open')return structuredClone(envelope);
  if(history.has(command.commandId))return structuredClone(history.get(command.commandId));
  if(operation==='change')envelope=receipt(owner,{id:randomUUID(),revision:hash('draft'),dirty:true});
  else if(operation==='discard'){assert.equal(command.expectedRevision,envelope.draft.revision);envelope=receipt(owner);}
  else throw Error('Unexpected '+operation);
  history.set(command.commandId,structuredClone(envelope));if(operation==='discard'&&lose){lose=false;throw unavailable();}return structuredClone(envelope);
 }});
 t.after(()=>client.stop());await client.open(owner);await client.discard();assert.deepEqual(calls.map(call=>call.operation),['open']);
 client.changed({type:'replace',collection:'sections',key:'selected',value:{label:'Unwanted edit'}});await client.flush();await assert.rejects(client.discard(),/Synthetic/);assert.equal(client.isDirty(),true);await client.discard();assert.equal(client.isDirty(),false);
 const discarded=calls.filter(call=>call.operation==='discard');assert.equal(discarded.length,2);assert.deepEqual(discarded[0].command,discarded[1].command);
});

test('superseded configuration reads cannot install a different owner or draft page',async t=>{
 const owner=ids(),other=ids(),state={storage:{contextId:'local'},book:{id:owner.workspaceId}};let release,entered;const held=new Promise(resolve=>entered=resolve);
 const client=configurationDocumentClient({state,api:async(route,command)=>{
  if(route.endsWith('/open'))return receipt(command);
  entered();return new Promise(resolve=>release=()=>resolve({...receipt(owner),rows:[],offset:0,total:0,next:null}));
 }});
 t.after(()=>client.stop());await client.open(owner);const page=client.window('sections'),aborted=assert.rejects(page,{name:'AbortError'});await held;await client.open(other);release();await aborted;assert.equal(client.descriptor().configurationPin.workspaceId,other.workspaceId);
});
