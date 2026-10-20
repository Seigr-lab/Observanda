import {MAX_ELEMENTS,validTree,descendantsOf} from './composition-tree.js';
import {instantiateLayout} from './website-layouts.js';
import {validSections} from './website-model.js';
import {validPresentation} from './media-presentation.js';

// A link pins the actual parent document, not a mutable template name. Current
// sections remain ordinary composition data; rendering never follows this link.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const elementId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const copy=value=>value===undefined?undefined:structuredClone(value);
const same=(a,b)=>{
 if(a===b)return true;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i]));
 return object(a)&&object(b)&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));
};
const invalid=message=>{throw new Error(message??'The inherited layout is no longer valid.');};
const referenceFields=new Set(['filter','entryId','attachmentId','assetId','assetIds']);
const researchKinds=new Set(['records','projects','pages','media']);
const internalLink=value=>typeof value==='string'&&/^(?:observanda:\/\/|(?:entry|project|notebook|page):)/.test(value);
const contentKeys=['body','format','richText'];
const contentOf=section=>Object.fromEntries(contentKeys.filter(key=>Object.hasOwn(section,key)).map(key=>[key,section[key]]));
function contentReferences(content){
 const refs=[...(content.body??'').matchAll(/(?:observanda:\/\/[^\s)]+|(?:entry|project|notebook|page):[a-f0-9-]{36})/g)].map(match=>match[0]);
 function walk(node){if(node.attrs?.figureId)refs.push('figure:'+node.attrs.figureId);for(const mark of node.marks??[])if(mark.type==='link'&&internalLink(mark.attrs?.href))refs.push(mark.attrs.href);for(const child of node.content??[])walk(child);}
 if(content.richText)walk(content.richText);return [...new Set(refs)].sort();
}
const sensitive=section=>section&&(researchKinds.has(section.kind)||internalLink(section.href)||contentReferences(contentOf(section)).length||Object.entries(section).some(([key,value])=>referenceFields.has(key)&&value!==null&&(!Array.isArray(value)||value.length)));
const mediaKey=item=>item.sectionId+':'+item.id;
function visible(items,id){let item=items.get(id);while(item){if(!item.show)return false;item=items.get(item.parentId);}return true;}

export function validTemplateLink(link){
 return exact(link,['version','templateId','root','sectionIds'])&&link.version===1&&uuid(link.templateId)&&revision(link.root)&&Array.isArray(link.sectionIds)&&link.sectionIds.length<=MAX_ELEMENTS&&link.sectionIds.every(item=>exact(item,['templateId','pageId'])&&elementId(item.templateId)&&elementId(item.pageId))&&new Set(link.sectionIds.map(item=>item.templateId)).size===link.sectionIds.length&&new Set(link.sectionIds.map(item=>item.pageId)).size===link.sectionIds.length;
}
export function validTemplateSnapshot(snapshot){
 return exact(snapshot,['sections','media'])&&validSections(snapshot.sections)&&Array.isArray(snapshot.media)&&snapshot.media.every(item=>object(item)&&elementId(item.sectionId)&&snapshot.sections.some(section=>section.id===item.sectionId)&&!Object.hasOwn(item,'scope'))&&validPresentation({covers:[],media:snapshot.media.map(({sectionId,...item})=>({...item,scope:'home#'+sectionId}))});
}
function checked(snapshot){if(!validTemplateSnapshot(snapshot))invalid('The layout sections or media settings are not valid.');return snapshot;}
export function snapshotTemplateUse(website,target,sections){
 const ids=new Set(sections.map(section=>section.id)),prefix=target+'#';
 return checked({sections:copy(sections),media:(website.presentation?.media??[]).filter(item=>item.scope.startsWith(prefix)&&ids.has(item.scope.slice(prefix.length))).map(({scope,...item})=>({...copy(item),sectionId:scope.slice(prefix.length)}))});
}
// Return a replacement array; keep covers and unrelated page/region settings in
// their existing owners. This is the same per-use scope mapping as layout copy.
export function placeTemplateMedia(website,target,snapshot,{replace=true}={}){
 checked(snapshot);const prefix=target+'#',ids=new Set(snapshot.sections.map(section=>section.id));
 return [...(website.presentation?.media??[]).filter(item=>replace?!item.scope.startsWith(prefix):!item.scope.startsWith(prefix)||!ids.has(item.scope.slice(prefix.length))).map(copy),...snapshot.media.map(({sectionId,...item})=>({...copy(item),scope:prefix+sectionId}))];
}
function remap(snapshot,ids){
 let index=0;const sections=instantiateLayout(snapshot.sections,()=>ids.get(snapshot.sections[index++].id));
 return {sections,media:snapshot.media.map(item=>({...copy(item),sectionId:ids.get(item.sectionId)}))};
}
function allocate(makeId,used){const id=makeId();if(!elementId(id)||used.has(id))invalid('Layout element IDs must be unique.');used.add(id);return id;}
export function createTemplateUse({templateId,root,source,makeId=()=>crypto.randomUUID()}){
 checked(source);const used=new Set(),ids=new Map(source.sections.map(section=>[section.id,allocate(makeId,used)])),link={version:1,templateId,root,sectionIds:[...ids].map(([templateId,pageId])=>({templateId,pageId}))};
 if(!validTemplateLink(link))invalid();return {...remap(source,ids),link};
}
export function sourceTemplateUpdate({link,current,template,makeId=()=>crypto.randomUUID()}){
 if(!validTemplateLink(link))invalid();checked(current);checked(template);
 const existing=new Set(template.sections.map(section=>section.id)),reverse=new Map(link.sectionIds.map(item=>[item.pageId,item.templateId])),used=new Set(existing),ids=new Map();
 for(const section of current.sections){const prior=reverse.get(section.id);ids.set(section.id,prior&&existing.has(prior)?prior:allocate(makeId,used));}
 return checked(remap(current,ids));
}

