import {cataloguePrefixExists} from './postgres-indexes.js';
import {reviewScopeNamespace} from './project-review-origin.js';
// Record review discovery is independent of packet bodies and signed responses.
// Membership is append-only, committed with its request and global review index.
import {ObjectIndex,validIndexRef} from './object-index.js';
import {reviewHash} from './security/review-exchange.js';
import {AppError} from './errors.js';
import {exact,uuid,unique} from './modules/validation.js';
const slot='review-scopes',namespace='review-scope-index:';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const prefix=(workspaceId,recordId)=>workspaceId+'/'+recordId+'/';
export const reviewMembership=summary=>reviewHash({id:summary.id,workspaceId:summary.workspaceId,records:summary.records.map(r=>r.id)});
export class ReviewScopeIndex{
 constructor(store){this.store=store;this.tree=new ObjectIndex(store,{namespace,immutable:true});}
 async state(){
  const row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
  if(!row)return null;
  const head=this.store.decode('state',slot,row.payload);
  if(!exact(head,['version','indexHash','root'])||head.version!==1||typeof head.indexHash!=='string'||!(/^[a-f0-9]{64}$/).test(head.indexHash)||!validIndexRef(head.root))fail();
  return head;
 }
 async save(root,ids){await this.store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',slot,this.store.encode('state',slot,{version:1,indexHash:reviewHash(ids),root}));}
 async add(root,summary,ordinal,{persist=true}={}){
  const revision=reviewMembership(summary),workspaceId=await reviewScopeNamespace(this.store,summary);
  for(const record of summary.records)root=await this.tree.change(root,prefix(workspaceId,record.id)+String(ordinal).padStart(9,'0')+'/'+summary.id,revision);
  if(persist)await this.tree.flush(root);return root;
 }
 async ensure(index,readSummary,{persist=true}={}){
  const head=await this.state();
  if(head){if(head.indexHash!==reviewHash(index.ids))fail();return head;}
  // An absent marker is valid for older stores, never for a partial index.
  if(await cataloguePrefixExists(this.store.db,'state',namespace))fail();
  let root=null;
  for(let ordinal=0;ordinal<index.ids.length;ordinal++)root=await this.add(root,await readSummary(index.ids[ordinal]),ordinal,{persist});
  if(persist&&index.ids.length)await this.save(root,index.ids);return {root};
 }
 async verify(){
  const head=await this.state();
  if(!head){if(await cataloguePrefixExists(this.store.db,'state',namespace))fail();return;}
  const source=await this.store.object('metadata:.observanda/reviews/index.json');let index;
  try{index=JSON.parse(source?.text);}catch{fail();}
  if(!Array.isArray(index?.ids)||index.ids.length>500||!index.ids.every(uuid)||!unique(index.ids)||head.indexHash!==reviewHash(index.ids))fail();
  let count=0;
  for(let ordinal=0;ordinal<index.ids.length;ordinal++){
   const id=index.ids[ordinal],raw=await this.store.object('metadata:.observanda/reviews/summaries/'+id+'.json');let summary;
   try{summary=JSON.parse(raw?.text);}catch{fail();}
   if(summary?.id!==id||!uuid(summary.workspaceId)||!Array.isArray(summary.records)||!summary.records.length||summary.records.length>50||!summary.records.every(r=>uuid(r?.id))||!unique(summary.records.map(r=>r.id)))fail();
   const expected=reviewMembership(summary),workspaceId=await reviewScopeNamespace(this.store,summary);
   for(const record of summary.records){
    const row=await this.tree.find(head,prefix(workspaceId,record.id)+String(ordinal).padStart(9,'0')+'/'+id);
    if(row?.revision!==expected)fail();count++;
   }
  }
  if((head.root?.count??0)!==count)fail();
 }
 async append(index,summary,readSummary){
  if(index.ids.at(-1)!==summary.id)fail();
  const head=await this.ensure({ids:index.ids.slice(0,-1)},readSummary);
  await this.save(await this.add(head.root,summary,index.ids.length-1),index.ids);
 }
 async page(index,workspaceId,recordId,offset,limit,readSummary){
  if(!uuid(workspaceId)||!uuid(recordId)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>5)throw new AppError('INVALID');
  const head=await this.ensure(index,readSummary,{persist:false}),scope=prefix(workspaceId,recordId),total=await this.tree.prefixCount(head,scope),items=[];
  if(offset>=total)return {items,total};
  // Seek by authenticated subtree cardinalities; late pages never rescan older
  // requests. The first excluded row supplies the reverse traversal boundary.
  const before=offset?(await this.tree.entryAt(head,await this.tree.rank(head,scope)+total-offset))?.id:null;
  if(offset&&!before?.startsWith(scope))fail();
  for await(const row of this.tree.reverseEntries(head,scope,before)){
   const [position,id,...extra]=row.id.slice(scope.length).split('/'),ordinal=Number(position);
   if(extra.length||position!==String(ordinal).padStart(9,'0')||!uuid(id)||index.ids[ordinal]!==id)fail();
   items.push({id,revision:row.revision});if(items.length===limit)break;
  }
  if(items.length!==Math.min(limit,total-offset))fail();return {items,total};
 }
}
