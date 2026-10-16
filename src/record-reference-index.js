// Each mention keeps its source position. A target's first occurrence owns its
// ordered query value; removing it promotes the next occurrence. Counted search
// terms keep backlinks present until the final mention has been removed.
import {groupRecordProjection} from './record-projection-groups.js';
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {recordReferenceTargets} from './web/record-query.js';
import {proseReferences} from './web/prose-model.js';
import {attemptDocumentReferences} from './record-attempt-document.js';
import {attemptReferenceGroups} from './record-attempt-query.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {referenceTerm} from './record-search-terms.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const index=blocks=>new RetainedTableIndex(blocks,{namespace:'index',allowSparseBranches:true});
const encoded=value=>value.toString(16).padStart(64,'0');
const count=value=>{const result=BigInt('0x'+value);if(result<1n||result>BigInt(Number.MAX_SAFE_INTEGER))fail();return result;};
const termKey=value=>/^ref-[a-f0-9-]{36}-[a-f0-9-]{36}$/.test(value);
export const validReferenceIndex=value=>value&&Object.keys(value).sort().join()==='occurrences,raw,root,terms,version'&&[1,2].includes(value.version)&&revisionId(value.raw)&&revisionId(value.root)&&validTableRef(value.occurrences)&&validTableRef(value.terms);
async function item(tree,revision){
 const node=await tree.node(revision);if(node.type!=='item')fail();const value=await tree.read(node.value);
 if(!value||!['id,type,workspaceId','id,revision,type,workspaceId'].includes(Object.keys(value).sort().join())||!researchId(value.id)||!researchId(value.workspaceId)||typeof value.type!=='string'||Object.hasOwn(value,'revision')&&!revisionId(value.revision))fail();
 return value;
}
async function arrayRoot(tree,revision){const node=await tree.node(revision);if(node.type!=='keyed-array')fail();return node.root;}
export async function retainReferenceIndex(document,{previous,signal,version=2}={}){
 signal?.throwIfAborted();const {blocks,tree}=document,retained=previous?.referenceIndex;if(![1,2].includes(version)||retained&&!validReferenceIndex(retained))fail();const old=retained?.version===version?retained:null;
 const target=(value,type)=>({workspaceId:value.workspaceId,id:value.id,type,...(value.revision?{revision:value.revision}:{})});
 const mentions=body=>proseReferences(body).filter(value=>value.kind==='record').map(value=>target(value,'Mentioned in text'));
 const raw=await groupRecordProjection(document,old?previous:null,{previousRoot:old?.raw,groups:[
  {collection:['relations'],fields:['type','target'],project:value=>recordReferenceTargets({relations:[value]})},
  {field:['body'],project:mentions},
  {collection:['sections'],fields:['body'],project:value=>mentions(value.body)},
  ...(version===1?[{field:['attempt'],read:()=>null,async *project(){for await(const value of attemptDocumentReferences(document,{signal}))if(value.kind==='record')yield target(value,value.label);}}]:attemptReferenceGroups(value=>value.kind==='record'?[target(value,value.label)]:[]))
 ]},{signal});
 const rawBefore=old?await arrayRoot(tree,old.raw):null,rawAfter=await arrayRoot(tree,raw),positions=index(blocks),output=index(blocks),terms=index(blocks);
 let occurrences=old?.occurrences??null,root=old?await arrayRoot(tree,old.root):null,termRoot=old?.terms??null,pending=0;
 const first=async key=>{const at=await positions.rank({root:occurrences},key+':'),entry=await positions.entryAt({root:occurrences},at);return entry?.id.startsWith(key+':')?{id:entry.id.slice(65),revision:entry.revision}:null;};
 const change=async(entry,delta)=>{
  const value=await item(tree,entry.revision),key=digest(serialize(value)),prior=await first(key);
  occurrences=delta>0?await positions.change(occurrences,key+':'+entry.id,entry.revision):await positions.remove(occurrences,key+':'+entry.id);
  const next=await first(key);
  if(prior?.id!==next?.id||prior?.revision!==next?.revision){if(prior)root=await output.remove(root,prior.id);if(next)root=await output.change(root,next.id,next.revision);}
  const term=referenceTerm(value),found=await terms.find({root:termRoot},term),total=(found?count(found.revision):0n)+BigInt(delta);if(total<0n||total>BigInt(Number.MAX_SAFE_INTEGER))fail();
  termRoot=total?await terms.change(termRoot,term,encoded(total)):await terms.remove(termRoot,term);
 };
 const flush=async()=>{await positions.flush(occurrences);await output.flush(root);await terms.flush(termRoot);pending=0;};
 for await(const entry of index(blocks).differences(rawBefore,rawAfter,{signal})){
  signal?.throwIfAborted();if(entry.before)await change(entry.before,-1);if(entry.after)await change(entry.after,1);if(++pending===32)await flush();
 }
 await flush();signal?.throwIfAborted();if((occurrences?.count??0)!==(rawAfter?.count??0)||(root?.count??0)>(occurrences?.count??0))fail();
 return {version,raw,occurrences,terms:termRoot,root:await blocks.put('value',{type:'keyed-array',root})};
}
export async function verifyReferenceIndex(blocks,actual,expectedBlocks,expected,{signal}={}){
 if(!validReferenceIndex(actual)||!validReferenceIndex(expected)||actual.version!==expected.version)fail();const tree=blocks.tree(),expectedTree=expectedBlocks.tree();
 for(const name of ['raw','root','occurrences','terms']){
  const leftRoot=['raw','root'].includes(name)?await arrayRoot(tree,actual[name]):actual[name],rightRoot=['raw','root'].includes(name)?await arrayRoot(expectedTree,expected[name]):expected[name];
  const left=index(blocks).entries({root:leftRoot})[Symbol.asyncIterator](),right=index(expectedBlocks).entries({root:rightRoot})[Symbol.asyncIterator]();
  try{while(true){
   signal?.throwIfAborted();const a=await left.next(),b=await right.next();if(a.done!==b.done)fail();if(a.done)break;if(a.value.id!==b.value.id||a.value.revision!==b.value.revision)fail();
   if(name==='terms'){if(!termKey(a.value.id))fail();count(a.value.revision);}else await item(tree,a.value.revision);
  }}finally{await left.return?.();await right.return?.();}
 }
}
export async function* changedReferenceTerms(blocks,own,other,{signal}={}){
 if(!validReferenceIndex(own)||!validReferenceIndex(other))fail();
 for await(const change of index(blocks).differences(other.terms,own.terms,{signal})){
  if(!termKey(change.id))fail();if(change.before)count(change.before.revision);if(change.after)count(change.after.revision);if(!change.before&&change.after)yield change.id;
 }
}
