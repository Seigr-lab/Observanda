// Canonical identity of a selected document, without reconstructing its values.
import {createHash} from 'node:crypto';

// Equality can reuse immutable owned values without changing their public
// canonical revision. Re-encoded values fall back to canonical field hashes;
// an unchanged section tree or figure never needs hashing just for comparison.
export async function sameDocumentContent(previous,document,{omit=[],signal}={}){
 signal?.throwIfAborted();
 const names=async source=>(await source.tree.propertyNames(source.root)).filter(name=>!omit.includes(name)).sort();
 const before=await names(previous),after=await names(document);
 if(before.length!==after.length||before.some((name,index)=>name!==after[index]))return false;
 const valueRevision=async(source,ref)=>{
  const hash=createHash('sha256');for await(const text of source.tree.json(ref,{canonical:true,signal}))hash.update(text);return hash.digest('hex');
 };
 for(const name of before){
  signal?.throwIfAborted();const a=await previous.reference([name],{signal}),b=await document.reference([name],{signal});
  if(a!==b&&await valueRevision(previous,a)!==await valueRevision(document,b))return false;
 }
 signal?.throwIfAborted();return true;
}
export async function documentRevision(document,{omit=[],signal}={}){
 const hash=createHash('sha256'),names=(await document.tree.propertyNames(document.root)).filter(name=>!omit.includes(name)).sort();
 hash.update('{');let first=true;
 for(const name of names){
  signal?.throwIfAborted();if(!first)hash.update(',');first=false;hash.update(JSON.stringify(name)+':');
  const ref=await document.reference([name],{signal});
  for await(const text of document.tree.json(ref,{canonical:true,signal}))hash.update(text);
 }
 hash.update('}');return hash.digest('hex');
}
