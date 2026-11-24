export const referenceAttributes=['aria-labelledby','aria-describedby','headers'];
export const idTokens=value=>value?.trim().split(/\s+/).filter(Boolean)??[];
export function semanticIdIndex(doc){
 const ids=new Map();for(const n of doc.querySelectorAll('[id]')){
  if(n.id&&!n.closest('[data-observanda-editor]'))ids.set(n.id,ids.has(n.id)?null:n);
 }
 return ids;
}
export function referenceIssue(owner,attr,id,ids){
 if(!ids.has(id))return 'semanticRefMissing';
 const node=ids.get(id);if(!node)return 'semanticRefAmbiguous';
 if(attr==='headers'&&(node.localName!=='th'||owner===node||!owner.closest('table')||node.closest('table')!==owner.closest('table')))return 'semanticHeaderOutside';
 return null;
}
