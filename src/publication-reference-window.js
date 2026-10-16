// Equivalent reference namespaces may overlap. Merge their ordered candidates
// while retaining one bounded window and releasing each owner before the next.
export async function publicationReferenceWindow(sources,{backward=false,limit=257,signal}={}){
 const rows=new Map(),compare=(a,b)=>(a.position-b.position)*(backward?-1:1);
 for(const source of sources){
  let read=0;
  for await(const row of await source()){
   signal?.throwIfAborted();rows.set(row.position,row);
   if(rows.size>limit)rows.delete([...rows.values()].sort(compare).at(-1).position);
   if(++read===limit)break;
  }
 }
 return [...rows.values()].sort(compare);
}
