import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerRuntimeStorage,inheritRuntimeStorage,runtimeStorageDirectory} from '../src/database-runtime-environment.js';
test('managed storage authority propagates explicitly and retires every environment alias',()=>{
 const source={OBSERVANDA_DATABASE_URL:'managed-test-endpoint'},alias={...source},untrusted={...source,OBSERVANDA_WORKSPACE_DATABASE_ROOT:'untrusted'};
 assert.equal(runtimeStorageDirectory(source),null);const retire=registerRuntimeStorage(source,'admitted-directory');assert.equal(runtimeStorageDirectory(source),'admitted-directory');assert.equal(runtimeStorageDirectory(alias),null);assert.equal(runtimeStorageDirectory(untrusted),null);
 inheritRuntimeStorage(source,alias);assert.equal(runtimeStorageDirectory(alias),'admitted-directory');alias.OBSERVANDA_DATABASE_URL='another-endpoint';assert.equal(runtimeStorageDirectory(alias),null);alias.OBSERVANDA_DATABASE_URL=source.OBSERVANDA_DATABASE_URL;
 retire();assert.equal(runtimeStorageDirectory(source),null);assert.equal(runtimeStorageDirectory(alias),null);const next=registerRuntimeStorage(source,'new-directory');assert.equal(runtimeStorageDirectory(alias),null);inheritRuntimeStorage(source,alias);retire();assert.equal(runtimeStorageDirectory(alias),'new-directory');next();assert.equal(runtimeStorageDirectory(alias),null);
});
