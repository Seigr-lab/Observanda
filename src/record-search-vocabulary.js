// Search contributions belong to individual source fields. A record-wide term
// count keeps a word searchable when it is removed from only one of its fields.
// Ordered seams retain phrases crossing fields, including empty fields and
// UTF-16 surrogate halves. All retained nodes use the notebook's block key.
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {collectionChanges,sameItemFields} from './record-projection-dependency.js';
import {proseText} from './web/prose-model.js';
import {attemptDocumentSearchParts} from './record-attempt-document.js';
import {retainAttemptSearchParts} from './record-attempt-query.js';
import {grams} from './record-search-terms.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {RecordSequenceBuilder} from './record-tree-values.js';
import {retainRecordText} from './record-text-retention.js';
import {jsonFitsBytes} from './web/json-chunks.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const ordinal=value=>String(value).padStart(16,'0');
const one='1'.padStart(64,'0');
const termKey=value=>/^(?:[a-f0-9]{4}){1,3}$/.test(value);
const index=blocks=>new RetainedTableIndex(blocks,{namespace:'index',allowSparseBranches:true});
const encoded=value=>value.toString(16).padStart(64,'0');
const count=value=>{const number=BigInt('0x'+value);if(number<1n||number>BigInt(Number.MAX_SAFE_INTEGER))fail();return number;};
const reference=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const validSearchVocabulary=value=>value&&[1,2,3].includes(value.version)&&Object.keys(value).sort().join()===(value.version===1?'parts,terms,version':'parts,terms,text,version')&&validTableRef(value.parts)&&validTableRef(value.terms)&&(value.version===1||reference(value.text));
// The first bounded batch is already unique. Pack it directly instead of
// persisting thousands of intermediate roots while constructing a new index.
async function initialTerms(blocks,entries,{signal}={}){
 const builder=new RecordSequenceBuilder(blocks);
 for(const entry of entries.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){signal?.throwIfAborted();await builder.append(0,entry);}
 return builder.finishIndex();
}

