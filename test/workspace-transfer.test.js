import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transferWorkspace} from '../src/web/workspace-transfer.js';

test('move response recovery requires its durable receipt and reports unfinished cleanup honestly',async()=>{
 for(const phase of ['verified','cleanup','complete',null]){
  const state={storage:{contextId:'source',root:'/source'}},receipt={root:'/destination',contextId:'target',available:true,move:phase?{source:'/source',destination:'/destination',phase}:null},calls=[];
  const api=async route=>{calls.push(route);if(route==='/api/storage/move')throw TypeError('Disconnected');return receipt;};
  const operation=transferWorkspace({api,state,destination:'/destination',route:'/api/storage/move',data:{id:'reviewed'}});
  if(phase)assert.equal((await operation).move.phase,phase);else await assert.rejects(operation);
  assert.deepEqual(calls,['/api/storage/move','/api/storage']);
 }
});

test('copy response recovery requires the reviewed destination to be activated in the same UI context',async()=>{
 const destination='/reviewed-copy',route='/api/storage/copy',data={id:'reviewed'},network=new TypeError('Connection interrupted');
 for(const change of ['success','other-destination','same-context','unavailable','newer-ui','unreadable']){
  const state={storage:{contextId:'source-context'}},calls=[];
  const api=async path=>{
   calls.push(path);if(path===route)throw network;if(change==='unreadable')throw network;
   if(change==='newer-ui')state.storage.contextId='another-open-workspace';
   return {root:change==='other-destination'?'/unrelated':destination,available:change!=='unavailable',contextId:change==='same-context'?'source-context':'copied-context'};
  };
  const operation=transferWorkspace({api,state,destination,route,data});
  if(change==='success')assert.equal((await operation).contextId,'copied-context');else await assert.rejects(operation);
  assert.deepEqual(calls,[route,'/api/storage'],'Recovery only reads status, never repeats the write');
 }
});

test('reported copy failures keep their specific error and never infer completion',async()=>{
 for(const code of ['STORAGE_FULL','ENCRYPTION_DAMAGED','STORAGE_INCOMPLETE','ACCESS_LOCKED']){
  const error=Object.assign(Error(code),{code});let calls=0;
  await assert.rejects(transferWorkspace({api:async()=>{calls++;throw error;},state:{storage:{contextId:'original'}},destination:'/copy',route:'/api/storage/encrypt',data:{}}),value=>value===error);
  assert.equal(calls,1);
 }
});
