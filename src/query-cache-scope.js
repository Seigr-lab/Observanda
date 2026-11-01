import {AsyncLocalStorage} from 'node:async_hooks';
import {onVaultRetire,retireVault,drainRetiredVault} from './vault-lifecycle.js';
import {AppError} from './errors.js';
const context=new AsyncLocalStorage(),owners=new WeakMap();let serial=0;
function generation(owner){let value=owners.get(owner);if(!value||value.retired){value={id:++serial,retired:false};owners.set(owner,value);}return value;}
// Session tokens contain no source keys. A fresh request must still authenticate
// every selected owner; these tokens only bound the life of derived results.
export function withQueryCacheScope(application,client,grants,operation){
 const inherited=context.getStore(),tokens=[generation(application),generation(application.session(client))],vault=application.workspace.vault;
 const saved=[...new Set([...(inherited?.grants??[]),...grants].filter(value=>value?.vault))],expires=Math.min(Infinity,...saved.map(value=>value.expires));
 return context.run({tokens,vault,grants:saved,expires},operation);
}
// A source service can add its own retirement generation and stable external
// grant witnesses while preserving the enclosing application's authorization.
export function withQueryCacheOwner(owner,grants,operation){
 const inherited=context.getStore(),saved=[...new Set([...(inherited?.grants??[]),...grants].filter(value=>value?.vault))];
 return context.run({tokens:[...(inherited?.tokens??[]),generation(owner)],vault:inherited?.vault,grants:saved,expires:Math.min(inherited?.expires??Infinity,...saved.map(value=>value.expires??Infinity))},operation);
}
export const currentQueryCacheScope=()=>context.getStore();
export function assertQueryCacheScope(scope){if(scope&&(scope.tokens.some(token=>token.retired)||scope.expires<=Date.now()||scope.grants.some(value=>!Buffer.isBuffer(value.vault?.key))))throw new AppError('ACCESS_LOCKED');}
export function onQueryCacheScopeRetire(scope,retire){const releases=[...scope.tokens,...scope.grants.map(value=>value.vault)].map(owner=>onVaultRetire(owner,retire));return ()=>{for(const release of releases)release();};}
export function retireQueryCacheScope(owner){const token=owners.get(owner);if(!token)return Promise.resolve();token.retired=true;retireVault(token);const drain=drainRetiredVault(token);void drain.catch(()=>{});return drain;}