async function retainPart(blocks,text,{signal,includeText=false}={}){
 const table=index(blocks),cache=new Set(),pending=new Set();let root=null,tail='',length=0,first='',last='';
 const flush=async()=>{if(pending.size){root=await table.changeMany(root,[...pending].sort().map(id=>({id,revision:one})),{signal});await table.flush(root);pending.clear();}};
 async function* chunks(){for await(const source of typeof text==='string'?[text]:text){
  const chunk=String(source??'').toLocaleLowerCase();length+=chunk.length;if(!Number.isSafeInteger(length))fail();first=(first+chunk.slice(0,2)).slice(0,2);last=(last+chunk).slice(-2);
  for(let offset=0;offset<chunk.length;offset+=2048){
  signal?.throwIfAborted();const window=tail+chunk.slice(offset,offset+2048);tail=window.slice(-2);
  for(const width of [1,2,3])for(const term of grams(window,width)){
   if(cache.has(term))continue;
   if(!root){cache.add(term);if(cache.size===8192)root=await initialTerms(blocks,[...cache].map(id=>({id,revision:one})),{signal});continue;}
   if(cache.size===8192)cache.delete(cache.values().next().value);cache.add(term);
   pending.add(term);if(pending.size===2048)await flush();
  }
  }
  yield chunk;
 }
 }
 let textReference;
 if(includeText){
  if(typeof text==='string'&&jsonFitsBytes(text.toLocaleLowerCase(),8191,{pretty:true})){for await(const unused of chunks())void unused;textReference=await blocks.tree().retain(text.toLocaleLowerCase());}
  else textReference=await retainRecordText(blocks,chunks(),{signal});
 }else for await(const unused of chunks())void unused;
 if(!root)root=await initialTerms(blocks,[...cache].map(id=>({id,revision:one})),{signal});
 await flush();await table.flush(root);return blocks.put('value',{length,first,last,terms:root,...(includeText?{text:textReference}:{})});
}
async function readPart(blocks,entry){
 if(!entry)return null;const part=await blocks.read('value',entry.revision);
 if(!part||!['first,last,length,terms','first,last,length,terms,text'].includes(Object.keys(part).sort().join())||Object.hasOwn(part,'text')&&!reference(part.text)||!Number.isSafeInteger(part.length)||part.length<0||typeof part.first!=='string'||typeof part.last!=='string'||part.first.length!==Math.min(2,part.length)||part.last.length!==Math.min(2,part.length)||!validTableRef(part.terms)||Boolean(part.terms)!==Boolean(part.length))fail();
 return part;
}
async function seam(blocks,table,root,key,{signal}={}){
 signal?.throwIfAborted();const entry=await table.find({root},key);if(!entry)return new Set();
 let position=await table.rank({root},key);if(!position)return new Set();
 const current=await readPart(blocks,entry);let before='';
 while(position>0&&before.length<2){
  const part=await readPart(blocks,await table.entryAt({root},--position));
  before=(part.last+before).slice(-2);if(position>0&&before.length<2)before=(' '+before).slice(-2);
 }
 const text=before+' '+current.first,at=before.length,terms=new Set();
 for(const width of [1,2,3])for(let start=Math.max(0,at-width+1);start<=at&&start+width<=text.length;start++)for(const term of grams(text.slice(start,start+width),width))terms.add(term);
 return terms;
}
export async function retainSearchVocabulary(document,{previous,signal,version=3}={}){
 signal?.throwIfAborted();const {blocks,tree}=document,retained=previous?.vocabulary;
 if(![1,2,3].includes(version)||retained&&!validSearchVocabulary(retained))fail();const old=retained?.version===version?retained:null;
 const parts=index(blocks),terms=index(blocks),local=index(blocks),joined=index(blocks),before=old?.parts??null;
 const textNode=old?.text?await tree.node(old.text):null;if(textNode&&(textNode.type!=='joined-string'||(textNode.root?.count??0)!==(before?.count??0)))fail();let joinedRoot=textNode?.root??null;
 let root=before,total=old?.terms??null,pending=0;const deltas=new Map(),partCache=new Map();
 const flushTerms=async()=>{
  if(!total&&deltas.size){if([...deltas.values()].some(value=>value<=0n||value>BigInt(Number.MAX_SAFE_INTEGER)))fail();total=await initialTerms(blocks,[...deltas].map(([id,value])=>({id,revision:encoded(value)})),{signal});deltas.clear();return;}
  const changes=[];
  for(const [term,change] of deltas){
   signal?.throwIfAborted();const found=await terms.find({root:total},term),next=(found?count(found.revision):0n)+change;
   if(next<0n||next>BigInt(Number.MAX_SAFE_INTEGER))fail();changes.push({id:term,revision:next?encoded(next):null});
  }
  total=await terms.changeMany(total,changes.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),{signal});
  await terms.flush(total);deltas.clear();
 };
 const adjust=async(term,change)=>{
  signal?.throwIfAborted();if(!termKey(term))fail();const delta=(deltas.get(term)??0n)+BigInt(change);if(delta)deltas.set(term,delta);else deltas.delete(term);
  if(deltas.size===8192)await flushTerms();
 };
 const set=async(key,text)=>{
  signal?.throwIfAborted();const cacheKey=typeof text==='string'?digest(serialize(text)):null,prior=await parts.find({root},key),next=text===null?null:partCache.get(cacheKey)??await retainPart(blocks,text,{signal,includeText:version>=2});
  if(cacheKey&&!partCache.has(cacheKey)){if(partCache.size===32)partCache.delete(partCache.keys().next().value);partCache.set(cacheKey,next);}
  if((prior?.revision??null)===next)return;
  const a=await readPart(blocks,prior),b=await readPart(blocks,next?{revision:next}:null);
  for await(const change of local.differences(a?.terms??null,b?.terms??null,{signal})){
   if(change.before&&change.before.revision!==one||change.after&&change.after.revision!==one)fail();
   if(!change.after)await adjust(change.id,-1);else if(!change.before)await adjust(change.id,1);
  }
  root=next?await parts.change(root,key,next):await parts.remove(root,key);
  if(version>=2)joinedRoot=b?await joined.change(joinedRoot,key,await blocks.put('value',{type:'item',value:b.text})):await joined.remove(joinedRoot,key);
  if(++pending===32){await parts.flush(root);await joined.flush(joinedRoot);pending=0;}
 };
 const same=async path=>!!old&&await document.reference(path,{signal})===await previous.document.reference(path,{signal});
 const field=async path=>(await document.field(path,{signal})).value;
 for(const [key,path,project] of [['00',['title'],v=>v],['10',['body'],proseText],['20',['outcome'],v=>v??'']])if(!await same(path))await set(key,project(await field(path)));
 for(const [prefix,path,fields,project] of [
  ['30',['tags'],null,v=>[v]],['40',['sections'],['title','body'],v=>[v.title,proseText(v.body)]],['50',['contributors'],['name','role'],v=>[v.name,v.role]]
 ]){
  if(await same(path))continue;
  const changes=old?await collectionChanges(document,previous.document,path,{signal}):null;
  const after=await tree.arrayLength(document.root,path),prior=old?await previous.document.tree.arrayLength(previous.document.root,path):0;
  const positions=changes&&!changes.unchanged?changes.positions():(async function*(){for(let i=0;i<Math.max(prior,after);i++)yield i;})();
  for await(const position of positions){
   signal?.throwIfAborted();const key=prefix+':'+ordinal(position),itemPath=[...path,String(position)];
   if(position>=after){for(let i=0;i<(fields?.length??1);i++)await set(key+':'+i,null);continue;}
   if(old&&position<prior&&(fields?await sameItemFields(document,previous.document,path,position,fields,{signal}):await same(itemPath)))continue;
   if(!fields){await set(key+':0',(await field(itemPath)));continue;}
   const item={};for(const name of fields)item[name]=await field([...itemPath,name]);const values=project(item);for(let i=0;i<values.length;i++)await set(key+':'+i,values[i]);
  }
 }
 if(!await same(['template'])){const template=await field(['template']);await set('60',[template?.label??'',...Object.values(template?.values??{})].join(' '));}
 if(!await same(['attempt'])){
  if(version>=3)await retainAttemptSearchParts(document,old?previous.document:null,set,{signal});
  else{const text=(await document.field(['attempt','version'],{signal})).found?(async function*(){let first=true;for await(const value of attemptDocumentSearchParts(document,{signal})){if(!first)yield ' ';first=false;yield value;}})():null;await set('70',text);}
 }
 if(!await same(['results'])){const results=await field(['results']),values=(results?.statements??[]).flatMap(item=>[item.title,item.text,item.limitations]);await set('80',values.length?values.join(' '):null);}
 // A changed part can affect its own separator and the next two separators.
 // Sorted deltas let us deduplicate these windows with a small frontier.
 const seams=new Set();
 const updateSeam=async key=>{
  const a=await seam(blocks,parts,before,key,{signal}),b=await seam(blocks,parts,root,key,{signal});
  for(const term of a)if(!b.has(term))await adjust(term,-1);
  for(const term of b)if(!a.has(term))await adjust(term,1);
 };
 for await(const change of parts.differences(before,root,{signal})){
  for(const key of [...seams].sort())if(key<change.id){await updateSeam(key);seams.delete(key);}
  seams.add(change.id);
  for(const source of [before,root]){
   const position=await parts.rank({root:source},change.id),found=await parts.find({root:source},change.id),start=position+(found?1:0);
   for(let offset=0;offset<2;offset++){const following=await parts.entryAt({root:source},start+offset);if(following)seams.add(following.id);}
  }
 }
 for(const key of [...seams].sort())await updateSeam(key);
 await parts.flush(root);await joined.flush(joinedRoot);await flushTerms();signal?.throwIfAborted();return {version,parts:root,terms:total,...(version>=2?{text:await blocks.put('value',{type:'joined-string',root:joinedRoot})}:{})};
}
export async function verifySearchVocabulary(blocks,actual,expectedBlocks,expected,{signal}={}){
 if(!validSearchVocabulary(actual)||!validSearchVocabulary(expected)||actual.version!==expected.version)fail();
 const checked=new Map(),parts=index(blocks),tree=blocks.tree(),textNode=actual.text?await tree.node(actual.text):null;
 if(textNode&&(textNode.type!=='joined-string'||(textNode.root?.count??0)!==(actual.parts?.count??0)))fail();
 for(const name of ['parts','terms']){
  const left=index(blocks).entries({root:actual[name]})[Symbol.asyncIterator](),right=index(expectedBlocks).entries({root:expected[name]})[Symbol.asyncIterator]();
  const text=name==='parts'&&textNode?index(blocks).entries({root:textNode.root})[Symbol.asyncIterator]():null;
  try{while(true){
   signal?.throwIfAborted();const a=await left.next(),b=await right.next();if(a.done!==b.done)fail();if(a.done)break;if(a.value.id!==b.value.id||a.value.revision!==b.value.revision)fail();
   if(name==='parts'){
    let part=checked.get(a.value.revision);
    if(!part){part=await readPart(blocks,a.value);for await(const term of parts.entries({root:part.terms})){signal?.throwIfAborted();if(!termKey(term.id)||term.revision!==one)fail();}if(checked.size===64)checked.delete(checked.keys().next().value);checked.set(a.value.revision,part);}
    if(text){const entry=await text.next();if(entry.done||entry.value.id!==a.value.id)fail();const child=await tree.node(entry.value.revision);if(child.type!=='item'||child.value!==part.text)fail();}
   }
  }if(text&&!(await text.next()).done)fail();}
  finally{await left.return?.();await right.return?.();await text?.return?.();}
 }
}
export async function* changedSearchVocabulary(blocks,own,other,{signal}={}){
 if(!validSearchVocabulary(own)||!validSearchVocabulary(other))fail();
 for await(const change of index(blocks).differences(other.terms,own.terms,{signal})){
  if(!termKey(change.id))fail();if(change.before)count(change.before.revision);if(change.after)count(change.after.revision);
  if(!change.before&&change.after)yield change.id;
 }
}
