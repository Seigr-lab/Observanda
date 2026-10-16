import {inheritMaterialNamespace} from './material-reference-requests.js';
// Add the displayed document's owner to implicit nested links only. Saved
// documents and their hashes remain untouched; explicit foreign owners survive.
export function materialReferenceElements(root,workspaceId){
 if(!workspaceId)return;
 for(const control of root.querySelectorAll('[data-action="material-reference"][data-ref]')){
  const ref=JSON.parse(control.dataset.ref);control.dataset.ref=JSON.stringify(inheritMaterialNamespace(ref,workspaceId));
 }
 for(const control of root.querySelectorAll('[data-action="material-measurement-inspect"][data-source]')){
  const source=JSON.parse(control.dataset.source);control.dataset.source=JSON.stringify({...source,ref:inheritMaterialNamespace(source.ref,workspaceId)});
 }
}
