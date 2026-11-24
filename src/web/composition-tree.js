// A normalized, ordered tree: stable element IDs survive moves, undo and reuse.
// Parent links describe layout; the array orders siblings. Research stays separate.
export const MAX_ELEMENTS=200, MAX_DEPTH=6;
export const acceptsChildren=element=>['container','disclosure','popup'].includes(element?.kind);
export function validTree(elements){
  if(!Array.isArray(elements)||elements.length>MAX_ELEMENTS)return false;
  const byId=new Map(elements.map(e=>[e?.id,e]));
  if(byId.size!==elements.length)return false;
  return elements.every(e=>{
    const seen=new Set([e?.id]);let parent=e?.parentId,depth=0;
    while(parent!==undefined&&parent!==null){
      const node=byId.get(parent);
      if(!acceptsChildren(node)||seen.has(parent)||++depth>MAX_DEPTH)return false;
      seen.add(parent);parent=node.parentId;
    }
    return true;
  });
}
