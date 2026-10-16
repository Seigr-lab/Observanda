
// One structural tree. User-defined labels have no effect on storage or behavior.
export const parentOf=node=>node.parentId??null;
export function ancestors(book,id){
 const result=[],seen=new Set();
 for(let node=book.projects.find(p=>p.id===id);node&&!seen.has(node.id);node=book.projects.find(p=>p.id===parentOf(node))){
  seen.add(node.id);result.unshift(node);
 }
 return result;
}
export const locationName=(book,id)=>ancestors(book,id).map(p=>p.title).join(' / ');
export function descendants(book,id){
 const found=new Set(id?[id]:[]),queue=id?[id]:book.projects.filter(p=>!parentOf(p)).map(p=>p.id);
 for(let i=0;i<queue.length;i++){
  found.add(queue[i]);
  for(const p of book.projects)if(parentOf(p)===queue[i]&&!found.has(p.id)){found.add(p.id);queue.push(p.id);}
 }
 return found;
}
export const childrenOf=(book,id=null)=>book.projects.filter(p=>parentOf(p)===id);
export function validHierarchy(projects){
 if(!Array.isArray(projects)||projects.some(p=>!p||typeof p!=='object'))return false;
 const byId=new Map(projects.map(p=>[p.id,p]));
 return projects.every(p=>{
  const seen=new Set([p.id]);let parent=parentOf(p);
  while(parent){if(!byId.has(parent)||seen.has(parent))return false;seen.add(parent);parent=parentOf(byId.get(parent));}
  return true;
 });
}
export const notebooksIn=(book,id,{recursive=false}={})=>{
 const ids=recursive?descendants(book,id):new Set([id]);
 return book.notebooks.filter(n=>!id||ids.has(n.projectId));
};
export const recordsIn=(book,id)=>{const ids=new Set(notebooksIn(book,id,{recursive:true}).map(n=>n.id));return book.entries.filter(e=>ids.has(e.notebookId));};
