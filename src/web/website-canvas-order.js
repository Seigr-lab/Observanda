import {childrenOf,acceptsChildren} from './composition-tree.js';

// Move existing nodes instead of replacing their markup: active media, rich
// editors and event handlers remain owned by the current canvas document.
// Newly inserted content still comes from the authenticated preview renderer.
export function updateCanvasOrder(root,sections){
 if(!root)return false;
 const nodes=new Map([...root.querySelectorAll('[data-section-id]')].map(node=>[node.dataset.sectionId,node]));
 let moved=false;
 function arrange(parent,parentId=null){
  const children=childrenOf(sections,parentId);
  let before=parent.querySelector(':scope>[data-drop-parent]');
  for(const section of children.toReversed()){
   const node=nodes.get(section.id);if(!node)continue;
   if(node.parentElement!==parent||node.nextElementSibling!==before){parent.insertBefore(node,before);moved=true;}
   before=node;
  }
  for(const section of children){
   if(!acceptsChildren(section))continue;
   const node=nodes.get(section.id),content=node?.querySelector(section.kind==='popup'?':scope>details>.popup-body>.container-content':section.kind==='disclosure'?':scope>details>.container-content':':scope>.container-content');
   if(content)arrange(content,section.id);
  }
 }
 arrange(root);return moved;
}
