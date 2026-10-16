import {referenceNamespaceMatches} from './research-reference-namespace.js';
import {AppError} from './errors.js';
import {recordRevision} from './research.js';
import {proseReferences} from './web/prose-model.js';
import {attemptReferences} from './web/attempt-model.js';
import {hasHomepage} from './web/website-layouts.js';
import {REGION_SLOTS,resolveRegion} from './web/website-regions.js';
import {projectPublication} from './publication-projection.js';
import {websitePageRecords} from './website-page-records.js';
import {bookSelectors} from './web/book-selectors.js';
import {websiteReferencePage} from './website-preview-references.js';
import {websiteCollectionPage,websiteCollectionRequests} from './website-preview-collections.js';
import {publicationCollectionKey} from './web/publication-collections.js';

// A page consumes the admitted record provider. Owner selection, credentials
// and snapshot validation remain outside presentation and collection layout.
export async function websitePreviewPage(records,metadata,{designTarget,referenceCursor=null,collections=[],signal}={}){
 const store=records.store,collectionRequests=websiteCollectionRequests(collections);
  const [kind,id]=designTarget.split(':'),collection={project:'projects',notebook:'notebooks',page:'pages'}[kind];
  const item=kind==='entry'?await records.get(id):collection?metadata[collection].find(v=>v.id===id):null;
  if(designTarget==='home'?!hasHomepage(metadata):!item)throw new AppError('INVALID');
  const layout=metadata.website.layouts.find(l=>l.target===designTarget),original=layout?.placement!=='replace';
  const sources=[{region:'layout',sections:layout?.sections??[]},...REGION_SLOTS.map(kind=>({region:kind,sections:resolveRegion(metadata.website,designTarget,kind)?.sections??[]}))];
  if(original)sources.push({region:'',sections:designTarget==='home'?metadata.website.home.sections:kind==='page'?item.sections:[]});
  // Hidden collections must not retrieve their contents, even in shared regions.
  const visible=(section,source)=>{
   if(!section.show)return false;let parent=section.parentId;
   while(parent){const ancestor=source.find(s=>s.id===parent);if(!ancestor?.show)return false;parent=ancestor.parentId;}return true;
  };
  const cards=new Map(),collectionPages=[];
  const includeCards=async(key,notebooks,filter,feed)=>{
   const {records:values,...page}=await websiteCollectionPage(records,{key,target:designTarget,notebooks,filter,feed,request:collectionRequests.get(key)});
   for(const value of values)cards.set(value.id,value);collectionPages.push({...page,recordIds:values.map(value=>value.id)});
  };
  const allNotebooks=new Set(metadata.notebooks.map(n=>n.id));
  const directLink=async href=>{if(typeof href==='string'&&/^entry:[a-f0-9-]{36}(?:#|$)/.test(href))await records.get(href.slice(6).split('#')[0]);};
  const richLinks=async node=>{for(const mark of node.marks??[])if(mark.type==='link')await directLink(mark.attrs.href);for(const child of node.content??[])await richLinks(child);};
  const references=[];
  for(const {sections:source,region} of sources)for(const section of source){
   signal?.throwIfAborted();
   if(section.kind==='records'&&visible(section,source)){
    const filter=section.filter??{},notebooks=filter.projectId?new Set(metadata.notebooks.filter(n=>n.projectId===filter.projectId).map(n=>n.id)):allNotebooks;
    await includeCards(publicationCollectionKey(section,region),notebooks,filter,section.feed);
   }
   if(section.kind==='media'&&visible(section,source))await records.get(section.entryId);
   await directLink(section.href);
   if(section.richText){references.push(...proseReferences(section.richText));await richLinks(section.richText);}
  }
  let referencePage=null;
  if(kind==='entry'){await records.neighbours(id);referencePage=await (records.referencePage?records.referencePage(id,referenceCursor):websiteReferencePage(records,id,referenceCursor));}
  else if(original&&(kind==='project'||kind==='notebook'))await includeCards('body',new Set(kind==='notebook'?[id]:metadata.notebooks.filter(n=>n.projectId===id).map(n=>n.id)));
  if([...collectionRequests.keys()].some(key=>!collectionPages.some(page=>page.key===key)))throw new AppError('INVALID');
  const ordered=()=>[...records.descriptors.values()].sort((a,b)=>a.position-b.position);
  const plan=websitePageRecords(metadata,ordered(),designTarget),entries=[];
  for(const descriptor of ordered())if(plan.records.has(descriptor.id)){
   signal?.throwIfAborted();const record=await records.original(descriptor.id);entries.push(record);
   if(descriptor.revision===null)descriptor.revision=records.revision?records.revision(record):recordRevision(record);
   references.push(...record.relations.map(l=>l.target),...[record.body,...record.sections.map(s=>s.body)].flatMap(proseReferences),...attemptReferences(record.attempt));
  }
  // Exact targets and selectors are resolved on demand, including old summaries
  // without a canonical revision. Ordinary links never load destination bodies.
  for(const target of references){
   signal?.throwIfAborted();if(target.kind!=='record')continue;
   const destination=records.resolveReference?await records.resolveReference(target):await referenceNamespaceMatches(store,target)?await records.get(target.id):null;if(!destination)continue;
   if((target.revision||target.selector)&&(destination.revision===null||target.selector&&(!target.revision||target.revision===destination.revision))){
    const record=await records.original(destination.id);destination.revision=records.revision?records.revision(record):recordRevision(record);destination.selectors=records.selectors?records.selectors(record):bookSelectors(record);
   }
  }
  // Presentation links are ordinary site destinations, not research URIs.
  const scopes=new Set([...plan.sections.map(s=>designTarget+'#'+s.id),...[...cards.keys()].map(id=>'cover:'+id)]);
  for(const region of REGION_SLOTS.map(kind=>resolveRegion(metadata.website,designTarget,kind)).filter(Boolean))for(const section of region.sections)scopes.add('region:'+region.id+'#'+section.id);
  for(const entry of entries)scopes.add('entry:'+entry.id);
  for(const display of metadata.website.presentation.media)if(scopes.has(display.scope))await directLink(display.link);
  const selection={...metadata,entries,recordCards:[...cards.values()],assets:metadata.website.assets,homeEnabled:hasHomepage(metadata)};
  signal?.throwIfAborted();
  const context=projectPublication(metadata,selection,{designTarget,workspaceContent:true,singlePage:true,entryDestinations:ordered(),previewCounts:await records.counts(),referencePage,collectionPages});
  signal?.throwIfAborted();return {metadata,context};
}
