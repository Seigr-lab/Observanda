// Preserve node identity, focus, text selection and scroll during live updates.
export function updateText(node,value){const next=String(value??'');if(node.textContent!==next)node.textContent=next;}
export function updateProperty(node,name,value){if(node[name]!==value)node[name]=value;}
export function updateAttribute(node,name,value){
 if(value===null||value===undefined){if(node.hasAttribute(name))node.removeAttribute(name);}
 else if(node.getAttribute(name)!==String(value))node.setAttribute(name,String(value));
}
export function placeAt(parent,node,index){if(parent.children[index]!==node)parent.insertBefore(node,parent.children[index]??null);}
