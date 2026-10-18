// Connection epochs only invalidate transaction-local caches; they contain no
// source data or admission proof. An explicit commit callback cannot cache a
// proof before its next transaction has acquired its own owner/read lifetime.
import {AsyncLocalStorage} from 'node:async_hooks';
// Shared writer identity stays independent of catalogue and block-store imports.
export const catalogueContext=new AsyncLocalStorage();
const epochs=new WeakMap(),suspended=new AsyncLocalStorage();
export function catalogueCacheEpoch(db){
 if(suspended.getStore()?.has(db))return null;
 let epoch=epochs.get(db);if(!epoch){epoch={};epochs.set(db,epoch);}return epoch;
}
export async function withCatalogueCacheBoundary(store,operation){
 const db=store.db,excluded=new Set(suspended.getStore());excluded.add(db);epochs.delete(db);
 try{return await suspended.run(excluded,operation);}
 finally{epochs.delete(db);}
}
