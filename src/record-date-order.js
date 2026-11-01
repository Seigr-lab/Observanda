// The retained date index orders dates newest first and IDs ascending. Reverse
// date groups, not individual entries, to keep ID ties ascending and unknown
// dates last in both directions. Historical indexes need no rewrite.
import {AppError} from './errors.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
async function bounds(index,head,start){
 const lower=await index.rank(head,start),unknown=await index.rank(head,start+'1:'),upper=await index.rank(head,start+'\uffff');
 if(lower>unknown||unknown>upper)fail();return {lower,unknown,upper};
}
export async function recordDateRank(index,head,start,key,{ascending=false,includeEqual=true}={}){
 const {lower,unknown,upper}=await bounds(index,head,start),at=key===null?lower:await index.rank(head,start+key+(includeEqual?'\0':''));
 if(at<lower||at>upper)fail();
 if(!ascending||key===null)return {total:upper-lower,skipped:at-lower};
 if(key.startsWith('1:'))return {total:upper-lower,skipped:at-lower};
 const group=start+key.slice(0,-36),first=await index.rank(head,group),last=await index.rank(head,group+'\uffff');
 if(first<lower||last>unknown||at<first||at>last)fail();
 return {total:upper-lower,skipped:unknown-last+at-first};
}
export async function* ascendingDateOrdinals(index,head,start,key,{backward=false,inclusive=false,signal}={}){
 const range=await bounds(index,head,start);let group,at;
 const known=async prefix=>{
  const lower=await index.rank(head,prefix),upper=await index.rank(head,prefix+'\uffff');
  if(lower<range.lower||upper>range.unknown||lower>upper)fail();return {lower,upper,unknown:false};
 };
 const groupAt=async position=>{
  if(position<range.lower||position>=range.unknown)fail();
  const entry=await index.entryAt(head,position);if(!entry?.id.startsWith(start+'0:'))fail();
  const value=await known(entry.id.slice(0,-36));if(value.lower>position||value.upper<=position)fail();return value;
 };
 const unknown=()=>({lower:range.unknown,upper:range.upper,unknown:true});
 if(key!==null){
  group=key.startsWith('1:')?unknown():await known(start+key.slice(0,-36));
  at=await index.rank(head,start+key+((backward?inclusive:!inclusive)?'\0':''))-(backward?1:0);
 }else if(backward){
  group=range.unknown<range.upper?unknown():range.lower<range.unknown?await groupAt(range.lower):null;at=group?.upper-1;
 }else{group=range.lower<range.unknown?await groupAt(range.unknown-1):unknown();at=group.lower;}
 while(group){
  signal?.throwIfAborted();
  while(at>=group.lower&&at<group.upper){signal?.throwIfAborted();yield at;at+=backward?-1:1;}
  if(backward){
   const next=group.unknown?range.lower:group.upper;
   group=next<range.unknown?await groupAt(next):null;at=group?.upper-1;
  }else{
   group=group.unknown?null:group.lower>range.lower?await groupAt(group.lower-1):unknown();at=group?.lower;
  }
 }
}
