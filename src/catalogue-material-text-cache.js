// Reuse only small, local, immutable sequence envelopes in one reader snapshot.
// The caller must load the encrypted row before lookup, then authenticate and
// check its expected revision before admitting the original decoded envelope.
// Resolved ownership locations must never be admitted here.
import {catalogueContext} from './catalogue-context.js';
import {metadataBatchIndex} from './metadata-batch.js';
import {databaseRequestSignal} from './database-request-context.js';

const receipts=new WeakMap(),MAX_ENTRY_BYTES=16*1024;
const sequenceId=/^metadata:\.observanda\/materials\/sequences\/(?:nodes|chunks)\/[a-f0-9]{64}\.json$/;
const revisionId=/^[a-f0-9]{64}$/;
function scope(store,id,revision){
 databaseRequestSignal()?.throwIfAborted();
 const cache=store?.readCache,workspace=store?.workspace;
 if(!cache||!store.db||typeof id!=='string'||!sequenceId.test(id)||typeof revision!=='string'||!revisionId.test(revision)||
    catalogueContext.getStore()?.db===store.db||metadataBatchIndex(store)||!Buffer.isBuffer(workspace?.vault?.key)||
    typeof workspace.root!=='string'||typeof store.aad!=='function')return null;
 const slot='object:'+id;
 // A row evicted or too large to retain cannot lend an older decoded receipt.
 if(!cache.rows.has(slot))return null;
 return {cache,slot,db:store.db,root:workspace.root,projectId:workspace.projectId??null,labBookId:workspace.labBookId??null,
  key:cache.encryptionKey(workspace.vault.key),aad:store.aad('object',id),revision};
}
export function cachedMaterialText(store,id,revision){
 const owner=scope(store,id,revision);if(!owner)return null;
 const value=owner.cache.node(owner.slot),proof=value&&receipts.get(value);
 if(!proof||proof.cache!==owner.cache||proof.slot!==owner.slot||proof.db!==owner.db||proof.root!==owner.root||proof.projectId!==owner.projectId||
    proof.labBookId!==owner.labBookId||proof.key!==owner.key||proof.aad!==owner.aad||proof.revision!==owner.revision)return null;
 return {text:value.text};
}
export function rememberMaterialText(store,id,revision,value){
 const owner=scope(store,id,revision);if(!owner)return false;
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==1||
    typeof Object.getOwnPropertyDescriptor(value,'text')?.value!=='string')return false;
 // Include UTF-16 text and identity storage plus a conservative receipt overhead.
 // These entries compete with index nodes inside the existing count/byte bounds.
 const bytes=256+2*(value.text.length+owner.slot.length+owner.aad.length+revision.length+owner.root.length+
  (owner.projectId?.length??0)+(owner.labBookId?.length??0));
 if(bytes>Math.min(MAX_ENTRY_BYTES,owner.cache.maxBytes))return false;
 const frozen=Object.freeze({text:value.text});receipts.set(frozen,owner);
 owner.cache.keepNode(owner.slot,frozen,bytes);return true;
}
