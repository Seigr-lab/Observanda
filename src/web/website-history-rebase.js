import {websiteHTML,serializeWebsiteHTML} from './website-html-document.js';

import {applyChange} from './website-text-splice.js';
const ownerAttributes=['data-observanda-source','data-observanda-link','data-website-instance','data-website-region','data-website-feed','data-website-source-gallery','data-website-menu-id','data-website-appearance','data-website-theme-sheet'];
const managed=ownerAttributes.map(a=>'['+a+']').join(',')+',nav';
function grantedTextShape(fragment){
 const doc=websiteHTML(fragment),walker=doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT);
 while(walker.nextNode()){
  const text=walker.currentNode;
  if(text.parentElement?.closest('[data-observanda-part]'))text.data='';
 }
 return doc.body.innerHTML;
}
function pageMerge(base,edited,current,keepGrantedEdits){
 if(base===edited)return current;
 const nonce='website-'+crypto.randomUUID(),keys=new Map();
 const markers=new RegExp('<!--'+nonce+'-(\\d+)-->','g');
 function shell(html){
  const doc=websiteHTML(html),seen=new Map(),parts=new Map(),editableSources=new Set(),themes=[],roots=[doc];
  for(let i=0;i<roots.length;i++){
   const root=roots[i];
   for(const el of root.querySelectorAll(managed)){
    if(!root.contains(el))continue;
    const owner=ownerAttributes.find(attr=>el.hasAttribute(attr));
    const name=JSON.stringify([owner??el.localName,owner?el.getAttribute(owner):'']);
    const occurrence=seen.get(name)??0;seen.set(name,occurrence+1);
    const identity=name+'/'+occurrence;if(!keys.has(identity))keys.set(identity,keys.size);
    const id=keys.get(identity);parts.set(id,el.outerHTML);
    if(owner==='data-observanda-source')editableSources.add(id);
    el.replaceWith(doc.createComment(nonce+'-'+id));
   }
   for(const el of root.querySelectorAll('[data-website-theme],[data-website-page-theme]'))themes.push([el.localName,el.getAttribute('data-website-theme'),el.getAttribute('data-website-page-theme')]);
   for(const template of root.querySelectorAll('template'))roots.push(template.content);
  }
  return {html:serializeWebsiteHTML(doc),parts,editableSources,themes:JSON.stringify(themes)};
 }
 const old=shell(base),edit=shell(edited),live=shell(current);
 const result=applyChange(old.html,edit.html,live.html);if(result===null)return null;
 const identifiers=Array.from(result.matchAll(markers),match=>Number(match[1])),expected=Array.from(live.html.matchAll(markers),match=>Number(match[1]));
 if(identifiers.length!==expected.length||identifiers.some((id,i)=>id!==expected[i]))return null;
 let textRestored=false;
 const merged=result.replace(markers,(_,marker)=>{
  const id=Number(marker),latest=live.parts.get(id);
  if(keepGrantedEdits&&live.editableSources.has(id)&&old.parts.get(id)===latest&&edit.editableSources.has(id)){
   const changed=edit.parts.get(id);
   if(changed!==latest&&grantedTextShape(changed)===grantedTextShape(latest)){textRestored=true;return changed;}
  }
  return latest;
 });
 if(result===live.html&&!textRestored)return [...old.parts].some(([key,value])=>value!==edit.parts.get(key))?null:current;
 return shell(merged).themes===live.themes?merged:null;
}
export function rebaseAuthoredPage(base,draft,latest){
 const sameGrants=typeof base.sourceStamp==='string'&&base.sourceStamp===latest.sourceStamp&&base.sourceStamp===draft.sourceStamp;
 const html=pageMerge(base.html,draft.html,latest.html,sameGrants),css=applyChange(base.css,draft.css,latest.css);
 return html===null||css===null?null:{html,css};
}

// Each stack is replayed from the newly acknowledged page in transaction
// order. Never insert a historical copy of a current menu, component or grant.
export function rebasePageHistory(stack,from,next){
 let before=from,onto=next,skipped=0,bytes=0;
 const result=[];
 for(let i=stack.length-1;i>=0;i--){
  const entry=stack[i];
  // A presentation step names its copy and states; it holds no page text.
  if(entry.presentation){result.push(entry);continue;}
  const merged=rebaseAuthoredPage(before,entry,onto);
  if(merged===null)skipped++;
  else if(merged.html!==onto.html||merged.css!==onto.css){
   const size=merged.html.length+merged.css.length;if(result.length&&bytes+size>8*1024*1024){skipped+=i+1;break;}
   bytes+=size;onto={...entry,...merged,selection:null,sourceStamp:next.sourceStamp};result.push(onto);
  }
  before=entry;
 }
 return {entries:result.reverse(),skipped};
}
