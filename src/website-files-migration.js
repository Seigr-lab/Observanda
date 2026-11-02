import path from 'node:path';
import {parse,parseFragment,serialize} from 'parse5';
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

const failed=reason=>{throw new AppError('WEBSITE_CONVERSION_DEPENDENCIES',[{reason}]);};
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
   if(other&&records.get(other)?.source.id!==attr(parent,'data-observanda-source'))failed('cross-entry-composition');
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

// This is the only website file operation that opens a prior research edition.
// It is deliberately requested once for a chosen site; subsequent use is files.
export async function convertExistingWebsite(workspace,store,{websiteId,sourceReader,signal,blockedValues=[]}={}){
 if(websiteId!==null&&!researchId(websiteId))throw new AppError('INVALID');
 const site=websiteWorkspace(workspace,websiteId),{metadata,websitePin}=await site.outline(),siteId=websiteId??(await workspace.catalogue(readWebsiteDocumentRegistry))?.defaultSiteId;
 if(!researchId(siteId))throw new AppError('STORAGE_UPGRADE_REQUIRED');
 const releases=new PublicationJobs(site,{sourceReader}),candidate=await releases.inline({websitePin,etag:websitePin.researchSnapshotId,workspaceId:metadata.id,blockedValues},{signal});
 const retained=await releases.source(candidate.jobId),input=await openPublicationInput(site,retained,{signal}),conversion=new PublicationConversion(workspace,{store}),records=new Map(),aliases=new Map();
 let reader;
 try{
  for await(const row of input.records()){
   signal?.throwIfAborted();
   if(row.historical)failed('historical-entry');
   const book=await input.get('notebooks',row.notebookId),project=book&&await input.get('projects',book.projectId);if(!book||!project)failed('entry-owner');
   const provenance={workspaceId:row.sourceWorkspaceId??metadata.id,projectId:project.sourceId??project.id,notebookId:book.sourceId??book.id,recordId:row.recordId??row.id,target:'website'};
   let source;
   if(provenance.workspaceId===metadata.id)source=await conversion.seedWebsite(workspace,provenance,{signal});
   else{
    if(!sourceReader)throw new AppError('ACCESS_LOCKED');reader??=await sourceReader({signal});
    const result=await reader.use(provenance.workspaceId,undefined,(_store,_snapshot,pinned)=>conversion.seedWebsite(pinned.storage,provenance,{signal}));source=result.value;
   }
   const record=await input.record(row.id),media=new Map(Object.entries(row.mediaIdentities??{}).map(([id,alias])=>[alias,id])),assets=new Map(source.assets.map(asset=>[asset.sha256,asset.path]));
   records.set(row.id,{source,record,media,assets});
   for(const member of row.media??[]){const ext={image:'png',audio:'wav',video:'mp4'}[member.kind],name='media/'+member.id+'.'+ext;const file=await candidate.files.get(name);if(!file)continue;const alias=assets.get(contentHash(file));if(!alias)failed('entry-asset-permission');aliases.set(name,alias);}
  }
  await reader?.verify();
  for await(const name of candidate.files.keys()){
   const figure=/^figures\/([a-f0-9-]{36})-.+\.(?:svg|csv)$/.exec(name);if(!figure)continue;
   const alias=records.get(figure[1])?.assets.get(contentHash(await candidate.files.get(name)));if(!alias)failed('figure-asset-permission');aliases.set(name,alias);
  }
  const files=new Map();
  for await(const [name,value] of candidate.files){
   signal?.throwIfAborted();if(name==='publication.json'||aliases.has(name))continue;
   if(name.endsWith('.html'))files.set(name,bindConvertedPage(name,(await contentBuffer(value,{signal})).toString('utf8'),{records,aliases}));
   else if(name.endsWith('.css')){let css=(await contentBuffer(value,{signal})).toString('utf8');for(const [original,alias] of aliases)css=css.split(original).join(alias);files.set(name,css);}
   else if(records.size&&name!=='.nojekyll'&&!/^(?:[^/]+\.js|(?:media|fonts|assets)\/[^/]+)$/.test(name))failed('unowned-edition-member');
   else files.set(name,value);
  }
  await assertPublicationSourcePermissions(site,retained,{sourceReader,signal});
  const {migrateWebsitePublishingMetadata}=await import('./website-publishing-migration.js');
  return store.scope(()=>site.withLock(async()=>{
   await site.lockWebsite();const current=await site.currentOutline();
   if(current.websitePin.researchSnapshotId!==websitePin.researchSnapshotId||current.websitePin.websiteRevision!==websitePin.websiteRevision)throw new AppError('CONFLICT');
   await migrateWebsitePublishingMetadata(site,store,siteId,{signal});
   return store.importFiles(siteId,{name:(await site.website()).name,files,signal});
  }),{write:true,signal});
 }finally{await reader?.close();}
}