import {digest} from './storage-format.js';
import {revisionText} from './web/revision-model.js';
import {parseResearchReference} from './web/research-reference.js';
import {selectorAnchor,selectorExists} from './web/book-selectors.js';
import {projectProse} from './web/prose-model.js';
import {linkAvailable} from './web/website-model.js';
import {bookText} from './web/book-messages.js';

// One link/inline-figure admission for full pages and their bounded card text.
// Entries may be originals or admitted descriptors of the pinned edition.
function admittedOwner(items,target,workspaceId,identity){
 const candidates=(items??[]).filter(item=>(item.referenceNamespaces??[workspaceId]).includes(target.workspaceId)&&identity(item)===target.id);
 const owner=item=>item.sourceWorkspaceId??item.referenceNamespaces?.[0]??workspaceId;
 const exact=candidates.filter(item=>owner(item)===target.workspaceId);
 if(exact.length)return exact;
 return new Set(candidates.map(owner)).size===1?candidates:[];
}
export function publicationRecordDestination(entries,target,workspaceId){
 const candidates=admittedOwner(entries,target,workspaceId,item=>item.recordId??item.id),matches=item=>target.revision?(item.revision??digest(revisionText(item)))===target.revision:!item.historical;
 return (target.revision?candidates.find(item=>item.historical&&matches(item)):null)??candidates.find(matches)??null;
}
export function publicationCollectionDestination(selection,target,workspaceId){
 const collection={project:'projects',notebook:'notebooks'}[target.kind];
 return collection?admittedOwner(selection[collection],target,workspaceId,item=>item.sourceId??item.id)[0]??null:null;
}
export function publicationTargetSelector(item,selector){
 if(!selector)return null;
 const selected=item.selectors?.find(value=>value.kind===selector.kind&&(value.sourceId??value.id)===selector.id);
 return selected?{version:selector.version,kind:selector.kind,id:selected.id}:selectorExists(item,selector)?selector:null;
}
export function publicationLinkResolver(workspaceId,selection,{workspaceContent=false}={}){
 return href=>{
  const target=parseResearchReference(href);
  if(!target)return href.startsWith('#')||/^(https?:|mailto:|tel:)/.test(href)||linkAvailable(href,selection)?href:null;
  if(target.kind==='workspace')return target.workspaceId===workspaceId&&target.id===workspaceId&&selection.homeEnabled?'home':null;
  let item=target.kind==='record'?publicationRecordDestination(selection.entries,target,workspaceId):publicationCollectionDestination(selection,target,workspaceId);if(!item)return null;
  if(target.revision&&(item.revision??digest(revisionText(item)))!==target.revision)return null;
  if(target.kind==='record'&&!item.selectors)item={...item,attachments:item.attachments.filter(a=>workspaceContent||a.share)};
  const selector=publicationTargetSelector(item,target.selector);
  return !target.selector||selector?(target.kind==='record'?'entry':target.kind)+':'+item.id+(selector?'#'+selectorAnchor(selector):''):null;
 };
}
export function publicationRecordText(value,record,resolve,{workspaceContent=false}={}){
 const doc=projectProse(value,resolve);if(typeof doc!=='object')return doc;
 const allowed=new Set([...record.figures.map(f=>f.id),...record.attachments.filter(a=>workspaceContent||a.share).map(a=>a.id)]);
 const visit=n=>{if(n.type==='book_figure'&&!allowed.has(n.attrs.figureId)){n.type='paragraph';n.content=[{type:'text',text:bookText('privateFigure')}];delete n.attrs;}for(const c of n.content??[])visit(c);};visit(doc);return doc;
}
