import path from 'node:path';
import {parse,parseFragment,serialize} from 'parse5';
import {WebsiteFileStore} from './website-file-store.js';
import {WebsiteSites} from './website-sites.js';
import {WebsiteDocumentStore} from './website-document-store.js';
import {websiteBook,websiteDocument} from './web/website-sites-model.js';
import {createNotebook} from './model.js';
import {sameWebsitePin} from './web/website-pin.js';
import {authoredSiteOnly,renderAuthoredSite,renderDraftPages} from './website-authored-files.js';
import {retainedSavedWebsite} from './website-upgrade-retained.js';
import {runWebsiteUpgrade,upgradeControl,validateUpgradeState} from './website-upgrade-lease.js';
import {websiteWorkspace} from './website-workspace.js';
import {PublicationJobs} from './publication-jobs.js';
import {openPublicationInput} from './publication-input-reader.js';
import {PublicationConversion} from './publication-conversion.js';
import {annotatePublicationParts} from './publication-conversion-render.js';
import {readWebsiteDocumentRegistry} from './website-document-registry.js';
import {contentBuffer,contentHash} from './file-content.js';
import {assertPublicationSourcePermissions} from './publication-permission-admission.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
import {attr,put,words,descendants} from './website-migration-views.js';
import {markEntryLink} from './website-entry-links.js';
import {currentFigureSVGs} from './website-figure-assets.js';

