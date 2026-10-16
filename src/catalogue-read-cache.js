import {EncryptionKeyContext} from './encryption-key-context.js';
// Encrypted rows belong to one transaction and are discarded on close. Read
// snapshots are immutable; a metadata writer must replace its cached object
// payload whenever it stages a change. Whole decoded records never enter this cache.
export class CatalogueReadCache{
 #keys=new EncryptionKeyContext();
 encryptionKey(key){return this.#keys.get(key);}
 constructor({maxRows=128,maxBytes=256*1024,readAhead=false}={}){
  if(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>16384||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>16*1024*1024)throw new RangeError('Invalid catalogue cache capacity');
  this.maxRows=maxRows;this.maxBytes=maxBytes;this.readAhead=readAhead;this.rows=new Map();this.bytes=0;this.proofs=new Map();this.nodes=new Map();this.nodeBytes=0;
 }
 node(slot){
  const item=this.nodes.get(slot);if(!item)return null;
  this.nodes.delete(slot);this.nodes.set(slot,item);return item.value;
 }
 keepNode(slot,value,bytes){
  if(!Object.isFrozen(value)||bytes>Math.min(256*1024,this.maxBytes))return;
  this.forgetNode(slot);
  while(this.nodes.size>=this.maxRows||this.nodeBytes+bytes>this.maxBytes)this.forgetNode(this.nodes.keys().next().value);
  this.nodes.set(slot,{value,bytes});this.nodeBytes+=bytes;
 }
 forgetNode(slot){const item=this.nodes.get(slot);if(item){this.nodeBytes-=item.bytes;this.nodes.delete(slot);}}
 async prefetch(db,slots,{maxPayloadBytes=8192}={}){
  if(![8192,16384].includes(maxPayloadBytes)||!Array.isArray(slots)||slots.length>32||new Set(slots).size!==slots.length)throw new RangeError('Invalid catalogue read batch');
  const missing=slots.filter(slot=>!this.rows.has(slot));if(!missing.length)return;
  // A corrupt or unusually large node must travel alone through row(), never
  // multiply a batch's memory use. These encrypted bytes are not trust receipts.
  for(const row of await db.all('SELECT slot,payload FROM state WHERE slot=ANY($1::text[]) AND octet_length(payload)<='+maxPayloadBytes,missing))this.replace(row.slot,row.payload);
 }
 async row(slot,load){
  if(this.rows.has(slot)){const bytes=this.rows.get(slot);this.rows.delete(slot);this.rows.set(slot,bytes);return {payload:Buffer.from(bytes)};}
  const row=await load();if(!row?.payload)return row;
  this.replace(slot,row.payload);
  return row;
 }
 replace(slot,payload){
  this.forgetNode(slot);
  const prior=this.rows.get(slot);if(prior){this.bytes-=prior.length;prior.fill(0);this.rows.delete(slot);}
  if(!payload||payload.length>Math.min(256*1024,this.maxBytes))return;
  const bytes=Buffer.from(payload);
  while(this.rows.size>=this.maxRows||this.bytes+bytes.length>this.maxBytes){const [first,value]=this.rows.entries().next().value;this.rows.delete(first);this.bytes-=value.length;value.fill(0);}
  this.rows.set(slot,bytes);this.bytes+=bytes.length;
 }
 async proof(identity,verify){
  if(this.proofs.has(identity))return this.proofs.get(identity);
  // A proof can retain a bounded identity receipt, never an entire document.
  const receipt=await verify();if(receipt!==undefined&&(typeof receipt!=='string'||receipt.length>1024))throw new RangeError('Invalid catalogue proof receipt');
  if(this.proofs.size===128)this.proofs.delete(this.proofs.keys().next().value);this.proofs.set(identity,receipt);return receipt;
 }
 clear(){this.#keys.clear();for(const bytes of this.rows.values())bytes.fill(0);this.rows.clear();this.proofs.clear();this.nodes.clear();this.bytes=0;this.nodeBytes=0;}
}
