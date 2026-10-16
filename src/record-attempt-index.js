// Immutable run-fact lookup is stored under the same notebook key as its
// original. The descriptor pins the exact attempt tree, never a moving record.
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
const groups=['preparations','events','assessments'],hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),natural=v=>Number.isSafeInteger(v)&&v>=0;
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export const validAttemptIndex=v=>v&&Object.keys(v).sort().join()==='assessments,events,preparations,root,source,version'&&[1,2].includes(v.version)&&hash(v.source)&&validTableRef(v.root)&&groups.every(group=>natural(v[group]));
const criterionKey=position=>'criteria:'+String(position).padStart(16,'0');
const currentPrefix=group=>'current:'+group+':',currentKey=row=>currentPrefix(row.group)+String(row.position).padStart(16,'0');
const keys=row=>['id:'+row.id,...(row.supersedes?['correction:'+row.supersedes]:[]),...(row.hasCriteria?[criterionKey(row.position)]:[])];
async function factRow(document,group,position){
 const ref=await document.reference(['attempt',group,String(position)]);if(!ref)fail();
 const value=async key=>(await document.tree.selected(ref,[key])).value;
 return {id:await value('id'),group,position,supersedes:await value('supersedes'),hasCriteria:group==='preparations'&&await document.tree.arrayLength(ref,['criteria'])>0};
}
export class RecordAttemptIndex{
 constructor(document,value){if(!validAttemptIndex(value))fail();this.document=document;this.value=value;this.index=new RetainedTableIndex(document.blocks,{namespace:'index',allowSparseBranches:value.version>=2});}
 async row(entry){
  if(!entry)return null;const node=await this.document.tree.node(entry.revision);if(node.type!=='inline')fail();const row=node.value;
  if(!row||Object.keys(row).sort().join()!=='group,hasCriteria,id,position,supersedes'||!groups.includes(row.group)||!natural(row.position)||row.position>=this.value[row.group]||![...keys(row),...(this.value.version>=2?[currentKey(row)]:[])].includes(entry.id))fail();
  if(entry.id===currentKey(row)&&await this.index.find(this.value,'correction:'+row.id))fail();
  const expected=await factRow(this.document,row.group,row.position);if(Object.keys(expected).some(key=>expected[key]!==row[key]))fail();return row;
 }
 async fact(id,group){const row=await this.row(await this.index.find(this.value,'id:'+id));return row&&(group===undefined||row.group===group)?row:null;}
 async correction(id){return this.row(await this.index.find(this.value,'correction:'+id));}
 async latestCriteria(){const ordinal=await this.index.rank(this.value,'criteria:\uffff');if(!ordinal)return null;const entry=await this.index.entryAt(this.value,ordinal-1);return entry?.id.startsWith('criteria:')?this.row(entry):null;}
 async currentWindow(group,{offset=0,limit=4,signal}={}){
  if(this.value.version<2||!groups.includes(group)||!natural(offset)||!Number.isSafeInteger(limit)||limit<1||limit>32)throw new AppError('INVALID');
  signal?.throwIfAborted();const prefix=currentPrefix(group),start=await this.index.rank(this.value,prefix),end=await this.index.rank(this.value,prefix+'\uffff'),total=end-start,rows=[];
  offset=Math.min(offset,Math.max(0,total-1));
  for(let i=offset;i<Math.min(total,offset+limit);i++){
   signal?.throwIfAborted();const entry=await this.index.entryAt(this.value,start+i);if(!entry?.id.startsWith(prefix))fail();rows.push(await this.row(entry));
  }
  return {rows,total,offset};
 }
 async verify({signal}={}){
  if(this.value.source!==await this.document.reference(['attempt'],{signal}))fail();
  let count=0;
  for(const group of groups){
   if(this.value[group]!==await this.document.tree.arrayLength(this.document.root,['attempt',group]))fail();
   for await(const item of this.document.items(['attempt',group],{signal})){
    const row=await factRow(this.document,group,item.index),revision=digest(serialize({type:'inline',value:row}));
    const expected=keys(row);if(this.value.version>=2&&!await this.index.find(this.value,'correction:'+row.id))expected.push(currentKey(row));
    for(const id of expected){if((await this.index.find(this.value,id))?.revision!==revision)fail();count++;}
   }
  }
  if(count!==(this.value.root?.count??0))fail();
  for await(const entry of this.index.entries(this.value)){signal?.throwIfAborted();await this.row(entry);}
 }
 static async open(document,{signal}={}){
  signal?.throwIfAborted();const value=document.attemptIndex;if(!value)return null;
  // An editable document may change its attempt tree. Its old index remains
  // a useful hint only until that source changes; it cannot describe new facts.
  if(value.source!==await document.reference(['attempt'],{signal}))return null;
  return new RecordAttemptIndex(document,value);
 }
 static async retain(document,{signal}={}){
  const source=await document.reference(['attempt'],{signal});if(!source)return null;
  const existing=await this.open(document,{signal});if(existing)return existing.value;
  // Only the document's own append operation can prove an unchanged prefix.
  // Imported or amended roots rebuild; ordinary append receipts extend the
  // prior immutable index without rereading facts that cannot have changed.
  const appended=document.attemptAppendBase?.()??null;if(appended&&!validAttemptIndex(appended))fail();
  // Old version-one indexes remain readable. The first changed history builds
  // its counted current-fact keys once; subsequent appends extend that root.
  const base=appended?.version===2?appended:null;
  const value={version:2,source,root:base?.root??null,preparations:0,events:0,assessments:0},index=new RetainedTableIndex(document.blocks,{namespace:'index',allowSparseBranches:true});let pending=0;
  for(const group of groups){
   value[group]=await document.tree.arrayLength(document.root,['attempt',group]);
   const offset=base?.[group]??0;if(offset>value[group])fail();
   for await(const item of document.items(['attempt',group],{offset,signal})){
    const row=await factRow(document,group,item.index),revision=await document.tree.retain(row);
    for(const id of keys(row)){if(await index.find(value,id))fail();value.root=await index.change(value.root,id,revision);}
    if(row.supersedes){
     const prior=await index.find(value,'id:'+row.supersedes);if(!prior)fail();const previous=await document.tree.read(prior.revision);
     if(previous.group!==group||previous.position>=row.position||(await index.find(value,currentKey(previous)))?.revision!==prior.revision)fail();
     value.root=await index.remove(value.root,currentKey(previous));
    }
    value.root=await index.change(value.root,currentKey(row),revision);
    // Persist only reachable pages once per bounded batch. Retaining every
    // intermediate root would write a new index path for every single fact.
    if(++pending===32){await index.flush(value.root);pending=0;}
   }
  }
  await index.flush(value.root);return value;
 }
}
