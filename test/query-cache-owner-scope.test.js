import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {withQueryCacheScope,withQueryCacheOwner,currentQueryCacheScope,assertQueryCacheScope,onQueryCacheScopeRetire,retireQueryCacheScope} from '../src/query-cache-scope.js';
import {clearVault} from '../src/encryption.js';
const vault=()=>({id:randomUUID(),key:randomBytes(32)});
test('source cache scopes retain parent admission and drain on external grants or source generations',async()=>{
 const owner={},session={},application={workspace:{vault:vault()},session:()=>session},parent={vault:vault(),expires:Date.now()+60000},external={vault:vault()};let scope,retired=0,release,unsubscribe;
 try{
  await withQueryCacheScope(application,{},[parent],()=>withQueryCacheOwner(owner,[external],async()=>{
   scope=currentQueryCacheScope();assert.equal(scope.vault,application.workspace.vault);assert.equal(scope.expires,parent.expires);assert.deepEqual(scope.grants,[parent,external]);assertQueryCacheScope(scope);
   unsubscribe=onQueryCacheScopeRetire(scope,()=>{retired++;return new Promise(resolve=>release=resolve);});
  }));
  let drained=false;const close=clearVault(external.vault).then(()=>{drained=true;});assert.equal(retired,1);assert.throws(()=>assertQueryCacheScope(scope),{code:'ACCESS_LOCKED'});await Promise.resolve();assert.equal(drained,false);release();await close;unsubscribe();
  external.vault=vault();await retireQueryCacheScope(owner);assert.throws(()=>assertQueryCacheScope(scope),{code:'ACCESS_LOCKED'});
  await withQueryCacheScope(application,{},[parent],()=>withQueryCacheOwner(owner,[external],async()=>{const fresh=currentQueryCacheScope();assertQueryCacheScope(fresh);assert.notEqual(fresh.tokens.at(-1),scope.tokens.at(-1));await retireQueryCacheScope(session);assert.throws(()=>assertQueryCacheScope(fresh),{code:'ACCESS_LOCKED'});}));
 }finally{unsubscribe?.();release?.();await Promise.all([clearVault(external.vault),clearVault(parent.vault),clearVault(application.workspace.vault),retireQueryCacheScope(owner)]);}
});
