import {SnapshotIndex} from '../snapshot-index.js';

// A batch does not own references or presentation authored after its import.
// Scan one record at a time; retain only edges between removal candidates.
export async function protectedImportTargets(catalogue,snapshot,removals,restorations,{signal}={}){
 const candidates=new Set(removals),protectedIds=new Set(),edges=new Map(),prior=new Map(restorations.map(ref=>[ref.id,ref.revision]));
 if(!candidates.size)return protectedIds;
 for(const value of [...snapshot.metadata.branding,...snapshot.metadata.website.layouts]){
  const id=value.target?.startsWith('entry:')?value.target.slice(6):null;if(candidates.has(id))protectedIds.add(id);
 }
 for await(const member of new SnapshotIndex(catalogue).members(snapshot.membership)){
  signal?.throwIfAborted();const record=await catalogue.record(member.id,prior.get(member.id)??member.revision),targets=new Set();
  for(const link of record.relations??[]){
   const ref=link.target;if(ref?.kind==='record'&&ref.workspaceId===snapshot.metadata.id&&!ref.revision&&candidates.has(ref.id))targets.add(ref.id);
  }
  if(candidates.has(record.id))edges.set(record.id,targets);else for(const id of targets)protectedIds.add(id);
 }
 const queue=[...protectedIds];for(let i=0;i<queue.length;i++)for(const id of edges.get(queue[i])??[]){if(!protectedIds.has(id)){protectedIds.add(id);queue.push(id);}}
 return protectedIds;
}
