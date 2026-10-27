// A saved, validated document at the same research snapshot remains the proof
// for unchanged subtrees. Scalar homepage text/visibility cannot alter links,
// identities, source consent, assets or reusable-layout bindings.
const fields=new Set(['document.website.home.title','document.website.home.introduction','document.website.home.showTitle']);
export async function homepagePresentationChange(before,after,{signal}={}){
 async function same(path,left,right){
  signal?.throwIfAborted();if(left===right||fields.has(path.join('.')))return true;
  if(!left||!right||![...fields].some(field=>field.startsWith(path.length?path.join('.')+'.':'')))return false;
  const old=new Map(),next=new Map();
  for await(const child of before.properties(path,{signal}))old.set(child.name,child.value);
  for await(const child of after.properties(path,{signal}))next.set(child.name,child.value);
  for(const key of new Set([...old.keys(),...next.keys()]))if(!await same([...path,key],old.get(key),next.get(key)))return false;
  return true;
 }
 return same([],before.root,after.root);
}