class WebsiteDependencyError extends AppError{
 constructor(reason){super('WEBSITE_CONVERSION_DEPENDENCIES',[{reason}]);this.dependency=reason;}
}
const failed=reason=>{throw new WebsiteDependencyError(reason);};
const hasClass=(node,key)=>(attr(node,'class')??'').split(/\s+/).includes(key);
const local=(file,href)=>href&&!href.startsWith('#')&&!/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)?path.posix.normalize(path.posix.join(path.posix.dirname(file),href.split(/[?#]/)[0])):null;
const entryPath=name=>/^entries\/([a-f0-9-]{36})(?:-references-\d+)?\.html$/.exec(name??'')?.[1];
const first=(node,test)=>[...descendants(node)].find(test);
const reference=(node,key,value)=>put(node,'data-observanda-'+key,value);
function mark(node,source,view){reference(node,'source',source.id);reference(node,'source-revision',source.revision);if(view)reference(node,'view',view);}
function ancestor(node,test){for(let n=node.parentNode;n;n=n.parentNode)if(test(n))return n;return null;}

export function bindConvertedPage(file,html,{records,aliases}){
 const doc=parse(html),nodes=[...descendants(doc)],body=nodes.find(node=>node.tagName==='body'),target=attr(body,'data-page'),current=target?.startsWith('entry:')?records.get(target.slice(6)):null;
 if(target?.startsWith('entry:')&&!current)failed('entry-identity');
 for(const node of nodes)for(const value of node.attrs??[])if(['src','href','poster'].includes(value.name)){
  const name=local(file,value.value),alias=aliases.get(name);if(alias)value.value=path.posix.relative(path.posix.dirname(file),alias);
 }
 if(!records.size)return html;
 const scoped=node=>ancestor(node,n=>attr(n,'data-observanda-source')!==undefined);
 let linkIndex=0;
 const label=(node,owner,anchor)=>{mark(node,owner.source,anchor?'section-label':'title');if(node.tagName==='a')reference(node,'href',attr(node,'href'));if(anchor)reference(node,'anchor',anchor);};
 for(const node of nodes){
  if(!node.tagName)continue;
  const recordId=attr(node,'data-record-id')??attr(node,'data-public-record');
  if(recordId){
   const owner=records.get(recordId);if(!owner||scoped(node))failed('nested-entry');
   const href=attr(first(node,n=>n.tagName==='a'&&entryPath(local(file,attr(n,'href')))===recordId)??{},'href');if(!href)failed('entry-link');
   mark(node,owner.source,attr(node,'data-public-record')===undefined?'card':'browse');reference(node,'href',href);reference(node,'record',recordId);
   if(attr(node,'data-feed-item')!==undefined)reference(node,'feed','1');
   const cover=first(node,n=>attr(n,'data-media-id'));if(cover)reference(node,'cover',owner.media.get(attr(cover,'data-media-id'))??attr(cover,'data-media-id'));
   continue;
  }
  if(current&&node.tagName==='article'&&hasClass(node,'record-page')){
   if(scoped(node))failed('nested-entry');mark(node,current.source);annotatePublicationParts(node,current.record);
   for(const part of descendants(node)){const key=attr(part,'data-observanda-part');if(key?.startsWith('media:')&&current.media.has(key.slice(6)))reference(part,'part','media:'+current.media.get(key.slice(6)));}
   continue;
  }
  if(scoped(node)){
   const href=attr(node,'href'),other=entryPath(local(file,href)),parent=scoped(node);
   if(other&&node.tagName==='a'){
    const owner=records.get(other);if(!owner)failed('unresolved-entry-link');
    if(owner.source.id!==attr(parent,'data-observanda-source'))markEntryLink(node,owner,++linkIndex);
   }
   continue;
  }
  if(current){
   const title=current.record.title;
   if(node.tagName==='title'&&(words(node)===title||words(node).startsWith(title+' | '))){mark(node,current.source,'document-title');reference(node,'suffix',words(node).slice(title.length));continue;}
   if(node.tagName==='h1'&&words(node)===title){label(node,current);continue;}
   if(node.tagName==='nav'&&hasClass(node,'page-contents')){mark(node,current.source,'contents');continue;}
   if(node.tagName==='a'&&(attr(node,'href')??'').startsWith('#record-section-')){label(node,current,attr(node,'href').slice(1));continue;}
  }
  if(node.tagName==='a'){
   const href=attr(node,'href'),id=entryPath(local(file,href));if(!id)continue;
   const owner=records.get(id);if(!owner)failed('unresolved-entry-link');
   const titleNode=first(node,n=>attr(n,'data-book-name')!==undefined);
   if(titleNode||words(node)===owner.record.title)label(titleNode??node,owner);
   else if(href?.includes('#record-section-'))label(node,owner,href.split('#')[1]);
   else if(words(node).includes(owner.record.title))failed('unmapped-entry-label');
  }
  const tagOptions=node.tagName==='datalist'&&attr(node,'id')==='public-tags',typeOptions=node.tagName==='select'&&attr(node,'name')==='type'&&ancestor(node,n=>attr(n,'data-book-browse')!==undefined);
  if(tagOptions||typeOptions){
   const old=node.childNodes.filter(n=>n.tagName==='option'&&attr(n,'value')),keep=node.childNodes.filter(n=>!old.includes(n));
   const assigned=new Set();node.childNodes=keep;
   for(const owner of records.values()){
    const values=new Set(tagOptions?owner.record.tags:[owner.record.template?.label??owner.record.type]);
    const wrapper=parseFragment(tagOptions?'<span></span>':'<optgroup label=""></optgroup>').childNodes[0];mark(wrapper,owner.source,tagOptions?'tag-options':'type-option');
    wrapper.parentNode=node;wrapper.childNodes=[];
    for(const option of old)if(values.has(attr(option,'value'))){assigned.add(option);wrapper.childNodes.push({...option,parentNode:wrapper,attrs:option.attrs.map(item=>({...item})),childNodes:option.childNodes.map(child=>({...child}))});}
    node.childNodes.push(wrapper);
   }
   if(assigned.size!==old.length)failed('unowned-index-filter');
  }
 }
 return serialize(doc);
}

// This path belongs to upgrading a previous workspace. The file editor opens
// its existing files and reads only the independent filesystem status marker.
const cachedSiteId=(store,websiteId)=>websiteId??store.scope(async()=>(await store.control(upgradeControl('default-site'),{missing:true}))?.id);
async function alreadyImported(store,websiteId,signal){
 const id=await cachedSiteId(store,websiteId);
 if(!id||!await store.scope(()=>store.raw(id,{missing:true}),{signal}))return null;
 return store.open(id,{signal});
}
export async function convertExistingWebsite(workspace,store,{websiteId,sourceReader,signal,blockedValues=[],progress}={}){
 if(websiteId!==null&&!researchId(websiteId))throw new AppError('INVALID');
 const existing=await alreadyImported(store,websiteId,signal);if(existing)return existing;
 return runWebsiteUpgrade(store,'site-'+(websiteId??'default'),async()=>{
  const previous=await alreadyImported(store,websiteId,signal);if(previous)return previous;
  const saved=await workspace.catalogue(async catalogue=>{
   const documents=new WebsiteDocumentStore(catalogue),registry=await documents.registry();
   if(!registry)throw new AppError('STORAGE_UPGRADE_REQUIRED');
   const selected=await documents.read(websiteId,{signal}),snapshot=await catalogue.snapshot(selected.researchSnapshotId);
   const websitePin={websiteId,websiteRevision:selected.websiteRevision,researchSnapshotId:selected.researchSnapshotId};
   return {siteId:websiteId??registry.defaultSiteId,metadata:websiteBook(snapshot.metadata,selected.site),websitePin,source:selected.site};
  });
  const {siteId,metadata,websitePin,source}=saved,site=websiteWorkspace(workspace,websiteId);
  if(websiteId===null)await store.scope(()=>store.writeControl(upgradeControl('default-site'),{id:siteId},{signal}),{write:true,signal});
  const duplicate=await alreadyImported(store,websiteId,signal);if(duplicate)return duplicate;
  const material=authoredSiteOnly(source)?{files:await renderAuthoredSite(workspace,metadata,{blockedValues,signal})}:await researchWebsiteFiles(workspace,store,site,{metadata,websitePin,sourceReader,signal,blockedValues,progress});
  const draftFiles=await renderDraftPages(workspace,metadata,material.files,{edition:material.edition,bind:material.bind,signal});
  await progress?.('saving-files',0,material.files.size+draftFiles.size);
  const {migrateWebsitePublishingMetadata}=await import('./website-publishing-migration.js');
  return store.scope(()=>site.withLock(async()=>{
   await site.lockWebsite();
   const current=await new WebsiteSites(workspace).version(websiteId);
   if(!sameWebsitePin(current.websitePin,websitePin))throw new AppError('CONFLICT');
   await migrateWebsitePublishingMetadata(site,store,siteId,{signal});
   return store.importFiles(siteId,{name:source.name,files:material.files,draftFiles,signal,onFile:(done,total)=>progress?.('saving-files',done,total)});
  }),{write:true,signal});
 },{signal});
}

async function researchWebsiteFiles(workspace,store,site,{metadata,websitePin,sourceReader,signal,blockedValues,progress}){
 await progress?.('checking-saved-editions',0);
 const releases=new PublicationJobs(site,{sourceReader}),previous=await retainedSavedWebsite(releases,websitePin,{signal});
 let captured=0,converted=0;
 if(!previous)await progress?.('capturing-entries',0);
 const candidate=previous?.candidate??await releases.inline({websitePin,etag:websitePin.researchSnapshotId,workspaceId:metadata.id,blockedValues},{signal,
  onCapture:progress?async value=>{if(value.phase==='record-complete')await progress('capturing-entries',++captured);}:undefined,
  progress:async({done,total})=>progress?.('rendering-pages',done,total)});
 await progress?.('reading-saved-files',0);
 const retained=previous?.retained??await releases.source(candidate.jobId),conversion=new PublicationConversion(workspace,{store}),records=new Map(),aliases=new Map(),owners=new Map(),mediaNames=new Map();
 const hasDrafts=metadata.pages.some(page=>!page.share);
 const input=await workspace.catalogue(async()=>{
  const source=await openPublicationInput(site,retained,{signal}),books=new Map(),projects=new Map();
  for await(const row of source.records({order:'original'})){
   if(row.historical)failed('historical-entry');
   if(!books.has(row.notebookId))books.set(row.notebookId,await source.get('notebooks',row.notebookId));const book=books.get(row.notebookId);
   if(!book)failed('entry-owner');if(!projects.has(book.projectId))projects.set(book.projectId,await source.get('projects',book.projectId));const project=projects.get(book.projectId);
   if(!project)failed('entry-owner');
   const provenance={workspaceId:row.sourceWorkspaceId??metadata.id,projectId:project.sourceId??project.id,notebookId:book.sourceId??book.id,recordId:row.recordId??row.id,target:'website'};
   if(!owners.has(provenance.workspaceId))owners.set(provenance.workspaceId,new Map());owners.get(provenance.workspaceId).set(row.id,provenance);
   // All annotation inputs are in the retained title/card descriptor, including
   // non-cover media. Do not open the retained original again to get these IDs.
   const record={title:row.title,type:row.type,tags:row.tags,attachments:row.media??row.attachments},media=new Map(Object.entries(row.mediaIdentities??{}).map(([id,alias])=>[alias,id]));
   records.set(row.id,{record,media,...(hasDrafts?{card:row}:{})});
   for(const member of row.media??[]){const ext={image:'png',audio:'wav',video:'mp4'}[member.kind],name='media/'+member.id+'.'+ext;if(!mediaNames.has(name))mediaNames.set(name,new Set());mediaNames.get(name).add(row.id);}
  }
  return source;
 });
 let reader;
 try{
  for(const [namespace,selected] of owners){
   const withOwner=async consume=>{
    if(namespace===metadata.id)return workspace.catalogue(async catalogue=>{const snapshotId=await catalogue.head();return consume(catalogue,await catalogue.snapshot(snapshotId),{snapshotId,storage:workspace});});
    if(!sourceReader)throw new AppError('ACCESS_LOCKED');reader??=await sourceReader({signal});return reader.use(namespace,undefined,consume);
   };
   await progress?.('converting-entries',converted,records.size);
   const sources=await runWebsiteUpgrade(store,'source-owner-'+namespace,()=>conversion.seedWebsites(selected.values(),withOwner,{signal,onSource:()=>progress?.('converting-entries',++converted,records.size)}),{signal,shareResult:false});
   for(const [id,provenance] of selected){const source=sources.get(provenance.recordId);Object.assign(records.get(id),{source,assets:new Map(source.assets.map(asset=>[asset.sha256,asset.path]))});}
  }
  await reader?.verify();
  await workspace.catalogue(async()=>{
   for await(const name of candidate.files.keys()){
    const figure=/^figures\/([a-f0-9-]{36})-.+\.(?:svg|csv)$/.exec(name),entries=figure?[figure[1]]:mediaNames.get(name);
    if(!entries)continue;
    const hash=candidate.files.output?(await candidate.files.output.get('files',name)).sha256:contentHash(await candidate.files.get(name));
    for(const id of entries){
     const owner=records.get(id);let alias=owner?.assets.get(hash);
     const svg=figure&&!alias&&/^figures\/[a-f0-9-]{36}-([a-f0-9-]{36})\.svg$/.exec(name);
     if(svg&&owner){
      owner.figureSVGs??=await currentFigureSVGs(store,owner.source,{signal});
      alias=owner.figureSVGs.get(svg[1]);
     }
     if(!alias)failed(figure?'figure-asset-permission':'entry-asset-permission');
     aliases.set(name,alias);
    }
   }
  });
  const files=new Map(),bind=(name,html)=>bindConvertedPage(name,html,{records,aliases,mediaNames});
  // One read scope for the whole edition: each retained file otherwise opens its own catalogue transaction.
  await workspace.catalogue(async()=>{
   for await(const [name,value] of candidate.files){
    signal?.throwIfAborted();if(name==='publication.json'||aliases.has(name))continue;
    if(name.endsWith('.html'))files.set(name,bind(name,(await contentBuffer(value,{signal})).toString('utf8')));
    else if(name.endsWith('.css')){let css=(await contentBuffer(value,{signal})).toString('utf8');for(const [original,alias] of aliases)css=css.split(original).join(alias);files.set(name,css);}
    else if(records.size&&name!=='.nojekyll'&&!/^(?:[^/]+\.js|(?:media|fonts|assets)\/[^/]+)$/.test(name))failed('unowned-edition-member');
    else files.set(name,value);
    await progress?.('copying-files',files.size,candidate.files.size);
   }
  });
  await assertPublicationSourcePermissions(site,retained,{sourceReader,signal});
  return {files,bind,edition:{input,records,aliases,candidate}};
 }finally{await reader?.close();}
}
const statusPath=upgradeControl('workspace');
export async function websiteUpgradeStatus(workspace,{signal}={}){
 const store=new WebsiteFileStore(workspace);
 return store.scope(async()=>validateUpgradeState(await store.control(statusPath,{missing:true})),{signal});
}

async function authoredDefault(workspace,registry,{signal}){
 const saved=await workspace.catalogue(async catalogue=>{
  const documents=new WebsiteDocumentStore(catalogue),head=await documents.savedHead(registry.defaultSiteId,registry);
  if(head.ordinal>0)return true;
  const {document}=await documents.document(null,{signal}),actual=await document.reference(['document'],{signal});
  for(const theme of ['research','studio']){
   const defaults=websiteDocument(createNotebook('Website','',theme));
   if(await document.tree.retain(defaults)===actual)return false;
  }
  return true;
 });
 if(saved)return true;
 // An explicitly prepared or published initial composition is also a site.
 const scoped=websiteWorkspace(workspace,null);
 return await scoped.readMetadata('.observanda/publishing.json',1024*1024)!==null||
  (await scoped.metadataPage('.observanda/release-list',{limit:1})).items.length>0||
  (await scoped.metadataPage('.observanda/local-exports/owners',{limit:1})).items.length>0;
}

export async function upgradeExistingWebsites(workspace,{sourceReader,signal,blockedValues=[],onProgress}={}){
 const store=new WebsiteFileStore(workspace),status=()=>store.scope(async()=>validateUpgradeState(await store.control(statusPath,{missing:true})),{signal});
 const initial=await status();if(initial.state==='ready')return initial;
 return runWebsiteUpgrade(store,'workspace',async()=>{
  const prior=await status();if(prior.state==='ready')return prior;
  const report=async value=>{
   await store.scope(()=>store.writeControl(statusPath,{version:1,...value},{signal}),{write:true,signal});
   onProgress?.(value);return value;
  };
  const common={total:0,done:0};let failed,phase='discovery',siteId;
  try{
   await report({...common,state:'preparing',phase});
   const directory=new WebsiteSites(workspace);await directory.initialize();
   const registry=await workspace.catalogue(readWebsiteDocumentRegistry),sites=[];
   await store.scope(()=>store.writeControl(upgradeControl('default-site'),{id:registry.defaultSiteId},{signal}),{write:true,signal});
   if(await authoredDefault(workspace,registry,{signal})){sites.push(null);common.defaultSiteId=registry.defaultSiteId;}
   let after=null;do{
    const page=await directory.list({after,limit:100});for(const site of page.sites)sites.push(site.id);after=page.next;
   }while(after);
   common.total=sites.length;phase='materializing';
   for(const websiteId of sites){
    signal?.throwIfAborted();siteId=websiteId??registry.defaultSiteId;
    await report({...common,state:'preparing',siteId,phase});
    try{
     if(!await store.scope(()=>store.raw(siteId,{missing:true}),{signal})){
      let lastStage,lastWrite=0;
      const progress=async(stage,completed,total)=>{
       const now=Date.now();if(stage===lastStage&&now-lastWrite<3000)return;
       lastStage=stage;lastWrite=now;
       await report({...common,state:'preparing',siteId,phase,stage,completed,...(Number.isSafeInteger(total)?{stageTotal:total}:{})});
      };
      await convertExistingWebsite(workspace,store,{websiteId,sourceReader,blockedValues,signal,progress});
     }
     common.done++;
    }catch(error){
     signal?.throwIfAborted();
     failed??={siteId,code:error instanceof AppError?error.code:'IO',...(error instanceof WebsiteDependencyError?{dependency:error.dependency}:{})};
     for(const key of ['projectId','labBookId','sourceWorkspaceId'])if(failed.siteId===siteId&&researchId(error[key]))failed[key]=error[key];
    }
   }
   return report(failed?{...common,state:'failed',phase,...failed}:{...common,state:'ready'});
  }catch(error){
   signal?.throwIfAborted();
   return report({...common,state:'failed',phase,...(siteId?{siteId}:{}),code:error instanceof AppError?error.code:'IO'});
  }
 },{signal});
}
