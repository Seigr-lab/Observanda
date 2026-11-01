import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {registerHooks} from 'node:module';
import {randomUUID} from 'node:crypto';

test('runtime guard preserves explicit recovery identities and refuses conflicting transfer scope identities',async()=>{
 const key='runtimeAdmission_'+randomUUID().replaceAll('-',''),url=new URL('../src/postgres-runtime-guard.js?admission='+key,import.meta.url).href,received=[];let scope;
 globalThis[key]={scope:()=>scope,admit:options=>{received.push(options);return options;}};
 const hooks=registerHooks({resolve(specifier,context,next){if(context.parentURL===url&&['./native-destination.js','./windows-postgres-runtime-guard.js','./posix-postgres-runtime-guard.js'].includes(specifier))return {url:'guard-admission:'+key+specifier,shortCircuit:true};return next(specifier,context);},load(value,context,next){if(value.startsWith('guard-admission:'+key))return {format:'module',shortCircuit:true,source:value.endsWith('native-destination.js')?'export const nativeDestination=globalThis['+JSON.stringify(key)+'].scope;':'export const acquireWindowsPostgresRuntimeGuard=globalThis['+JSON.stringify(key)+'].admit;export const acquirePosixPostgresRuntimeGuard=acquireWindowsPostgresRuntimeGuard;'};return next(value,context);}});
 try{
  const {acquirePostgresRuntimeGuard}=await import(url),directory=path.resolve('synthetic-runtime'),expected={directory,parentIdentity:'1:2',expectedIdentity:'1:3'};
  await acquirePostgresRuntimeGuard(expected);assert.deepEqual(received.at(-1),expected);
  const transfer=(parent,root)=>({member:(_file,operation)=>operation({identity:parent,stat:async()=>root?{identity:root}:null},'runtime')});
  scope=transfer('1:2','1:3');await acquirePostgresRuntimeGuard(expected);assert.deepEqual(received.at(-1),expected);
  await acquirePostgresRuntimeGuard({directory});assert.deepEqual(received.at(-1),expected);
  for(const [parent,root] of [['2:2','1:3'],['1:2','2:3'],['1:2',null]]){scope=transfer(parent,root);const before=received.length;await assert.rejects(acquirePostgresRuntimeGuard(expected),{code:'STORAGE_COPY'});assert.equal(received.length,before,'Conflicting recovery identity must refuse before platform admission');}
 }finally{hooks.deregister();delete globalThis[key];}
});
