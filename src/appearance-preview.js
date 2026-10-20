import {withWebsiteSourceSelections} from './website-source-selections.js';
import {capturePreviewPermissions} from './publication-preview-admission.js';
import {publicationWorkspace,assertWebsitePin,sameWebsitePin} from './publication-pin.js';
import {websiteEditorProjection,websiteEditorPresentation} from './website-editor-projection.js';
import {validWebsiteDraftPin} from './web/website-draft-pin.js';
import {AppearancePreviewSources} from './appearance-preview-sources.js';
import {referenceNamespaceMatches} from './research-reference-namespace.js';
import {AppError} from './errors.js';
import {validAppearance} from './web/themes.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {AppearancePreviewRecords} from './appearance-preview-records.js';
import {hasHomepage} from './web/website-layouts.js';
import {REGION_SLOTS,resolveRegion} from './web/website-regions.js';
import {proseReferences} from './web/prose-model.js';
import {projectPublication} from './publication-projection.js';
import {bookText} from './web/book-messages.js';
import messages from './web/locales/en/appearance.json' with {type:'json'};
import {publicationExcerpt} from './web/publication-card.js';
import {publicationLinkResolver,publicationRecordText} from './publication-prose.js';
import {appearanceBrowsePage,appearanceBrowseQuery} from './appearance-preview-browse.js';
import {appearanceCollectionPage,appearanceCollectionQuery} from './appearance-preview-collections.js';
import {appearanceFeedPage,appearanceFeedQuery,appearanceFeedParameters} from './appearance-preview-feeds.js';
import {publicationCollectionKey} from './web/publication-collections.js';
import {appearanceReferencePage,appearanceReferenceQuery} from './appearance-preview-references.js';

