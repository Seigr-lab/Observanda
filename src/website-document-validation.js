import {verifyWebsiteTemplateBindings} from './website-template-inheritance.js';
import {withWebsiteSourceSelections} from './website-source-selections.js';
// A complete website remains one immutable document. Validate its growing
// collections one item at a time; the empty header collections below are only
// internal sentinels and never stand for a replacement authoring document.
import {validateCatalogueMetadata} from './model.js';
import {SnapshotIndex} from './snapshot-index.js';
import {projectWebsiteAttachmentChoices} from './website-selection-admission.js';
import {withScratch} from './scratch-work.js';
import {AppError} from './errors.js';
import {websiteBook,validWebsites} from './web/website-sites-model.js';
import {researchId} from './web/research-reference.js';
import {publicationPresentationTarget} from './web/publication-presentation-target.js';
import {validWebsitePage,validWebsiteNavigationItem,validWebsiteAsset,validWebsiteLayout,validWebsiteBranding} from './web/website-item-validation.js';
const invalid=field=>{throw new AppError('INVALID',[{field}]);};
const paths={pages:['document','pages'],navigation:['document','website','navigation'],assets:['document','website','assets'],layouts:['document','website','layouts'],branding:['document','branding']};
const define=(value,name,item)=>Object.defineProperty(value,name,{value:item,enumerable:true,writable:true,configurable:true});
async function headerObject(document,path,omitted,nested,{signal}={}){
 const value={},target=await document.tree.select(document.root,path);if(!target)invalid('website');
 const node=target.inline?{type:'inline',value:target.value}:await document.tree.node(target.revision);
 if(node.type==='inline'&&(!node.value||typeof node.value!=='object'||Array.isArray(node.value)))invalid('website');
 const names=node.type==='inline'?Object.keys(node.value):await document.tree.propertyNames(target.revision);
 for(const name of names){
  signal?.throwIfAborted();const item=omitted.includes(name)?[]:Object.hasOwn(nested,name)?await nested[name]():(await document.field([...path,name],{signal})).value;
  define(value,name,item);
 }
 return value;
}
export function websiteDocumentHeader(document,{signal}={}){
 const website=()=>headerObject(document,['document','website'],['navigation','assets','layouts','researchSources'],{},{signal});
 const content=()=>headerObject(document,['document'],['pages','branding'],{website},{signal});
 return headerObject(document,[],[],{document:content},{signal});
}
async function* collection(document,path,{signal,sectionsOnly=false}={}){
 signal?.throwIfAborted();const target=await document.tree.select(document.root,path);if(!target)invalid('website');
 const node=target.inline?{type:'inline',value:target.value}:await document.tree.node(target.revision);
 // Inline children are already bounded values. Avoid RecordDocument.items()'s
 // temporary retain step so a verifier cannot flush new durable blocks.
 if(node.type==='inline'){
  if(!Array.isArray(node.value))invalid('website');
  for(const [position,value] of node.value.entries()){signal?.throwIfAborted();yield {position,value:sectionsOnly?value.sections??[]:value};}return;
 }
 for await(const item of document.items(path,{signal})){
  signal?.throwIfAborted();const value=sectionsOnly?(await document.tree.selected(item.value,['sections'])).value??[]:await document.tree.read(item.value);
  yield {position:item.index,value};
 }
}
function validateHeader(site,snapshot,{draft=false}={}){
 if(snapshot.metadata.formatVersion!==21)throw new AppError('FORMAT');
 if(typeof draft!=='boolean'||!validWebsites([site],snapshot.metadata))invalid('website');
 const book=websiteBook(snapshot.metadata,site),website=book.website;
 // Empty collections are internal sentinels only. Selected checkpoints validate
 // their changed members separately; final admission proves every membership.
 const header={...book,pages:[],branding:[],website:{...website,navigation:[],assets:[],layouts:[]}};
 validateCatalogueMetadata(header);
 return site;
}
export async function validateWebsiteDocumentHeader(store,snapshot,document,{signal,draft=false}={}){
 void store;signal?.throwIfAborted();return validateHeader(await websiteDocumentHeader(document,{signal}),snapshot,{draft});
}
export async function validateWebsiteDocument(store,snapshot,document,{signal,draft=false,previous}={}){
 const site=await validateWebsiteDocumentHeader(store,snapshot,document,{signal,draft}),book=websiteBook(snapshot.metadata,site),website=book.website;
 const counts={};for(const [name,path] of Object.entries(paths))counts[name]=await document.tree.arrayLength(document.root,path);
 const index=new SnapshotIndex(store);
 const researchIdentity=async id=>snapshot.indexVersion?index.member(await index.find({root:snapshot.membership},'identity:'+id)):snapshot.records.find(row=>row.id===id||row.sections.includes(id));
 return withScratch(async proof=>{
  const unique=async(key,field,value=null)=>{if(!await proof.add(key,value))invalid(field);};
  for(const id of [book.id,...book.projects.map(item=>item.id),...book.notebooks.map(item=>item.id),...book.themes.map(item=>item.id)])await unique('identity:'+id,'id');
  for(const theme of book.themes){signal?.throwIfAborted();if(await researchIdentity(theme.id))invalid('themes');}
  for(const item of book.projects)await unique('target:project:'+item.id,'project');
  for(const item of book.notebooks)await unique('target:notebook:'+item.id,'notebook');
  for await(const {value:page} of collection(document,paths.pages,{signal})){
   if(!validWebsitePage(page,{draft}))invalid('pages');await unique('identity:'+page.id,'pages');
   if(await researchIdentity(page.id))invalid('pages');await unique('target:page:'+page.id,'pages');
  }
  const targetExists=async(target,{records=true,home=true}={})=>{
   if(typeof target!=='string')return false;
   if(target==='home')return home;
   if(await proof.has('target:'+target))return true;
   if(publicationPresentationTarget(website,target,{records}))return true;
   if(!records||!target.startsWith('entry:')||!researchId(target.slice(6)))return false;
   const row=await store.member(snapshot,target.slice(6));if(!row)return false;
   const notebookId=row.notebookId??(await store.record(row.id,row.revision)).notebookId;
   if(!book.notebooks.some(item=>item.id===notebookId))return false;
   await proof.add('target:'+target);return true;
  };
  for await(const {value:item} of collection(document,paths.navigation,{signal})){
   if(!validWebsiteNavigationItem(item)||!await targetExists(item.target,{records:false}))invalid('navigation');
   await unique('navigation:'+item.target,'website',{parent:item.parent??null});
  }
  for await(const {value:item} of collection(document,paths.navigation,{signal})){
   const seen=new Set([item.target]);let parent=item.parent;
   while(parent){
    signal?.throwIfAborted();if(seen.has(parent)||seen.size>8)invalid('menu hierarchy');seen.add(parent);
    const ancestor=await proof.get('navigation:'+parent);if(!ancestor)invalid('menu hierarchy');parent=ancestor.parent;
   }
  }
  for await(const {value:asset} of collection(document,paths.assets,{signal})){
   if(!validWebsiteAsset(asset))invalid('website assets');await unique('asset:'+asset.id,'website assets');
  }
  for await(const {value:layout} of collection(document,paths.layouts,{signal})){
   signal?.throwIfAborted();if(!validWebsiteLayout(layout)||!await targetExists(layout.target,{home:website.home.enabled!==false}))invalid('page layouts');
   await unique('layout:'+layout.target,'page layouts');
  }
  for await(const {value:item} of collection(document,paths.branding,{signal})){
   signal?.throwIfAborted();if(!validWebsiteBranding(item)||!await targetExists(item.target))invalid('branding');await unique('branding:'+item.target,'branding');
  }
  await withWebsiteSourceSelections(document,async sources=>{for await(const source of sources.items())if(source.workspaceId===snapshot.metadata.id)invalid('website sources');},{signal});
  await verifyWebsiteTemplateBindings(store,document,{signal});
  await validateWebsiteDocumentSelection(store,snapshot,site,{signal,previous});
  signal?.throwIfAborted();return {site,counts};
 },{signal});
}

