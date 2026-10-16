// Append-only encrypted revision summaries. PostgreSQL indexes their opaque slots;
// no saved record list is rewritten when a new revision is appended.
import {AppError} from './errors.js';
import {digest,serialize} from './storage.js';
import {retainedRecordDisplay} from './record-history-display.js';
const validRevision=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const validItem=v=>v&&validRevision(v.revision)&&validRevision(v.snapshotId)&&(!v.view||validRevision(v.view.revision)&&typeof v.view.title==='string'&&typeof v.view.status==='string'&&typeof v.view.updatedAt==='string');
const same=(a,b)=>digest(serialize(a))===digest(serialize(b));
export class RecordHistoryIndex{
 constructor(store,id){if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw new AppError('INVALID');this.store=store;this.id=id;this.root='history:'+id;this.prefix='history-index:'+id+':';}
 async get(slot){const row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);return row?this.store.decode('state',slot,row.payload):null;}
 async insert(slot,value){await this.store.db.run('INSERT INTO state VALUES ($1,$2)',slot,this.store.encode('state',slot,value));}
 async saveHead(head){await this.store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',this.root,this.store.encode('state',this.root,head));}
 async head({initialize=false}={}){
  const value=await this.get(this.root);
  if(!value){if(initialize)return {formatVersion:2,recordId:this.id,count:0,revisions:0};fail();}
  if(value.recordId!==this.id)fail();
  if(value.formatVersion===undefined&&Array.isArray(value.versions)){
   if(!value.versions.every(validItem)||new Set(value.versions.map(v=>v.revision)).size!==value.versions.length)fail();
   const seen=new Set(),rows=value.versions.filter(v=>{const key=v.view?.revision??v.revision;if(seen.has(key))return false;seen.add(key);return true;});
   return {formatVersion:1,recordId:this.id,count:rows.length,revisions:value.versions.length,legacy:value.versions,rows};
  }
  if(value.formatVersion!==2||!Number.isSafeInteger(value.count)||value.count<1||!Number.isSafeInteger(value.revisions)||value.revisions<value.count)fail();
  return value;
 }
 async check(head){
  if(head.legacy)return;
  // Count opaque keys, not encrypted payloads. Missing rows or lookup entries
  // cannot silently shorten history or turn a retained reference into a duplicate.
  const counts=await this.store.db.get("SELECT count(*) FILTER(WHERE starts_with(slot,$3))::text AS rows, count(*) FILTER(WHERE starts_with(slot,$4))::text AS views, count(*) FILTER(WHERE starts_with(slot,$5))::text AS versions, count(*)::text AS total FROM state WHERE slot COLLATE \"C\" >= $1 AND slot COLLATE \"C\" < $2",this.prefix,this.prefix+'~',this.prefix+'row:',this.prefix+'view:',this.prefix+'version:');
  if(counts.rows!==String(head.count)||counts.views!==String(head.count)||counts.versions!==String(head.revisions)||counts.total!==(BigInt(head.count)*2n+BigInt(head.revisions)).toString())fail();
 }
 async rows(head,ordinals){
  if(ordinals.length>50||ordinals.some(n=>!Number.isSafeInteger(n)||n<0||n>=head.count))fail();
  if(head.legacy)return ordinals.map(n=>head.rows[n]);
  const slots=ordinals.map(n=>this.prefix+'row:'+n),found=new Map((await this.store.db.all('SELECT slot,payload FROM state WHERE slot=ANY($1::text[])',slots)).map(r=>[r.slot,r.payload]));
  return slots.map(slot=>{const value=this.store.decode('state',slot,found.get(slot));if(!validItem(value)||!value.view)fail();return value;});
 }
 async lookup(head,kind,revision,{optional=false}={}){
  if(!['version','view'].includes(kind)||!validRevision(revision))fail();
  if(head.legacy){
   const item=kind==='version'?head.legacy.find(v=>v.revision===revision):head.rows.find(v=>(v.view?.revision??v.revision)===revision);
   if(!item){if(optional)return null;fail();}
   const ordinal=head.rows.findIndex(v=>(v.view?.revision??v.revision)===(item.view?.revision??item.revision));
   return {ordinal,item:head.rows[ordinal]};
  }
  const pointer=await this.get(this.prefix+kind+':'+revision);
  if(!pointer){if(optional)return null;fail();}
  if(!Number.isSafeInteger(pointer.ordinal)||pointer.ordinal<0||pointer.ordinal>=head.count||!validRevision(pointer.viewRevision))fail();
  const [item]=await this.rows(head,[pointer.ordinal]);
  if(pointer.viewRevision!==item.view.revision||kind==='view'&&revision!==item.view.revision)fail();
  return {ordinal:pointer.ordinal,item};
 }
 async append(item,{initialize=false,fresh=true}={}){
  if(!validItem(item)||!item.view)fail();
  let head=await this.head({initialize});await this.check(head);
  if(head.legacy){
   // Upgrade this record's index in the caller's transaction, without changing
   // its workspace identity, originals, snapshots or exact references.
   const legacy=head.legacy;head={formatVersion:2,recordId:this.id,count:0,revisions:0};
   for(const old of legacy){
    const view=old.view??await this.display(old);
    head=await this.appendTo(head,{...old,view},true);
   }
  }
  await this.appendTo(head,item,fresh);
 }
 async appendTo(head,item,fresh){
  const existing=await this.lookup(head,'version',item.revision,{optional:true});
  if(existing){if(!same(existing.item.view,item.view))fail();return head;}
  if(!fresh)fail();
  const visible=await this.lookup(head,'view',item.view.revision,{optional:true});
  if(visible&&!same(visible.item.view,item.view))fail();
  const ordinal=visible?.ordinal??head.count,pointer={ordinal,viewRevision:item.view.revision};
  if(!visible){await this.insert(this.prefix+'row:'+ordinal,item);await this.insert(this.prefix+'view:'+item.view.revision,pointer);}
  await this.insert(this.prefix+'version:'+item.revision,pointer);
  const next={formatVersion:2,recordId:this.id,count:head.count+Number(!visible),revisions:head.revisions+1};await this.saveHead(next);return next;
 }
 async display(item){
  if(item.view)return item.view;
  const snapshot=await this.store.snapshot(item.snapshotId);if((await this.store.member(snapshot,this.id))?.revision!==item.revision)fail();
  return retainedRecordDisplay(this.store,this.id,item.revision,snapshot.metadata);
 }
 async *items(head){for(let n=0;n<head.count;n+=50)for(const item of await this.rows(head,Array.from({length:Math.min(50,head.count-n)},(_,i)=>n+i)))yield item;}
}
