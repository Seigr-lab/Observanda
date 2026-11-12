// Keep new optional schema attributes out of an earlier, unstyled document.
// PM nodes share frozen attribute objects; only the newly serialized tree is changed.
export function portableEditorDocument(node){
 const value=node.toJSON();let named=false;
 function visit(block){
  if(block.attrs&&('semanticRole' in block.attrs||'semanticStyles' in block.attrs)){
   const attrs={...block.attrs};
   if(attrs.semanticRole===null)delete attrs.semanticRole;
   if(attrs.semanticRole)named=true;
   if(attrs.semanticStyles===null)delete attrs.semanticStyles;
   if(Object.keys(attrs).length)block.attrs=attrs;else delete block.attrs;
  }
  block.content?.forEach(visit);
 }
 visit(value);
 if(named&&!value.attrs?.semanticStyles)value.attrs={...value.attrs,semanticStyles:{version:1,roles:{}}};
 return value;
}