// Check selected research consent independently of the growing website values.
// A checkpoint supplies its previous admitted header; saved verification uses
// the immutable selection itself to preserve unchanged historical choices.
export async function validateWebsiteDocumentSelection(store,snapshot,site,{signal,previous}={}){
 const book=websiteBook(snapshot.metadata,site),notebooks=new Set(book.notebooks.map(item=>item.id));
 const selected=new Map(site.selection.records.map(value=>[value.id,value])),saved=new Map(((previous===undefined?site:previous)?.selection?.records??[]).map(value=>[value.id,value]));
 async function* selectionRows(){
  for(const choice of selected.values()){
   signal?.throwIfAborted();const row=await store.member(snapshot,choice.id);
   if(!row||!notebooks.has(row.notebookId))invalid('website selection');
   if(choice.attachments.length)yield row;
  }
 }
 for await(const summary of store.queryDocuments(selectionRows(),snapshot.metadata,{signal,search:false,publication:true}))projectWebsiteAttachmentChoices(selected.get(summary.id).attachments,summary.publication.attachments,saved.get(summary.id)?.attachments);
 signal?.throwIfAborted();
}

// Match the existing authoring protection: deleting a library entry must not
// detach a use in a page, home, layout, template or reusable region. Incomplete
// blocks remain valid drafts and are not converted into new admission errors.
export async function websiteAssetUsage(document,id,{signal}={}){
 if(!researchId(id))invalid('website assets');
 const used=sections=>{if(!Array.isArray(sections))invalid('website composition');return sections.some(section=>section?.assetId===id||section?.assetIds?.includes(id));};
 const home=await document.field(['document','website','home','sections'],{signal});if(!home.found)invalid('website composition');if(used(home.value))return true;
 for(const path of [paths.pages,['document','website','layouts'],['document','website','templates'],['document','website','design','regions','definitions']]){
  if(await document.tree.select(document.root,path)===null){if(path.at(-1)==='definitions')continue;invalid('website composition');}
  for await(const {value:sections} of collection(document,path,{signal,sectionsOnly:true}))if(used(sections))return true;
 }
 return false;
}
