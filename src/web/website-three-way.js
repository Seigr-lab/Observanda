// Every choice belongs to one comparison of three immutable page revisions.
// The assembly functions only read those documents and the author's choices.
export const literal=value=>()=>value;
export function websiteMergeChoices(){
 const rows=[],choices=new Map();
 function choose(key,kind,label,base,local,remote,display=x=>x){
  if(local===remote)return literal(local);
  if(local===base)return literal(remote);
  if(remote===base)return literal(local);
  const index=rows.length;
  rows.push({key,kind,label,base:display(base),local:display(local),remote:display(remote)});
  return ()=>choices.get(index)==='local'?local:remote;
 }
 return {rows,choose,select(index,side){
  if(!Number.isInteger(index)||!rows[index]||!['local','remote'].includes(side))return false;
  choices.set(index,side);return true;
 },side:index=>choices.get(index),remaining:()=>rows.length-choices.size};
}

// Preserve cascade/child order. Disjoint insertions occupy the same gaps
// they had in their respective sides. Competing reorders are a separate choice.
export function mergeOrder(base,local,remote,key,kind,label,choices,description=id=>id){
 const encoded=items=>JSON.stringify(items),localKeys=new Set(local),remoteKeys=new Set(remote);
 const resolve=order=>{
  const anchors=new Set(order),chosen=new Set(order),before=new Map();
  for(const side of [remote,local]){
   let anchor='',group=[];
   const collect=()=>{if(group.length){const prior=before.get(anchor)??[];for(let i=group.length-1;i>=0;i--)prior.push(group[i]);before.set(anchor,prior);group=[];}};
   for(let i=side.length-1;i>=0;i--){
    const id=side[i];
    if(anchors.has(id)){collect();anchor=id;}
    else if(!chosen.has(id)){group.push(id);chosen.add(id);}
   }
   collect();
  }
  return [...order.flatMap(id=>[...(before.get(id)??[]),id]),...(before.get('')??[])];
 };
 const common=base.filter(id=>localKeys.has(id)&&remoteKeys.has(id));
 const known=new Set(common),a=local.filter(id=>known.has(id)),b=remote.filter(id=>known.has(id));
 const chosen=choices.choose(key+'/order',kind,label,encoded(common),encoded(a),encoded(b),s=>JSON.parse(s).map(description).join(' · '));
 return ()=>resolve(JSON.parse(chosen()));
}
