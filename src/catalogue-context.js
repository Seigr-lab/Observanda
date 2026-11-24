// Connection epochs only invalidate transaction-local caches; they contain no
// source data or admission proof.
import {AsyncLocalStorage} from 'node:async_hooks';
// Shared writer identity stays independent of catalogue and block-store imports.
export const catalogueContext=new AsyncLocalStorage();
const epochs=new WeakMap();
export const withoutCatalogueContext=operation=>catalogueContext.exit(operation);
export function catalogueCacheEpoch(db){
 let epoch=epochs.get(db);if(!epoch){epoch={};epochs.set(db,epoch);}return epoch;
}
