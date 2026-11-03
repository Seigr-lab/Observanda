// These helpers edit HTML documents directly. No research model is reconstructed.
export function websiteHTML(html){
 if(typeof html!=='string')throw new TypeError('Expected an HTML document');
 return new DOMParser().parseFromString(html,'text/html');
}
export function serializeWebsiteHTML(document){
 return '<!doctype html>\n'+document.documentElement.outerHTML;
}
export function loadWebsiteCanvas(document,html,css,stylesheet){
 // This frame has the saved page's URL, revision-specific resource policy and
 // no script execution. Relative links and images therefore resolve exactly as
 // they do in the saved website, including pages in nested directories.
 const source=websiteHTML(html),base=document.location.href;
 // The host has already installed its stricter revision-scoped HTTP policy.
 // Keep the published policy inert only in the editable copy so the host can
 // paint unsaved CSS. Restore the original attribute when serializing.
 for(const meta of source.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]')){
  meta.dataset.observandaEditorHttpEquiv=meta.getAttribute('http-equiv');meta.removeAttribute('http-equiv');
 }
 for(const link of source.querySelectorAll('link[rel="stylesheet"][href]'))if(new URL(link.getAttribute('href'),base).href===stylesheet){link.dataset.observandaEditorStylesheet=link.getAttribute('href');link.removeAttribute('href');}
 const style=source.createElement('style');style.dataset.observandaEditor='';
 style.textContent=css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,(match,a,b,c)=>{const url=(a??b??c).trim();if(!url||url.startsWith('#'))return match;return 'url('+JSON.stringify(new URL(url,stylesheet).href)+')';});
 source.head.append(style);document.replaceChild(document.importNode(source.documentElement,true),document.documentElement);
}
export function websiteCanvasValue(document){
 const copy=document.cloneNode(true);
 for(const image of copy.querySelectorAll('img[data-observanda-editor-image]')){
  image.setAttribute('src',image.dataset.observandaEditorImage);image.removeAttribute('data-observanda-editor-image');
 }
 for(const meta of copy.querySelectorAll('meta[data-observanda-editor-http-equiv]')){
  meta.setAttribute('http-equiv',meta.dataset.observandaEditorHttpEquiv);meta.removeAttribute('data-observanda-editor-http-equiv');
 }
 for(const node of copy.querySelectorAll('[data-observanda-editor]'))node.remove();
 for(const node of copy.querySelectorAll('[data-observanda-editor-stylesheet]')){node.setAttribute('href',node.dataset.observandaEditorStylesheet);node.removeAttribute('data-observanda-editor-stylesheet');}
 for(const node of copy.querySelectorAll('[data-observanda-editor-editable]')){
  const value=node.dataset.observandaEditorEditable;if(value==='absent')node.removeAttribute('contenteditable');else node.setAttribute('contenteditable',value);node.removeAttribute('data-observanda-editor-editable');
 }
 return serializeWebsiteHTML(copy);
}
export function editWebsiteCanvas(document){
 const body=document.body;body.dataset.observandaEditorEditable=body.getAttribute('contenteditable')??'absent';body.contentEditable='true';
 // Provenance wrappers must remain intact. Authored surrounding layout stays
 // editable; source visibility changes replace these owned fragments on disk.
 for(const node of body.querySelectorAll('[data-observanda-source],[data-website-feed]')){
  node.dataset.observandaEditorEditable=node.getAttribute('contenteditable')??'absent';node.contentEditable='false';
  if(node.hasAttribute('data-observanda-display-id')||node.closest('[data-website-feed]'))continue;
  for(const part of node.querySelectorAll('[data-observanda-part]')){
   if(part.querySelector('[data-observanda-part]')||!part.textContent.trim())continue;
   part.dataset.observandaEditorEditable=part.getAttribute('contenteditable')??'absent';part.contentEditable='true';
  }
 }
}
// Update a dirty authored page only when the saved changes are confined to its
// existing converted placements. Independent edits by another author require
// explicit conflict handling. Never save or undo a withdrawn source revision.
export function rebaseWebsitePlacements(base,draft,next){
 if(base===next)return draft;
 const snapshot=text=>{
  const document=websiteHTML(text),markers=[...document.querySelectorAll('[data-observanda-source]')];
  const parts=markers.map(node=>({id:node.getAttribute('data-observanda-source'),html:node.outerHTML,node}));
  const shell=document.cloneNode(true);for(const node of shell.querySelectorAll('[data-observanda-source]'))node.replaceWith(shell.createComment('source:'+node.getAttribute('data-observanda-source')));
  return {document,parts,shell:serializeWebsiteHTML(shell)};
 };
 const previous=snapshot(base),saved=snapshot(next);if(!previous.parts.length||previous.shell!==saved.shell)return null;
 const edited=snapshot(draft);if(edited.parts.length!==previous.parts.length)return null;
 for(let i=0;i<previous.parts.length;i++){
  const before=previous.parts[i],incoming=saved.parts[i],local=edited.parts[i];if(!incoming||incoming.id!==before.id||local.id!==before.id)return null;
  if(before.html===incoming.html)continue;
  const replacement=edited.document.importNode(incoming.node,true);
  if(local.html!==before.html){
   const leaves=node=>[...node.querySelectorAll('[data-observanda-part]')].filter(part=>!part.querySelector('[data-observanda-part]'));
   const key=part=>part.getAttribute('data-observanda-part');
   const savedParts=new Map(leaves(replacement).map(part=>[key(part),part]));
   const restored=local.node.cloneNode(true),original=leaves(before.node),modified=leaves(restored);
   if(original.length!==modified.length)return null;
   for(let j=0;j<original.length;j++){
    const from=original[j],edit=modified[j];if(key(from)!==key(edit))return null;
    if(from.outerHTML===edit.outerHTML)continue;
    const keep=savedParts.get(key(from));if(keep&&keep.outerHTML===from.outerHTML)keep.replaceWith(edited.document.importNode(edit,true));
    edit.replaceWith(restored.ownerDocument.importNode(from,true));
   }
   if(restored.outerHTML!==before.html)return null;
  }
  local.node.replaceWith(replacement);
 }
 return serializeWebsiteHTML(edited.document);
}