// A deterministic conflict ID describes the parent element, not a freshly minted
// child ID, so re-deriving a preview under a checked document revision is safe.
export function previewTemplateUpdate({link,base,current,incoming,root,makeId=()=>crypto.randomUUID(),decisions={}}){
 if(!validTemplateLink(link)||!revision(root)||!object(decisions)||Object.values(decisions).some(value=>!['local','template'].includes(value)))invalid();
 checked(base);checked(current);checked(incoming);
 const ids=new Map(link.sectionIds.map(item=>[item.templateId,item.pageId]));
 if(ids.size!==base.sections.length||base.sections.some(section=>!ids.has(section.id)))invalid('The pinned layout does not match its element correspondence.');
 const used=new Set([...ids.values(),...current.sections.map(section=>section.id)]);
 for(const section of incoming.sections)if(!ids.has(section.id))ids.set(section.id,allocate(makeId,used));
 const prior=remap(base,ids),next=remap(incoming,ids),reverse=new Map([...ids].map(([a,b])=>[b,a]));
 const conflicts=[],changes=[];
 const decide=(id,kind,sectionId,path,b,l,n)=>{
  const decision=decisions[id]??null;conflicts.push({id,kind,sectionId,path,base:copy(b)??null,local:copy(l)??null,incoming:copy(n)??null,decision});
  return copy(decision==='template'?n:l);
 };
 const key=(sectionId,path)=>JSON.stringify([reverse.get(sectionId)??sectionId,...path]);
 const merge=(b,l,n,sectionId,path=[],protect=true)=>{
  if(same(l,n)||same(b,n))return copy(l);
  if(protect&&path.length===1&&referenceFields.has(path[0])||['href','link'].includes(path.at(-1))&&(internalLink(l)||internalLink(n)))return decide(key(sectionId,path),'source',sectionId,path,b,l,n);
  if(path.length===1&&(path[0]==='show'&&l===false&&n===true||path[0]==='parentId'&&!visible(lm,sectionId)&&visible(nm,sectionId)))return decide(key(sectionId,path),'visibility',sectionId,path,b,l,n);
  if(same(b,l))return copy(n);
  if(object(b)&&object(l)&&object(n)){
   const result={};for(const field of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(n)])){
    const value=merge(b[field],l[field],n[field],sectionId,[...path,field],protect);if(value!==undefined)result[field]=value;
   }return result;
  }
  return decide(key(sectionId,path),path[0]==='parentId'?'placement':'edit',sectionId,path,b,l,n);
 };
 const byId=snapshot=>new Map(snapshot.sections.map(section=>[section.id,section]));
 const bm=byId(prior),lm=byId(current),nm=byId(next),result=new Map();
 const sectionMedia=(snapshot,id)=>snapshot.media.filter(item=>item.sectionId===id);
 const locallyChanged=id=>{
  const b=bm.get(id),l=lm.get(id),bi=prior.sections.findIndex(item=>item.id===id),li=current.sections.findIndex(item=>item.id===id);
  const moved=prior.sections.some((item,index)=>lm.has(item.id)&&Math.sign(index-bi)!==Math.sign(current.sections.findIndex(value=>value.id===item.id)-li));
  return !same(b,l)||!same(sectionMedia(prior,id),sectionMedia(current,id))||moved;
 };
 for(const id of new Set([...bm.keys(),...lm.keys(),...nm.keys()])){
  const b=bm.get(id),l=lm.get(id),n=nm.get(id);let value;
  if(!b){
   if(l)value=copy(l);
   else if(sensitive(n))value=decide(key(id,['addition']),'source',id,['addition'],undefined,undefined,n);
   else value=copy(n);
  }else if(!n){
   const changed=l&&[...descendantsOf(current.sections,id)].some(locallyChanged);
   value=changed?decide(key(id,['removal']),'removal',id,[],b,l,undefined):undefined;
  }else if(!l){
   value=!same(b,n)||!same(sectionMedia(prior,id),sectionMedia(next,id))?decide(key(id,['deletion']),'deletion',id,[],b,undefined,n):undefined;
  }else if(b.kind!==l.kind||b.kind!==n.kind){
   value=same(b,n)||same(l,n)?copy(l):same(b,l)&&!sensitive(n)&&!(l.show===false&&n.show===true)?copy(n):decide(key(id,['kind']),'kind',id,[],b,l,n);
  }else{
   // Merge leaf properties even when the whole local section is unchanged: a
   // changed media/source pointer must still require an explicit decision.
   const bc=contentOf(b),lc=contentOf(l),nc=contentOf(n);let content;
   if(same(lc,nc)||same(bc,nc))content=copy(lc);
   else if(!same(contentReferences(bc),contentReferences(nc)))content=decide(key(id,['content']),'source',id,['content'],bc,lc,nc);
   else if(same(bc,lc))content=copy(nc);
   else content=decide(key(id,['content']),'edit',id,['content'],bc,lc,nc);
   value={...content};for(const field of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(n)])){
    if(contentKeys.includes(field))continue;
    const merged=field==='id'?id:merge(b[field],l[field],n[field],id,[field]);if(merged!==undefined)value[field]=merged;
   }
  }
  if(value)result.set(id,value);
 }
 // Removing a parent cannot strand local additions. Retain that branch by
 // default; accepting the structural choice explicitly chooses the other tree.
 let sections=[...result.values()];
 if(!validTree(sections)){
  const selected=decide('structure','structure',null,[],prior.sections,current.sections,next.sections);
  sections=selected.map(section=>({...copy(result.get(section.id)??section),...(Object.hasOwn(section,'parentId')?{parentId:section.parentId}:{parentId:null})}));
  // Fields from a changed kind must not survive a structural fallback.
  if(!validSections(sections))sections=copy(selected);
 }
 // Pairwise three-way order preserves independent inserts and single-sided
 // reorders. Cyclic concurrent reorder constraints become one explicit choice.
 const order=orderedSections(sections,prior.sections,current.sections,next.sections);
 if(order)sections=order;
 else{
  const selected=decide('order','order',null,[],prior.sections.map(s=>s.id),current.sections.map(s=>s.id),next.sections.map(s=>s.id)),map=new Map(sections.map(s=>[s.id,s]));
  sections=[...selected.filter(id=>map.has(id)).map(id=>map.get(id)),...sections.filter(s=>!selected.includes(s.id))];
 }
 const live=new Set(sections.map(section=>section.id)),media=[];
 const mediaMap=snapshot=>new Map(snapshot.media.map(item=>[mediaKey(item),item]));
 const bMedia=mediaMap(prior),lMedia=mediaMap(current),nMedia=mediaMap(next);
 for(const id of new Set([...bMedia.keys(),...lMedia.keys(),...nMedia.keys()])){
  const b=bMedia.get(id),l=lMedia.get(id),n=nMedia.get(id),sectionId=(l??n??b).sectionId;if(!live.has(sectionId))continue;let value;
  if(!b&&!l&&n)value=decide(key(sectionId,['media',n.id]),'media',sectionId,['media',n.id],undefined,undefined,n);
  else value=merge(b,l,n,sectionId,['media',(l??n??b).id],false);
  if(value)media.push(value);
 }
 for(const section of sections)if(!same(lm.get(section.id),section))changes.push({kind:lm.has(section.id)?'section':'addition',sectionId:section.id});
 for(const section of current.sections)if(!live.has(section.id))changes.push({kind:'removal',sectionId:section.id});
 if(!same(current.sections.map(s=>s.id),sections.map(s=>s.id)))changes.push({kind:'order',sectionId:null});
 if(!same(current.media,media))changes.push({kind:'media',sectionId:null});
 // A prior structural decision can disappear when another choice changes.
 // Inactive decisions have no effect; only currently derived conflicts gate
 // readiness. The server separately binds review acceptance to its draft token.
 const snapshot={sections,media};checked(snapshot);
 return {...snapshot,link:{version:1,templateId:link.templateId,root,sectionIds:incoming.sections.map(section=>({templateId:section.id,pageId:ids.get(section.id)}))},conflicts,changes,ready:conflicts.every(item=>item.decision!==null)};
}
function orderedSections(sections,base,local,incoming){
 const positions=items=>new Map(items.map((item,i)=>[item.id,i])),b=positions(base),l=positions(local),n=positions(incoming),edges=new Map(sections.map(item=>[item.id,new Set()])),degree=new Map(sections.map(item=>[item.id,0]));
 const relation=(map,a,z)=>map.has(a)&&map.has(z)?Math.sign(map.get(a)-map.get(z)):null;
 for(let i=0;i<sections.length;i++)for(let j=i+1;j<sections.length;j++){
  const a=sections[i].id,z=sections[j].id,before=relation(b,a,z),left=relation(l,a,z),right=relation(n,a,z);
  const direction=left===null?right:right===null?left:left===right?left:left===before?right:right===before?left:null;
  if(direction===null)continue;const from=direction<0?a:z,to=direction<0?z:a;edges.get(from).add(to);degree.set(to,degree.get(to)+1);
 }
 const remaining=new Map(sections.map(item=>[item.id,item])),result=[];
 while(remaining.size){const id=[...remaining.keys()].find(id=>degree.get(id)===0);if(id===undefined)return null;result.push(remaining.get(id));remaining.delete(id);for(const to of edges.get(id))degree.set(to,degree.get(to)-1);}
 return result;
}
