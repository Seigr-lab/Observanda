import {managedWebsiteContent} from './website-authored-nodes.js';

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
export function authorReference(owner,target,attr,ids){
 if(!target?.isConnected||target.ownerDocument!==owner.ownerDocument||target.closest(managedWebsiteContent)||target===owner)return false;
 if(target.id&&(ids.get(target.id)!==target||/\s/.test(target.id)))return false;
 return attr!=='headers'||target.localName==='th'&&owner.closest('table')&&target.closest('table')===owner.closest('table');
}
export function semanticText(node){
 const walker=node.ownerDocument.createTreeWalker(node,4);let text='',n;
 while(text.length<96&&(n=walker.nextNode()))if(!n.parentElement.closest('[hidden],[aria-hidden="true"],script,style,'+managedWebsiteContent))text+=(n.nodeValue??'').trim().slice(0,96-text.length)+' ';
 return text.trim().replace(/\s+/g,' ')||node.getAttribute('alt')||node.getAttribute('aria-label')||'';
}
