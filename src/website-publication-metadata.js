import {AsyncLocalStorage} from 'node:async_hooks';
import {AppError} from './errors.js';

const journal='.observanda/file-publication-transaction.json';
// Publication destinations, file inventories and receipts sometimes need to
// advance together. The redo record is encrypted and uses the same native
// writer lease as changes to the website. It contains no website documents.
export function websitePublicationMetadata(base){
 const local=new AsyncLocalStorage();
 async function apply(rows){for(const [name,value] of rows){if(value===null)await base.removeMetadata(name);else await base.writeMetadata(name,value);}await base.removeMetadata(journal);}
 async function recover(){
  const text=await base.readMetadata(journal,32*1024*1024);if(text===null)return;
  const data=JSON.parse(text);
  if(data?.version!==1||!Array.isArray(data.rows)||data.rows.some(row=>!Array.isArray(row)||row.length!==2||row[0]===journal||typeof row[0]!=='string'||row[1]!==null&&typeof row[1]!=='string'))throw new AppError('LOCAL_EXPORT_DAMAGED');
  await apply(data.rows);
 }
 async function locked(operation){
  if(local.getStore())return operation();
  return base.withLock(async()=>{
   await recover();const pending=new Map(),result=await local.run(pending,operation);
   if(pending.size){const rows=[...pending],text=JSON.stringify({version:1,rows});if(Buffer.byteLength(text)>32*1024*1024)throw new AppError('LIMIT');await base.writeMetadata(journal,text);await apply(rows);}
   return result;
  });
 }
 return {...base,withLock:locked,withPublicationMetadataBatch:locked,withPublicationMetadataSnapshot:locked,
  // Keep the site writer across remote side effects, but commit every transfer
  // checkpoint to disk before the provider can change its branch or link.
  withTransferLease:operation=>base.withLock(async()=>{await locked(()=>{});return operation();}),
  readMetadata:(name,limit)=>locked(async()=>{const pending=local.getStore();if(!pending.has(name))return base.readMetadata(name,limit);const value=pending.get(name);if(value!==null&&limit!==undefined&&Buffer.byteLength(value)>limit)throw new AppError('LIMIT');return value;}),
  writeMetadata:(name,value)=>locked(async()=>{if(name===journal||typeof value!=='string')throw new AppError('INVALID');local.getStore().set(name,value);}),
  removeMetadata:name=>locked(async()=>{if(name===journal)throw new AppError('INVALID');local.getStore().set(name,null);})};
}
