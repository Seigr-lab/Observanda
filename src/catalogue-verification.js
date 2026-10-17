// Verification receipts live only for one repeatable-read catalogue audit.
// Nothing is trusted across audits or retained after its scratch transaction.
import {withScratch,withScratchSession} from './scratch-work.js';
import {digest,serialize} from './storage-format.js';
import {CatalogueReadCache} from './catalogue-read-cache.js';
import {withRecordEncodingAudit} from './record-document-encoding.js';
export function verificationContext(metadata){
 // These values cannot change current-format record validation or projection.
 // Earlier formats retain their complete context for historical upgrades.
 if(metadata.formatVersion!==21)return metadata;
 const {revision,updatedAt,...context}=metadata;void revision;void updatedAt;return context;
}
export async function withCatalogueVerification(store,operation){
 const {transaction_isolation:isolation}=await store.db.get('SHOW transaction_isolation');
 // A writer-owned READ COMMITTED transaction can observe newer external SQL
 // changes. Only a fixed database snapshot permits reusing earlier checks.
 if(!['repeatable read','serializable'].includes(isolation))return operation({once:(_identity,verify)=>verify()});
 const previous=store.readCache,cache=new CatalogueReadCache({maxRows:16384,maxBytes:16*1024*1024,readAhead:true});store.readCache=cache;
 try{return await withScratchSession(()=>withScratch(receipts=>withRecordEncodingAudit(store,receipts,()=>operation({
  stableSnapshot:true,
  async once(identity,verify){
   const key=digest(serialize(identity));if(await receipts.has(key))return;
   await verify();await receipts.add(key);
  }
 }))));}finally{cache.clear();store.readCache=previous;}
}