// Appearance edits carry only design tokens. Website content comes from the
// immutable saved snapshot or durable draft, with sharing checked before any body.
// The existing publisher still owns projection, assets, rendering and privacy.
const sameDraft=(a,b)=>a==null&&b==null||validWebsiteDraftPin(a)&&validWebsiteDraftPin(b)&&a.id===b.id&&a.revision===b.revision;
async function withSource(workspace,command,{signal,sourceReader,sourceSnapshots,mediaOrigins,designTarget,permissionProof}={},consume){
 if(!command||Object.keys(command).filter(key=>!['websitePin','websiteDraft'].includes(key)).sort().join()!=='appearance,etag,mode,workspaceId'||
  !researchId(command.workspaceId)||!revisionId(command.etag)||!validAppearance(command.appearance)||
  !['auto','examples','website'].includes(command.mode)||command.websiteDraft!=null&&!validWebsiteDraftPin(command.websiteDraft))throw new AppError('INVALID');
 command=structuredClone(command);signal?.throwIfAborted();
 if(!workspace)throw new AppError('MISSING');
 workspace=publicationWorkspace(workspace);const base=workspace.baseWorkspace??workspace;
 return base.catalogue(async store=>{
  if((await store.snapshot()).metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  let websitePin=command.websitePin;
  if(websitePin===undefined){
   const legacy=await store.snapshot(command.etag);if(legacy.websiteDocuments===1)throw new AppError('INVALID');
   websitePin={researchSnapshotId:command.etag,websiteId:workspace.websiteId??null,websiteRevision:null};
  }
  assertWebsitePin(workspace,websitePin,command.etag);
  const projected=await websiteEditorProjection(store,workspace.websiteId??null,{websitePin,...(command.websiteDraft?{websiteDraft:command.websiteDraft}:{}),designTarget,pageLabels:command.mode!=='examples',signal});
  if(!sameWebsitePin(projected.websitePin,websitePin))throw new AppError('INVALID');
  const snapshot={...projected.snapshot,metadata:projected.metadata,websitePin:projected.websitePin,websiteSelection:projected.site.selection,...(command.websiteDraft?{websiteDraft:command.websiteDraft}:{})};
  if(snapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  const book={...snapshot.metadata,entries:[],appearance:structuredClone(command.appearance)};
  if(command.mode==='examples')return consume({book,source:'examples',snapshot,store,records:null});
  const local=await new AppearancePreviewRecords(store,snapshot,{signal,snapshotId:command.etag,websiteId:workspace.websiteId??null}).initialize();
  return withWebsiteSourceSelections(projected.document,async sources=>{
  const consumeRecords=async(records,metadata=book)=>{
   if(designTarget!==undefined&&sources.count)metadata=await websiteEditorPresentation(projected.document,projected.collectionIndexes,metadata,designTarget,{signal});
   const value=await consume({book:metadata,source:command.mode==='auto'?(records.counts.total||metadata.pages.some(p=>p.share)?'website':'examples'):command.mode,snapshot,store,records});
   if(permissionProof)permissionProof.push(...capturePreviewPermissions(records));return value;
  };
  if(!sources.count)return consumeRecords(local);
  const reader=await sourceReader?.({signal});if(!reader)throw new AppError('ACCESS_LOCKED');
  try{
   const records=await new AppearancePreviewSources(local,reader,{snapshots:sourceSnapshots,mediaOrigins}).initialize(sources);
   const value=await consumeRecords(records,{...records.metadata,entries:[],appearance:book.appearance});await reader.verify();return value;
  }finally{await reader.close();}
  },{signal});
 });
}
export const appearancePreviewSource=(workspace,command,options)=>withSource(workspace,command,options,({book,source,snapshot})=>({book,source,websitePin:snapshot.websitePin,...(snapshot.websiteDraft?{websiteDraft:snapshot.websiteDraft}:{})}));

const targetPath=target=>target==='home'?'index.html':target==='browse'?'browse.html':({entry:'entries',project:'projects',notebook:'notebooks',page:'pages'}[target.split(':')[0]]+'/'+target.split(':')[1]+'.html');
export function appearancePreviewTarget(path){
 if(path==='index.html')return 'home';if(path==='browse.html')return 'browse';
 const match=/^(entries|projects|notebooks|pages)\/([a-f0-9-]{36})\.html$/.exec(path??'');
 if(!match||!researchId(match[2]))throw new AppError('NOT_FOUND');
 return {entries:'entry',projects:'project',notebooks:'notebook',pages:'page'}[match[1]]+':'+match[2];
}
export function appearancePreviewRequest(value){
 if(typeof value!=='string'||value.includes('#'))throw new AppError('NOT_FOUND');
 const split=value.indexOf('?'),path=split<0?value:value.slice(0,split),query=split<0?'':value.slice(split+1),target=appearancePreviewTarget(path);
 const supplied=new URLSearchParams(query),collection=appearanceCollectionQuery(supplied),feed=appearanceFeedQuery(supplied),references=appearanceReferenceQuery(supplied);
 if(references!==null&&!target.startsWith('entry:'))throw new AppError('NOT_FOUND');
 const returnQuery=supplied.get('browse');
 if(supplied.getAll('browse').length>1||returnQuery!==null&&!target.startsWith('entry:'))throw new AppError('NOT_FOUND');
 supplied.delete('browse');
 let returnTo=null;
 if(returnQuery!==null){const value=appearanceBrowseQuery(new URLSearchParams(returnQuery)),params=new URLSearchParams(value.query);if(value.cursor)params.set('cursor',value.cursor);returnTo=params.toString();}
 if(supplied.size&&target!=='browse')throw new AppError('NOT_FOUND');
 const browse=appearanceBrowseQuery(supplied),params=new URLSearchParams(browse.query);if(browse.cursor)params.set('cursor',browse.cursor);
 const browseQuery=params.toString();if(collection){params.set('collection',collection.key);params.set('cards',collection.cursor);}for(const [key,value] of appearanceFeedParameters(feed))params.set(key,value);if(returnTo!==null)params.set('browse',returnTo);
 if(references!==null)params.set('references',references);
 return {path,target,collection,feed,references,browseQuery,query:params.toString(),key:path+(params.size?'?'+params:'')};
}
function selectionFor(book,records){
 return {homeEnabled:hasHomepage(book),projects:book.projects.filter(p=>p.share),notebooks:book.notebooks.filter(n=>records.counts.notebooks[n.id]>0),pages:book.pages.filter(p=>p.share),assets:book.website.assets,entries:[]};
}
function staticChoices(selection){
 return [...(selection.homeEnabled?[{target:'home',title:messages.homePage}]:[]),...['projects','notebooks','pages'].flatMap(key=>selection[key].map(item=>({target:{projects:'project',notebooks:'notebook',pages:'page'}[key]+':'+item.id,title:item.title})))].map(({target,title})=>({title,path:targetPath(target)}));
}
// Bounded page choices, with a snapshot-bound continuation. Changing appearance
// does not require retrieving all page titles, much less all original records.
export async function appearancePreviewChoices(workspace,command,options={}){
 const {cursor=null,path=null}=options;
 return withSource(workspace,command,options,async({book,records,source,snapshot})=>{
  if(source!=='website')throw new AppError('INVALID');
  const selection=selectionFor(book,records),fixed=staticChoices(selection);
  if(path!==null){
   const request=appearancePreviewRequest(path),target=request.target,item=target.startsWith('entry:')?await records.get(target.slice(6)):null;
   const fixedChoice=fixed.find(v=>v.path===request.path);
   const choice=fixedChoice?{...fixedChoice,path:request.key}:item?{title:item.title,path:request.key}:target==='browse'&&records.counts.total?{title:bookText('browse'),path:request.key}:null;
   if(!choice)throw new AppError('NOT_FOUND');return {pages:[choice],nextCursor:null,websitePin:snapshot.websitePin,...(snapshot.websiteDraft?{websiteDraft:snapshot.websiteDraft}:{})};
  }
  let anchor={offset:0,after:null};
  if(cursor!==null){
   try{if(typeof cursor!=='string'||cursor.length>2048)throw Error();anchor=JSON.parse(Buffer.from(cursor,'base64url'));}catch{throw new AppError('INVALID');}
   if(Object.keys(anchor).sort().join()!==['after','etag','offset','websiteId','websitePin',...(snapshot.websiteDraft?['websiteDraft']:[])].sort().join()||anchor.etag!==records.snapshotId||anchor.websiteId!==(workspace.websiteId??null)||!sameWebsitePin(anchor.websitePin,snapshot.websitePin)||!sameDraft(anchor.websiteDraft,snapshot.websiteDraft)||!Number.isSafeInteger(anchor.offset)||anchor.offset<0||anchor.offset>fixed.length||anchor.after!==null&&(!Number.isSafeInteger(anchor.after)||anchor.after<0||anchor.offset!==fixed.length))throw new AppError('INVALID');
  }
  const pages=[],limit=40;let offset=anchor.offset,after=anchor.after,more=false;
  while(offset<fixed.length&&pages.length<limit)pages.push(fixed[offset++]);
  if(offset<fixed.length)more=true;
  else for await(const row of records.rows({after:after===null?null:{position:after}})){
   if(pages.length===limit){more=true;break;}
   const summary=await records.summary(row);
   pages.push({path:targetPath('entry:'+row.id),title:summary.title});after=row.position;
  }
  return {pages,websitePin:snapshot.websitePin,...(snapshot.websiteDraft?{websiteDraft:snapshot.websiteDraft}:{}),nextCursor:more?Buffer.from(JSON.stringify({offset,after,etag:records.snapshotId,websiteId:workspace.websiteId??null,websitePin:snapshot.websitePin,...(snapshot.websiteDraft?{websiteDraft:snapshot.websiteDraft}:{})})).toString('base64url'):null};
 });
}

export async function appearancePreviewPage(workspace,command,path,options={}){
 const {signal}=options,request=appearancePreviewRequest(path),target=request.target;
 return withSource(workspace,command,{...options,designTarget:target},async({book,source,records})=>{
  if(source!=='website')throw new AppError('INVALID');
  const selection=selectionFor(book,records),[kind,id]=target.split(':');
  const item=kind==='entry'?await records.get(id):selection[{project:'projects',notebook:'notebooks',page:'pages'}[kind]]?.find(v=>v.id===id);
  if(kind==='home'?!selection.homeEnabled:kind==='browse'?!records.counts.total:!item)throw new AppError('NOT_FOUND');
  const layout=book.website.layouts.find(l=>l.target===target),original=layout?.placement!=='replace';
  const sources=[{sections:layout?.sections??[],region:'layout'},...REGION_SLOTS.map(kind=>({region:kind,sections:resolveRegion(book.website,target==='browse'?(hasHomepage(book)?'home':'project:'+selection.projects[0]?.id):target,kind)?.sections??[]}))];
  if(original)sources.push({region:'',sections:kind==='home'?book.website.home.sections:kind==='page'?item.sections:[]});
  const entries=new Map(),cards=new Map(),references=[];
  const originalRecord=async id=>{const descriptor=await records.get(id);if(!descriptor)return;const record=await records.original(id);entries.set(id,record);references.push(...descriptor.relations.map(l=>l.target),...descriptor.references);};
  const directLink=async href=>{if(typeof href==='string'&&/^entry:[a-f0-9-]{36}(?:#|$)/.test(href))await records.get(href.slice(6).split('#')[0]);};
  const richLinks=async node=>{for(const mark of node?.marks??[])if(mark.type==='link')await directLink(mark.attrs.href);for(const child of node?.content??[])await richLinks(child);};
  const collectionPages=[];
  const includeCards=async(key,notebooks,filter,feed)=>{
   const options={key,target,notebooks,filter,cursor:request.collection?.key===key?request.collection.cursor:null};
   const page=feed?await appearanceFeedPage(records,{...options,feed,visitor:request.feed?.key===key?request.feed:null}):await appearanceCollectionPage(records,options);
   for(const card of page.records)cards.set(card.id,card);
   const {records:items,...details}=page;collectionPages.push({...details,recordIds:items.map(card=>card.id)});
  };
  for(const {sections,region} of sources)for(const section of sections){
   signal?.throwIfAborted();if(!section.show)continue;
   let parent=section.parentId,hidden=false;while(parent){const ancestor=sections.find(s=>s.id===parent);if(!ancestor?.show){hidden=true;break;}parent=ancestor.parentId;}if(hidden)continue;
   if(section.kind==='records')await includeCards(publicationCollectionKey(section,region),section.filter?.projectId?new Set(selection.notebooks.filter(n=>n.projectId===section.filter.projectId).map(n=>n.id)):records.notebooks,section.filter,section.feed);
   if(section.kind==='media')await originalRecord(section.entryId);
   await directLink(section.href);
   if(section.richText){references.push(...proseReferences(section.richText));await richLinks(section.richText);}
  }
  let browsePage=null,referencePage=null;
  if(kind==='entry'){await originalRecord(id);await records.neighbours(id);referencePage=await appearanceReferencePage(records,id,request.references);}
  else if(kind==='browse')browsePage=await appearanceBrowsePage(records,request.browseQuery);
  else if(original&&['project','notebook'].includes(kind))await includeCards('body',new Set(kind==='notebook'?[id]:selection.notebooks.filter(n=>n.projectId===id).map(n=>n.id)));
  if(request.collection&&!collectionPages.some(page=>page.key===request.collection.key))throw new AppError('NOT_FOUND');
  if(request.feed&&!collectionPages.some(page=>page.key===request.feed.key&&page.visitor))throw new AppError('NOT_FOUND');
  for(const entry of entries.values())for(const doc of [entry.body,...entry.sections.map(s=>s.body)])await richLinks(doc);
  for(const card of cards.values())references.push(...records.descriptors.get(card.id).relations.filter(link=>link.role==='mention').map(link=>link.target));
  for(const reference of references)if(reference.kind==='record'){if(records.resolveReference)await records.resolveReference(reference);else if(await referenceNamespaceMatches(records.store,reference))await records.get(reference.id);}
  const resolve=publicationLinkResolver(book.id,{...selection,entries:[...records.descriptors.values()]});
  for(const card of cards.values())if(records.descriptors.get(card.id).relations.some(link=>link.role==='mention')){
   const original=await records.original(card.id);card.excerpt=publicationExcerpt(publicationRecordText(original.body,original,resolve));
  }
  const scopes=new Set([...cards.keys()].map(id=>'cover:'+id));for(const entry of entries.values())scopes.add('entry:'+entry.id);
  for(const section of sources.flatMap(source=>source.sections))scopes.add(target+'#'+section.id);
  for(const region of REGION_SLOTS.map(kind=>resolveRegion(book.website,target,kind)).filter(Boolean))for(const section of region.sections)scopes.add('region:'+region.id+'#'+section.id);
  for(const display of book.website.presentation.media)if(scopes.has(display.scope))await directLink(display.link);
  return projectPublication(book,{...selection,entries:[...entries.values()],recordCards:[...cards.values()]},{publicationTarget:target,entryDestinations:[...records.descriptors.values()].sort((a,b)=>a.position-b.position),publicationCounts:records.counts,collectionPages,collectionQuery:request.browseQuery,...(browsePage?{browsePage}:{}),...(referencePage?{referencePage,referenceQuery:request.query}:{})});
 });
}
